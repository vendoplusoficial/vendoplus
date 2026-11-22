-- Apply the same entitlement check to table access and to the RPCs that bypass RLS.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'vp_comandas_config', 'vp_comandas_areas', 'vp_comandas_ruteo',
    'vp_comandas_mesas', 'vp_comandas_cuentas', 'vp_comandas_detalles',
    'vp_comandas_historial'
  ]
  loop
    execute format(
      'create policy comandas_premium on public.%I as restrictive for all to authenticated using ((select public.has_access(auth.uid()))) with check ((select public.has_access(auth.uid())))',
      table_name
    );
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION public.vp_com_cancelar(p_cuenta uuid, p_motivo text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not coalesce(public.has_access(auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'sin_premium');
  end if;
  select * into c from public.vp_comandas_cuentas
   where id = p_cuenta and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'cuenta_no_existe'); end if;
  if c.estado = 'cobrada' then return jsonb_build_object('ok', false, 'error', 'ya_cobrada'); end if;

  update public.vp_comandas_cuentas set estado = 'cancelada', cerrada_en = now() where id = c.id;
  update public.vp_comandas_detalles set estado = 'cancelado'
   where cuenta_id = c.id and estado <> 'cancelado';

  perform public.vp_com_log('cuenta_cancelada', c.id, null, c.estado, 'cancelada',
                            p_actor, 'caja', left(coalesce(p_motivo,''),200), '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_cerrar(p_cuenta uuid, p_venta_id text, p_venta_numero integer, p_total numeric, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not coalesce(public.has_access(auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'sin_premium');
  end if;
  if coalesce(btrim(p_venta_id),'') = '' then
    return jsonb_build_object('ok', false, 'error', 'sin_venta');
  end if;

  select * into c from public.vp_comandas_cuentas
   where id = p_cuenta and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'cuenta_no_existe'); end if;
  if c.estado = 'cobrada' then
    return jsonb_build_object('ok', true, 'repetida', true, 'venta', c.venta_id);
  end if;
  if c.estado = 'cancelada' then
    return jsonb_build_object('ok', false, 'error', 'cuenta_cancelada');
  end if;

  update public.vp_comandas_cuentas
     set estado = 'cobrada', cerrada_en = now(), venta_id = btrim(p_venta_id),
         venta_numero = p_venta_numero, total = coalesce(p_total, c.total)
   where id = c.id;

  perform public.vp_com_log('cuenta_cobrada', c.id, null, c.estado, 'cobrada',
                            p_actor, 'caja', c.mesa_nombre,
                            jsonb_build_object('venta', p_venta_id, 'total', p_total));
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_cocina(p_area uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select coalesce(jsonb_agg(x order by x->>'enviado_en'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'comanda', d.comanda_num, 'cuenta', d.cuenta_id,
      'mesa', c.mesa_nombre, 'mesero', c.mesero_nombre,
      'enviado_en', d.enviado_en, 'area', d.area_nombre,
      'productos', jsonb_agg(jsonb_build_object(
                     'id', d.id, 'nombre', d.nombre, 'size', d.size_label,
                     'cantidad', d.cantidad, 'unidad', d.unidad, 'nota', d.nota,
                     'estado', d.estado, 'problema', d.problema_tipo) order by d.creado)
    ) as x
    from public.vp_comandas_detalles d
    join public.vp_comandas_cuentas  c on c.id = d.cuenta_id
    where d.user_id = auth.uid() and public.has_access(auth.uid())
      and d.comanda_num is not null
      and d.estado in ('pendiente','preparando','problema')
      and (p_area is null or d.area_id = p_area)
      and d.enviado_en > now() - interval '24 hours'
    group by d.comanda_num, d.cuenta_id, c.mesa_nombre, c.mesero_nombre, d.enviado_en, d.area_nombre
    limit 200
  ) t;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_cuenta(p_cuenta uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'id', c.id, 'mesa', c.mesa_nombre, 'mesa_id', c.mesa_id,
    'mesero', c.mesero_nombre, 'mesero_id', c.mesero_local,
    'personas', c.personas, 'estado', c.estado,
    'abierta_en', c.abierta_en, 'venta_id', c.venta_id,
    'total', coalesce((select sum(d.cantidad * d.precio) from public.vp_comandas_detalles d
                        where d.cuenta_id = c.id and d.estado <> 'cancelado'), 0),
    'productos', coalesce((select jsonb_agg(jsonb_build_object(
                    'id', d.id, 'producto_id', d.producto_id, 'nombre', d.nombre,
                    'size', d.size_label, 'cantidad', d.cantidad, 'precio', d.precio,
                    'unidad', d.unidad, 'nota', d.nota, 'area', d.area_nombre,
                    'comanda', d.comanda_num, 'estado', d.estado,
                    'problema', d.problema_tipo, 'problema_nota', d.problema_nota,
                    'enviado_en', d.enviado_en)
                    order by coalesce(d.comanda_num, 999999), d.creado)
                  from public.vp_comandas_detalles d where d.cuenta_id = c.id), '[]'::jsonb)
  )
  from public.vp_comandas_cuentas c
  where c.id = p_cuenta and c.user_id = auth.uid() and public.has_access(auth.uid());
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_cuenta_pedir(p_cuenta uuid, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; v_total numeric;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not coalesce(public.has_access(auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'sin_premium');
  end if;
  select * into c from public.vp_comandas_cuentas
   where id = p_cuenta and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'cuenta_no_existe'); end if;
  if c.estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'error', 'estado_invalido', 'estado', c.estado);
  end if;

  select coalesce(sum(cantidad * precio), 0) into v_total
    from public.vp_comandas_detalles where cuenta_id = c.id and estado <> 'cancelado';

  update public.vp_comandas_cuentas
     set estado = 'cuenta_pedida', cuenta_en = now(), total = v_total where id = c.id;

  perform public.vp_com_log('cuenta_pedida', c.id, null, 'abierta', 'cuenta_pedida',
                            p_actor, 'mesero', c.mesa_nombre, jsonb_build_object('total', v_total));
  return jsonb_build_object('ok', true, 'total', v_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_estado()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object(
    'negocio', auth.uid(),
    'activo',  public.vp_com_activo(),
    'premium', coalesce(public.has_access(auth.uid()), false),
    'caja',    true,
    'mesero',  coalesce((select c.area_mesero from public.vp_comandas_config c where c.user_id = auth.uid() and public.has_access(auth.uid())), false),
    'cocina',  coalesce((select c.area_cocina from public.vp_comandas_config c where c.user_id = auth.uid() and public.has_access(auth.uid())), false),
    'areas',   coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.orden, a.creado)
                         from public.vp_comandas_areas a
                         where a.user_id = auth.uid() and a.activa and public.has_access(auth.uid())), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_problema(p_detalle uuid, p_tipo text, p_nota text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not coalesce(public.has_access(auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'sin_premium');
  end if;
  if p_tipo not in ('agotado','no_se_puede','sustitucion','otro') then
    return jsonb_build_object('ok', false, 'error', 'tipo_invalido');
  end if;

  select * into d from public.vp_comandas_detalles
   where id = p_detalle and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  if not public.vp_com_transicion_ok(d.estado, 'problema') then
    return jsonb_build_object('ok', false, 'error', 'transicion_invalida');
  end if;

  update public.vp_comandas_detalles
     set estado = 'problema', problema_tipo = p_tipo, problema_nota = left(coalesce(p_nota,''), 200)
   where id = p_detalle;

  perform public.vp_com_log('problema_reportado', d.cuenta_id, d.id, d.estado, 'problema',
                            p_actor, 'cocina', p_tipo,
                            jsonb_build_object('nota', left(coalesce(p_nota,''),200)));
  return jsonb_build_object('ok', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_resolver(p_detalle uuid, p_accion text, p_cantidad numeric, p_nota text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare d record;
begin
  if auth.uid() is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not coalesce(public.has_access(auth.uid()), false) then
    return jsonb_build_object('ok', false, 'error', 'sin_premium');
  end if;
  if p_accion not in ('autorizar','cancelar','ajustar') then
    return jsonb_build_object('ok', false, 'error', 'accion_invalida');
  end if;

  select * into d from public.vp_comandas_detalles
   where id = p_detalle and user_id = auth.uid() for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'no_existe'); end if;
  if d.estado <> 'problema' then return jsonb_build_object('ok', false, 'error', 'sin_problema'); end if;

  if p_accion = 'cancelar' then
    update public.vp_comandas_detalles set estado = 'cancelado' where id = p_detalle;
  elsif p_accion = 'ajustar' then
    update public.vp_comandas_detalles
       set estado = 'pendiente',
           cantidad = greatest(0.001, least(coalesce(p_cantidad, d.cantidad), 9999)),
           nota = left(coalesce(p_nota, d.nota), 200)
     where id = p_detalle;
  else
    update public.vp_comandas_detalles
       set estado = 'pendiente', nota = left(coalesce(p_nota, d.nota), 200) where id = p_detalle;
  end if;

  perform public.vp_com_log('problema_resuelto', d.cuenta_id, d.id, 'problema', p_accion,
                            p_actor, 'caja', left(coalesce(p_nota,''),200),
                            jsonb_build_object('cantidad_antes', d.cantidad, 'cantidad_despues', p_cantidad));
  return jsonb_build_object('ok', true, 'accion', p_accion);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vp_com_tablero()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with resumen as (
    select c.id as cuenta_id,
           count(*) filter (where d.estado <> 'cancelado')                 as lineas,
           count(*) filter (where d.estado in ('pendiente','preparando'))  as en_proceso,
           count(*) filter (where d.estado = 'listo')                      as listos,
           count(*) filter (where d.estado = 'problema')                   as problemas,
           coalesce(sum(d.cantidad * d.precio) filter (where d.estado <> 'cancelado'), 0) as total,
           count(*) filter (where d.comanda_num is null and d.estado = 'por_enviar')      as por_enviar
    from public.vp_comandas_cuentas c
    left join public.vp_comandas_detalles d on d.cuenta_id = c.id
    where c.user_id = auth.uid() and c.estado in ('abierta','cuenta_pedida')
    group by c.id
  ),
  viva as (
    select c.*, r.lineas, r.en_proceso, r.listos, r.problemas, r.total as suma, r.por_enviar
    from public.vp_comandas_cuentas c
    left join resumen r on r.cuenta_id = c.id
    where c.user_id = auth.uid() and c.estado in ('abierta','cuenta_pedida')
  )
  select case when not coalesce(public.has_access(auth.uid()), false)
    then jsonb_build_object('activo', false, 'mesas', '[]'::jsonb, 'menu', '[]'::jsonb, 'areas', '[]'::jsonb)
    else jsonb_build_object(
    'activo', public.vp_com_activo(),
    'areas',  coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'nombre', a.nombre) order by a.orden, a.creado)
                        from public.vp_comandas_areas a where a.user_id = auth.uid() and a.activa), '[]'::jsonb),
    'mesas',  coalesce((select jsonb_agg(jsonb_build_object(
                          'id', m.id, 'plano_id', m.plano_id, 'nombre', m.nombre, 'zona', m.zona,
                          'capacidad', m.capacidad, 'orden', m.orden,
                          'cuenta', (select jsonb_build_object(
                                        'id', v.id, 'personas', v.personas, 'estado', v.estado,
                                        'mesero', v.mesero_nombre, 'mesero_id', v.mesero_local,
                                        'abierta_en', v.abierta_en,
                                        'total', coalesce(v.suma,0), 'lineas', coalesce(v.lineas,0),
                                        'en_proceso', coalesce(v.en_proceso,0),
                                        'listos', coalesce(v.listos,0),
                                        'problemas', coalesce(v.problemas,0),
                                        'por_enviar', coalesce(v.por_enviar,0))
                                     from viva v where v.mesa_id = m.id limit 1))
                        order by m.orden, m.nombre)
                        from public.vp_comandas_mesas m
                        where m.user_id = auth.uid() and m.activa), '[]'::jsonb),
    'menu',   coalesce((select jsonb_agg(jsonb_build_object(
                          'id', v.id, 'nombre', v.mesa_nombre, 'estado', v.estado,
                          'tipo', case when v.idem like 'libre:%' then 'libre' else 'menu' end,
                          'cliente', v.mesero_nombre, 'abierta_en', v.abierta_en,
                          'total', coalesce(v.suma,0), 'en_proceso', coalesce(v.en_proceso,0),
                          'listos', coalesce(v.listos,0), 'problemas', coalesce(v.problemas,0))
                        order by v.abierta_en)
                        from viva v where v.mesa_id is null), '[]'::jsonb),
    'problemas', coalesce((select sum(coalesce(v.problemas,0)) from viva v), 0),
    'pedidas',   coalesce((select count(*) from viva v where v.estado = 'cuenta_pedida'), 0)
  ) end;
$function$;

-- Internal helpers are called by SECURITY DEFINER RPCs.
revoke execute on function public.vp_com_log(text, uuid, uuid, text, text, text, text, text, jsonb),
  public.vp_com_area_de(jsonb), public.vp_com_producto(text)
  from public, anon, authenticated;
