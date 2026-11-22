create function public.vp_com_enviar_desde_mesero(
  p_cuenta uuid, p_actor text, p_idem text, p_lineas jsonb
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp
as $$
declare
  negocio uuid := auth.uid();
  clave text := 'mesero:' || nullif(left(p_idem, 60), '');
  respuesta jsonb;
begin
  if negocio is null then return jsonb_build_object('ok', false, 'error', 'sin_sesion'); end if;
  if not public.vp_com_activo() or not exists (
    select 1 from public.vp_comandas_config where user_id = negocio and area_mesero
  ) then return jsonb_build_object('ok', false, 'error', 'mesero_apagado'); end if;
  if clave is null or jsonb_typeof(p_lineas) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'linea_invalida');
  end if;

  perform 1 from public.vp_comandas_cuentas
    where id = p_cuenta and user_id = negocio for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'cuenta_no_existe'); end if;

  select jsonb_build_object('ok', true, 'comanda', comanda_num)
    into respuesta from public.vp_comandas_detalles
    where user_id = negocio and cuenta_id = p_cuenta and idem = clave and comanda_num is not null;
  if found then return respuesta; end if;

  if jsonb_array_length(p_lineas) > 0 then
    respuesta := public.vp_com_agregar(p_cuenta, p_lineas, p_actor, clave);
    if not coalesce((respuesta->>'ok')::boolean, false) then raise sqlstate 'VP001'; end if;
  end if;
  respuesta := public.vp_com_enviar(p_cuenta, p_actor, clave);
  if not coalesce((respuesta->>'ok')::boolean, false) then raise sqlstate 'VP001'; end if;

  return respuesta;
exception when sqlstate 'VP001' then
  return respuesta;
end;
$$;

revoke execute on function public.vp_com_enviar_desde_mesero(uuid,text,text,jsonb) from public, anon;
grant execute on function public.vp_com_enviar_desde_mesero(uuid,text,text,jsonb) to authenticated;
