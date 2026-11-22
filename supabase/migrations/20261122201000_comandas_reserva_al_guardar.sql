create function public.vp_com_guardar_mesa_mesero(
  p_mesa uuid, p_cuenta uuid, p_personas integer, p_actor_id text,
  p_actor text, p_idem text, p_lineas jsonb, p_enviar boolean
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  negocio uuid := auth.uid();
  cuenta uuid := p_cuenta;
  clave text := 'pedido-mesa:' || nullif(left(p_idem, 60), '');
  respuesta jsonb;
begin
  if negocio is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not public.vp_com_activo() or not exists (
    select 1 from public.vp_comandas_config where user_id = negocio and area_mesero
  ) then return jsonb_build_object('ok', false, 'error', 'mesero_apagado'); end if;
  if clave is null or jsonb_typeof(p_lineas) is distinct from 'array' or p_enviar is null
     or (p_mesa is null) = (p_cuenta is null) then
    return jsonb_build_object('ok', false, 'error', 'linea_invalida');
  end if;
  if p_enviar and p_mesa is not null and jsonb_array_length(p_lineas) = 0 then
    return jsonb_build_object('ok', false, 'error', 'nada_por_enviar');
  end if;

  if cuenta is null then
    perform pg_advisory_xact_lock(hashtextextended(negocio::text || clave, 3));
    respuesta := public.vp_com_mesa_abrir(p_mesa, p_personas, p_actor_id, p_actor, clave);
    if not coalesce((respuesta->>'ok')::boolean, false) then return respuesta; end if;
    cuenta := (respuesta->>'cuenta')::uuid;
  end if;

  perform 1 from public.vp_comandas_cuentas
    where id = cuenta and user_id = negocio and estado in ('abierta', 'cuenta_pedida') for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'cuenta_cerrada'); end if;

  if p_enviar then
    respuesta := public.vp_com_enviar_desde_mesero(cuenta, p_actor, clave, p_lineas);
  elsif jsonb_array_length(p_lineas) > 0 then
    respuesta := public.vp_com_agregar(cuenta, p_lineas, p_actor, clave);
  else
    respuesta := jsonb_build_object('ok', true);
  end if;
  if not coalesce((respuesta->>'ok')::boolean, false) then raise sqlstate 'VP001'; end if;
  return respuesta || jsonb_build_object('cuenta', cuenta);
exception when sqlstate 'VP001' then
  -- Un fallo al agregar o enviar revierte también la apertura de la mesa.
  return respuesta;
end;
$$;

revoke execute on function public.vp_com_guardar_mesa_mesero(uuid,uuid,integer,text,text,text,jsonb,boolean) from public, anon;
grant execute on function public.vp_com_guardar_mesa_mesero(uuid,uuid,integer,text,text,text,jsonb,boolean) to authenticated;
