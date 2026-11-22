alter table public.vp_comandas_mesas add column plano_id text;

create function public.vp_com_sincronizar_plano()
returns void language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  negocio uuid := auth.uid();
  plano jsonb;
begin
  if negocio is null or not public.vp_com_activo() then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(negocio::text, 1));

  select value::jsonb->'j' into plano
  from public.user_data where user_id = negocio and key = 'mesa_plano';
  if jsonb_typeof(plano) is distinct from 'array' then
    plano := '[{"id":"m1","name":"Mesa 1"},{"id":"m2","name":"Mesa 2"},{"id":"m3","name":"Mesa 3"},{"id":"m4","name":"Mesa 4"},{"id":"m5","name":"Mesa 5"},{"id":"bar","name":"Bar"}]';
  end if;

  insert into public.vp_comandas_mesas as mesa (user_id, plano_id, nombre, orden)
  select negocio, t->>'id', left(btrim(t->>'name'), 60), ord::integer
  from jsonb_array_elements(plano) with ordinality as p(t, ord)
  where ord <= 16 and nullif(t->>'id', '') is not null and nullif(btrim(t->>'name'), '') is not null
  on conflict (user_id, lower(btrim(nombre))) do update
  set plano_id = excluded.plano_id, orden = excluded.orden, activa = true
  where (mesa.plano_id, mesa.orden, mesa.activa)
     is distinct from (excluded.plano_id, excluded.orden, true);

  update public.vp_comandas_mesas m set activa = false
  where m.user_id = negocio and m.activa and m.plano_id is not null
    and not exists (select 1 from jsonb_array_elements(plano) t where t->>'id' = m.plano_id)
    and not exists (
      select 1 from public.vp_comandas_cuentas c
      where c.mesa_id = m.id and c.estado in ('abierta', 'cuenta_pedida')
    );
end;
$$;

create function public.vp_com_venta_libre(p_mesero_id text, p_mesero text, p_idem text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  negocio uuid := auth.uid();
  cuenta_id uuid;
  clave text := 'libre:' || nullif(left(p_idem, 80), '');
begin
  if negocio is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not public.vp_com_activo() then return jsonb_build_object('ok', false, 'error', 'sin_premium'); end if;
  if clave is null then return jsonb_build_object('ok', false, 'error', 'linea_invalida'); end if;

  insert into public.vp_comandas_cuentas (user_id, mesa_nombre, mesero_local, mesero_nombre, idem)
  values (negocio, 'Venta libre', left(coalesce(p_mesero_id, ''), 60), left(coalesce(p_mesero, ''), 60), clave)
  on conflict (user_id, idem) where idem is not null do nothing
  returning id into cuenta_id;

  if cuenta_id is null then
    select id into cuenta_id from public.vp_comandas_cuentas where user_id = negocio and idem = clave;
  end if;
  return jsonb_build_object('ok', true, 'cuenta', cuenta_id);
end;
$$;

revoke execute on function public.vp_com_sincronizar_plano(), public.vp_com_venta_libre(text, text, text) from public, anon;
grant execute on function public.vp_com_sincronizar_plano(), public.vp_com_venta_libre(text, text, text) to authenticated;

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
  select jsonb_build_object(
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
  );
$function$;
