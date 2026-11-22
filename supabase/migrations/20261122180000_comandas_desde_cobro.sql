create function public.vp_com_enviar_desde_caja(
  p_cuenta uuid, p_plano text, p_referencia text, p_lineas jsonb,
  p_actor_id text, p_actor text, p_idem text
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  negocio uuid := auth.uid();
  cuenta uuid := p_cuenta;
  mesa uuid;
  respuesta jsonb;
  clave text := 'caja:' || nullif(left(p_idem, 60), '');
begin
  if negocio is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not public.vp_com_activo() or not exists (
    select 1 from public.vp_comandas_config where user_id = negocio and area_cocina
  ) then return jsonb_build_object('ok', false, 'error', 'cocina_apagada'); end if;
  if clave is null then return jsonb_build_object('ok', false, 'error', 'linea_invalida'); end if;

  if cuenta is null then
    -- Serializa los reintentos del mismo envío y recupera el resultado ya confirmado.
    perform pg_advisory_xact_lock(hashtextextended(negocio::text || clave, 2));
    select cuenta_id, jsonb_build_object('ok', true, 'cuenta', cuenta_id, 'comanda', comanda_num)
      into cuenta, respuesta
      from public.vp_comandas_detalles
      where user_id = negocio and idem = clave and comanda_num is not null;
    if found then return respuesta; end if;

    if p_plano is not null then
      perform public.vp_com_sincronizar_plano();
      select id into mesa from public.vp_comandas_mesas
        where user_id = negocio and plano_id = p_plano and activa;
      if mesa is null then return jsonb_build_object('ok', false, 'error', 'mesa_no_existe'); end if;
      respuesta := public.vp_com_mesa_abrir(mesa, 1, p_actor_id, p_actor, clave);
    else
      respuesta := public.vp_com_venta_libre(p_actor_id, p_actor, left(p_idem, 60));
    end if;
    if not coalesce((respuesta->>'ok')::boolean, false) then return respuesta; end if;
    cuenta := (respuesta->>'cuenta')::uuid;
    if mesa is null and nullif(btrim(p_referencia), '') is not null then
      update public.vp_comandas_cuentas set mesa_nombre = left(btrim(p_referencia), 60)
        where id = cuenta and user_id = negocio;
    end if;

    respuesta := public.vp_com_agregar(cuenta, p_lineas, p_actor, clave);
    if not coalesce((respuesta->>'ok')::boolean, false) then
      raise sqlstate 'VP001';
    end if;
  end if;

  respuesta := public.vp_com_enviar(cuenta, p_actor, clave);
  if not coalesce((respuesta->>'ok')::boolean, false) then raise sqlstate 'VP001'; end if;
  return respuesta || jsonb_build_object('cuenta', cuenta);
exception when sqlstate 'VP001' then
  -- Revierte la apertura o las líneas parciales si falla el envío.
  return respuesta;
end;
$$;

revoke execute on function public.vp_com_enviar_desde_caja(uuid,text,text,jsonb,text,text,text) from public, anon;
grant execute on function public.vp_com_enviar_desde_caja(uuid,text,text,jsonb,text,text,text) to authenticated;
