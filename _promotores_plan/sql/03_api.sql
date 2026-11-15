-- =====================================================================
-- VENDOPLUS · PROMOTORES · 03 API (lo que llaman las páginas)
-- ---------------------------------------------------------------------
-- Cada función identifica a la persona con auth.uid() (el token de
-- Supabase), nunca con un id enviado por el navegador. Ninguna recibe
-- cantidades para acreditar dinero: todo se calcula en el servidor.
-- =====================================================================
begin;

-- =====================================================================
-- A. PÁGINA PÚBLICA DEL ENLACE
-- =====================================================================
-- ¿El código existe y está activo? Devuelve solo el primer nombre.
create or replace function public.promo_codigo_info(p_codigo text)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('valido', true, 'promotor', split_part(p.nombre, ' ', 1),
                               'precio_normal_cents', c.precio_normal_cents,
                               'precio_descuento_cents', round(c.precio_normal_cents * (100 - c.descuento_pct) / 100)::int,
                               'descuento_pct', c.descuento_pct)
       from public.promo_promotores p, public.promo_config c
      where c.id and c.programa_activo and p.estado = 'activo'
        and p.codigo = upper(btrim(coalesce(p_codigo, '')))),
    jsonb_build_object('valido', false))
$$;

-- =====================================================================
-- B. NEGOCIO (dueño de la cuenta de VendoPlus)
-- =====================================================================
create or replace function public.promo_mi_negocio()
returns jsonb language sql stable security definer
set search_path = public as $$
  with c as (select * from public.promo_config where id),
  n as (select * from public.promo_negocios where negocio_user_id = auth.uid())
  select case when auth.uid() is null then jsonb_build_object('asociado', false)
  else coalesce((
    select jsonb_build_object(
      'asociado', true,
      'promotor', split_part(p.nombre, ' ', 1),
      'descuento_estado', n.descuento_estado,
      -- Precio con descuento en el pago web (Stripe) solo si:
      'descuento_en_checkout', c.programa_activo and n.excluido_motivo is null and n.descuento_estado = 'checkout',
      'descuento_en_renovacion', n.descuento_estado = 'aplicado',
      'precio_normal_cents', c.precio_normal_cents,
      'precio_descuento_cents', round(c.precio_normal_cents * (100 - c.descuento_pct) / 100)::int,
      'descuento_pct', c.descuento_pct)
    from n join public.promo_promotores p on p.id = n.promotor_id, c),
    jsonb_build_object('asociado', false)) end
$$;

-- =====================================================================
-- C. PROMOTOR
-- =====================================================================
create or replace function public.promo_yo()
returns public.promo_promotores language sql stable security definer
set search_path = public as $$
  select * from public.promo_promotores where user_id = auth.uid()
$$;

-- Cualquiera con cuenta puede registrarse; queda 'pendiente' hasta que el
-- administrador lo apruebe. Su enlace no funciona mientras tanto.
create or replace function public.promo_registrar_promotor(p_nombre text, p_telefono text default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare pr public.promo_promotores; v_tel text;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para continuar' using errcode = '42501'; end if;
  select * into pr from public.promo_promotores where user_id = auth.uid();
  if found then
    return jsonb_build_object('estado', pr.estado, 'codigo', pr.codigo, 'nuevo', false);
  end if;
  if char_length(btrim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'Escribe tu nombre' using errcode = '22023';
  end if;
  v_tel := nullif(regexp_replace(coalesce(p_telefono, ''), '[^0-9+]', '', 'g'), '');
  if v_tel is not null and v_tel !~ '^\+?[0-9]{10,15}$' then
    raise exception 'El teléfono debe tener 10 dígitos' using errcode = '22023';
  end if;
  insert into public.promo_promotores (user_id, codigo, nombre, telefono, correo_snapshot)
  values (auth.uid(), public.promo_generar_codigo(), btrim(p_nombre), v_tel,
          (select email from auth.users where id = auth.uid()))
  returning * into pr;
  return jsonb_build_object('estado', pr.estado, 'codigo', pr.codigo, 'nuevo', true);
end $$;

create or replace function public.promo_mi_panel()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
declare pr public.promo_promotores; cfg public.promo_config; s record; neg jsonb;
begin
  select * into pr from public.promo_promotores where user_id = auth.uid();
  if not found then return jsonb_build_object('registrado', false); end if;
  select * into cfg from public.promo_config where id;
  select * into s from public.promo_saldos(pr.id);
  select jsonb_build_object(
           'total', count(*),
           'pagando', count(*) filter (where (e->>'pagando')::boolean),
           'cumplieron_12_meses', count(*) filter (where (e->>'cumplio_primer_anio')::boolean))
    into neg
    from (select public.promo_estado_negocio(id) e from public.promo_negocios where promotor_id = pr.id) x;
  return jsonb_build_object(
    'registrado', true, 'estado', pr.estado, 'nombre', pr.nombre, 'codigo', pr.codigo,
    'enlace', case when pr.estado = 'activo' then cfg.url_base_enlace || pr.codigo end,
    'saldos', jsonb_build_object(
       'disponible_cents', s.disponible_cents, 'pendiente_cents', s.pendiente_cents,
       'en_retiro_cents', s.en_retiro_cents, 'retirado_cents', s.retirado_cents,
       'comisiones_cents', s.comisiones_cents, 'anio1_cents', s.anio1_cents,
       'anio_extra_cents', s.anio_extra_cents, 'ajustes_cents', s.reversos_cents + s.ajustes_cents),
    'negocios', neg,
    'reglas', jsonb_build_object(
       'comision_inicial_cents', cfg.comision_inicial_cents, 'anio1_cents', cfg.recompensa_anio1_cents,
       'anio_extra_cents', cfg.recompensa_anio_extra_cents, 'dias_retencion', cfg.dias_retencion,
       'retiro_minimo_cents', cfg.retiro_minimo_cents, 'descuento_pct', cfg.descuento_pct));
end $$;

-- Lista de negocios (sin correo: privacidad del negocio). p_mes = cualquier
-- día del mes a consultar (zona horaria de la Ciudad de México).
create or replace function public.promo_mis_negocios(p_mes date default null)
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(jsonb_agg(public.promo_estado_negocio(n.id) order by n.asociado_en desc), '[]'::jsonb)
    from public.promo_negocios n
   where n.promotor_id = (select id from public.promo_promotores where user_id = auth.uid())
     and (p_mes is null
          or date_trunc('month', n.asociado_en at time zone 'America/Mexico_City') = date_trunc('month', p_mes::timestamp))
$$;

-- "Mis negocios por mes": solo para consultar; NO son metas.
create or replace function public.promo_mis_negocios_por_mes()
returns jsonb language sql stable security definer
set search_path = public as $$
  with yo as (select id from public.promo_promotores where user_id = auth.uid()),
  e as (
    select date_trunc('month', n.asociado_en at time zone 'America/Mexico_City')::date mes,
           public.promo_estado_negocio(n.id) x
      from public.promo_negocios n, yo where n.promotor_id = yo.id)
  select coalesce(jsonb_agg(jsonb_build_object(
           'mes', mes,
           'conseguidos', total,
           'siguen_pagando', pagando,
           'aun_no_cumplen_12_meses', aun_no,
           'cumplieron_primer_anio', cumplieron,
           'dejaron_de_pagar', dejaron,
           'todavia_no_pagan', sin_pagar,
           'recompensas_cents', recompensas) order by mes desc), '[]'::jsonb)
  from (
    select mes, count(*) total,
           count(*) filter (where (x->>'pagando')::boolean) pagando,
           count(*) filter (where (x->>'pagando')::boolean and not (x->>'cumplio_primer_anio')::boolean) aun_no,
           count(*) filter (where (x->>'cumplio_primer_anio')::boolean) cumplieron,
           count(*) filter (where x->>'estado' = 'Dejó de pagar') dejaron,
           count(*) filter (where (x->>'nunca_pago')::boolean) sin_pagar,
           sum((x->>'recompensas_cents')::bigint) recompensas
      from e group by mes) m
$$;

-- Datos bancarios: se valida la CLABE, se guarda cifrada, se muestra •••• 1234
create or replace function public.promo_guardar_datos_bancarios(p_titular text, p_banco text, p_clabe text)
returns jsonb language plpgsql security definer
set search_path = public, extensions as $$
declare pr public.promo_promotores; v text := regexp_replace(coalesce(p_clabe, ''), '\D', '', 'g');
begin
  select * into pr from public.promo_promotores where user_id = auth.uid() for update;
  if not found or pr.estado = 'rechazado' then raise exception 'No tienes una cuenta de promotor' using errcode = '42501'; end if;
  if exists (select 1 from public.promo_retiros where promotor_id = pr.id and estado in ('solicitado','aprobado')) then
    raise exception 'Tienes un retiro en proceso. Podrás cambiar tu cuenta cuando termine.' using errcode = '55000';
  end if;
  if not public.promo_clabe_valida(v) then
    raise exception 'La CLABE no es válida. Revisa los 18 dígitos.' using errcode = '22023';
  end if;
  if char_length(btrim(coalesce(p_titular, ''))) < 3 then raise exception 'Escribe el nombre del titular' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_banco, ''))) < 2 then raise exception 'Escribe el nombre del banco' using errcode = '22023'; end if;
  insert into public.promo_datos_bancarios (promotor_id, titular, banco, clabe_cifrada, clabe_ultimos4)
  values (pr.id, btrim(p_titular), btrim(p_banco), extensions.pgp_sym_encrypt(v, public.promo_clave_bancaria()), right(v, 4))
  on conflict (promotor_id) do update
     set titular = excluded.titular, banco = excluded.banco,
         clabe_cifrada = excluded.clabe_cifrada, clabe_ultimos4 = excluded.clabe_ultimos4;
  return jsonb_build_object('titular', btrim(p_titular), 'banco', btrim(p_banco), 'clabe', '•••• ' || right(v, 4));
end $$;

create or replace function public.promo_mis_datos_bancarios()
returns jsonb language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('titular', d.titular, 'banco', d.banco, 'clabe', '•••• ' || d.clabe_ultimos4)
       from public.promo_datos_bancarios d join public.promo_promotores p on p.id = d.promotor_id
      where p.user_id = auth.uid()),
    'null'::jsonb)
$$;

-- Retiro: el dinero queda apartado (movimiento negativo) al solicitar.
create or replace function public.promo_solicitar_retiro(p_monto_cents bigint)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare pr public.promo_promotores; cfg public.promo_config; d public.promo_datos_bancarios;
        s record; v_id uuid;
begin
  select * into pr from public.promo_promotores where user_id = auth.uid() for update;  -- serializa
  if not found then raise exception 'No tienes una cuenta de promotor' using errcode = '42501'; end if;
  if pr.estado <> 'activo' then raise exception 'Tu cuenta de promotor no está activa' using errcode = '42501'; end if;
  select * into cfg from public.promo_config where id;
  select * into d from public.promo_datos_bancarios where promotor_id = pr.id;
  if not found then raise exception 'Primero registra tu cuenta bancaria' using errcode = '55000'; end if;
  if exists (select 1 from public.promo_retiros where promotor_id = pr.id and estado in ('solicitado','aprobado')) then
    raise exception 'Ya tienes una solicitud de retiro en proceso' using errcode = '55000';
  end if;
  if p_monto_cents is null or p_monto_cents < cfg.retiro_minimo_cents then
    raise exception 'El retiro mínimo es de $%', to_char(cfg.retiro_minimo_cents / 100.0, 'FM999,990.00') using errcode = '22023';
  end if;
  select * into s from public.promo_saldos(pr.id);
  if p_monto_cents > s.disponible_cents then
    raise exception 'No tienes saldo disponible suficiente' using errcode = '22023';
  end if;
  insert into public.promo_retiros (promotor_id, monto_cents, titular, banco, clabe_ultimos4)
  values (pr.id, p_monto_cents, d.titular, d.banco, d.clabe_ultimos4)
  returning id into v_id;
  perform public.promo_mover(pr.id, 'retiro', -p_monto_cents, public.promo_ahora(),
            'retiro:' || v_id, 'Solicitud de retiro', null, v_id, null, auth.uid());
  return jsonb_build_object('retiro_id', v_id, 'estado', 'solicitado', 'monto_cents', p_monto_cents);
end $$;

create or replace function public.promo_cancelar_retiro(p_retiro uuid)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare r public.promo_retiros;
begin
  select r2.* into r from public.promo_retiros r2 join public.promo_promotores p on p.id = r2.promotor_id
   where r2.id = p_retiro and p.user_id = auth.uid() for update of r2;
  if not found then raise exception 'Solicitud no encontrada' using errcode = '42501'; end if;
  if r.estado <> 'solicitado' then raise exception 'Esta solicitud ya no se puede cancelar' using errcode = '55000'; end if;
  update public.promo_retiros set estado = 'cancelado', cancelado_en = now() where id = r.id;
  perform public.promo_mover(r.promotor_id, 'retiro_devuelto', r.monto_cents, public.promo_ahora(),
            'retiro_devuelto:' || r.id, 'Retiro cancelado: el dinero regresó a tu saldo', null, r.id, null, auth.uid());
  return jsonb_build_object('estado', 'cancelado');
end $$;

-- =====================================================================
-- D. ADMINISTRADOR MAESTRO (todas verifican promo_es_admin() en el servidor)
-- =====================================================================
create or replace function public.promo_auditar(
  p_accion text, p_tabla text, p_registro text, p_antes jsonb, p_despues jsonb,
  p_monto_antes bigint, p_monto_despues bigint, p_motivo text)
returns void language sql security definer
set search_path = public as $$
  insert into public.promo_auditoria
    (admin_id, accion, tabla, registro_id, valor_anterior, valor_nuevo, monto_anterior_cents, monto_nuevo_cents, motivo)
  values (auth.uid(), p_accion, p_tabla, p_registro, p_antes, p_despues, p_monto_antes, p_monto_despues, p_motivo)
$$;

create or replace function public.promo_admin_promotores()
returns jsonb language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.promo_admin_requerir();
  return (
    select coalesce(jsonb_agg(x order by x->>'creado_en' desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'id', p.id, 'nombre', p.nombre, 'correo', coalesce(u.email, p.correo_snapshot), 'telefono', p.telefono,
        'creado_en', p.creado_en, 'estado', p.estado, 'motivo_estado', p.motivo_estado, 'codigo', p.codigo,
        'enlace', c.url_base_enlace || p.codigo,
        'negocios', (select count(*) from public.promo_negocios where promotor_id = p.id),
        'negocios_pagando', (select count(*) from public.promo_negocios n
                              where n.promotor_id = p.id and (public.promo_estado_negocio(n.id)->>'pagando')::boolean),
        'cumplieron_12_meses', (select count(distinct negocio_id) from public.promo_recompensas
                                 where promotor_id = p.id and tipo = 'aniversario' and estado = 'acreditada'),
        'saldos', (select to_jsonb(s) from public.promo_saldos(p.id) s),
        'retiros_solicitados', (select count(*) from public.promo_retiros where promotor_id = p.id),
        'retiros_pagados', (select count(*) from public.promo_retiros where promotor_id = p.id and estado = 'pagado')) x
      from public.promo_promotores p
      left join auth.users u on u.id = p.user_id
      cross join public.promo_config c where c.id) t);
end $$;

create or replace function public.promo_admin_negocios(p_promotor uuid default null)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.promo_admin_requerir();
  return (
    select coalesce(jsonb_agg(
      public.promo_estado_negocio(n.id) || jsonb_build_object(
        'correo', coalesce(u.email, n.correo_snapshot),
        'promotor_id', p.id, 'promotor', p.nombre,
        'origen', n.origen,
        'proveedor', case when n.excluido_motivo is not null then 'google_play'
                          when exists (select 1 from public.promo_pagos where negocio_id = n.id) then 'stripe'
                          else 'sin_pago' end,
        'descuento_estado', n.descuento_estado, 'descuento_nota', n.descuento_nota,
        'primer_pago_previo_en', n.primer_pago_previo_en)
      order by n.asociado_en desc), '[]'::jsonb)
    from public.promo_negocios n
    join public.promo_promotores p on p.id = n.promotor_id
    left join auth.users u on u.id = n.negocio_user_id
    where p_promotor is null or n.promotor_id = p_promotor);
end $$;

create or replace function public.promo_admin_detalle_negocio(p_negocio uuid)
returns jsonb language plpgsql stable security definer
set search_path = public as $$
begin
  perform public.promo_admin_requerir();
  return jsonb_build_object(
    'estado', public.promo_estado_negocio(p_negocio),
    'pagos', (select coalesce(jsonb_agg(to_jsonb(pg) order by pg.periodo_inicio), '[]') from public.promo_pagos pg where negocio_id = p_negocio),
    'suscripciones', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from public.promo_suscripciones s where negocio_id = p_negocio),
    'tramos_pagados', (select coalesce(jsonb_agg(to_jsonb(t)), '[]') from public.promo_segmentos(p_negocio) t),
    'recompensas', (select coalesce(jsonb_agg(to_jsonb(r) order by r.creada_en), '[]') from public.promo_recompensas r where negocio_id = p_negocio));
end $$;

create or replace function public.promo_admin_promotor_estado(p_promotor uuid, p_estado text, p_motivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_admin uuid := public.promo_admin_requerir(); antes public.promo_promotores;
begin
  if p_estado not in ('activo','suspendido','rechazado') then raise exception 'Estado no válido' using errcode = '22023'; end if;
  select * into antes from public.promo_promotores where id = p_promotor for update;
  if not found then raise exception 'Promotor no encontrado'; end if;
  update public.promo_promotores
     set estado = p_estado, motivo_estado = p_motivo, estado_por = v_admin, estado_en = now()
   where id = p_promotor;
  perform public.promo_auditar('promotor_' || p_estado, 'promo_promotores', p_promotor::text,
            jsonb_build_object('estado', antes.estado), jsonb_build_object('estado', p_estado), null, null, p_motivo);
  return jsonb_build_object('estado', p_estado);
end $$;

create or replace function public.promo_admin_retiro(p_retiro uuid, p_accion text, p_motivo text,
                                                     p_referencia text default null, p_pagado_en timestamptz default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_admin uuid := public.promo_admin_requerir(); r public.promo_retiros; v_nuevo text;
begin
  select * into r from public.promo_retiros where id = p_retiro for update;
  if not found then raise exception 'Solicitud no encontrada'; end if;
  if p_accion = 'aprobar' and r.estado = 'solicitado' then
    v_nuevo := 'aprobado';
    update public.promo_retiros set estado = v_nuevo, aprobado_en = now(), aprobado_por = v_admin where id = r.id;
  elsif p_accion = 'pagado' and r.estado = 'aprobado' then
    if coalesce(btrim(p_referencia), '') = '' then raise exception 'Escribe la referencia de la transferencia'; end if;
    v_nuevo := 'pagado';
    update public.promo_retiros
       set estado = v_nuevo, pagado_en = coalesce(p_pagado_en, now()), pagado_por = v_admin, referencia_pago = btrim(p_referencia)
     where id = r.id;
    -- No hay movimiento: el dinero ya se descontó al solicitar (no se descuenta dos veces).
  elsif p_accion = 'rechazar' and r.estado in ('solicitado','aprobado') then
    v_nuevo := 'rechazado';
    update public.promo_retiros
       set estado = v_nuevo, rechazado_en = now(), rechazado_por = v_admin, motivo_rechazo = p_motivo
     where id = r.id;
    perform public.promo_mover(r.promotor_id, 'retiro_devuelto', r.monto_cents, public.promo_ahora(),
              'retiro_devuelto:' || r.id, 'Retiro rechazado: ' || p_motivo, null, r.id, null, v_admin);
  else
    raise exception 'No se puede % una solicitud en estado %', p_accion, r.estado using errcode = '55000';
  end if;
  perform public.promo_auditar('retiro_' || p_accion, 'promo_retiros', r.id::text,
            jsonb_build_object('estado', r.estado), jsonb_build_object('estado', v_nuevo, 'referencia', p_referencia),
            r.monto_cents, r.monto_cents, p_motivo);
  return jsonb_build_object('estado', v_nuevo);
end $$;

-- Exportación CSV: devuelve filas; la página arma el archivo. Queda auditado.
create or replace function public.promo_admin_exportar_retiros(p_estados text[] default array['solicitado','aprobado'])
returns table (retiro_id uuid, promotor text, correo text, titular text, banco text, clabe text,
               monto_mxn numeric, estado text, solicitado_en timestamptz)
language plpgsql security definer
set search_path = public, extensions as $$
declare v_key text;
begin
  perform public.promo_admin_requerir();
  v_key := public.promo_clave_bancaria();
  perform public.promo_auditar('exportar_retiros', 'promo_retiros', array_to_string(p_estados, ','),
            null, jsonb_build_object('filas', (select count(*) from public.promo_retiros where estado = any(p_estados))),
            null, null, 'Exportación CSV de solicitudes de retiro');
  return query
    select r.id, p.nombre, coalesce(u.email, p.correo_snapshot), d.titular, d.banco,
           extensions.pgp_sym_decrypt(d.clabe_cifrada, v_key),
           round(r.monto_cents / 100.0, 2), r.estado, r.solicitado_en
      from public.promo_retiros r
      join public.promo_promotores p on p.id = r.promotor_id
      left join auth.users u on u.id = p.user_id
      left join public.promo_datos_bancarios d on d.promotor_id = r.promotor_id
     where r.estado = any(p_estados)
     order by r.solicitado_en;
end $$;

-- Ajuste manual (corregir errores). Siempre con motivo y auditoría.
create or replace function public.promo_admin_ajuste(p_promotor uuid, p_monto_cents bigint, p_motivo text,
                                                     p_negocio uuid default null)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_admin uuid := public.promo_admin_requerir(); antes record; despues record; v_id bigint;
begin
  if p_monto_cents is null or p_monto_cents = 0 then raise exception 'El monto no puede ser cero'; end if;
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo del ajuste'; end if;
  perform 1 from public.promo_promotores where id = p_promotor for update;
  if not found then raise exception 'Promotor no encontrado'; end if;
  select * into antes from public.promo_saldos(p_promotor);
  v_id := public.promo_mover(p_promotor, 'ajuste_admin', p_monto_cents, public.promo_ahora(),
            'ajuste:' || gen_random_uuid(), 'Ajuste: ' || p_motivo, null, null, p_negocio, v_admin);
  select * into despues from public.promo_saldos(p_promotor);
  perform public.promo_auditar('ajuste_saldo', 'promo_movimientos', v_id::text,
            jsonb_build_object('disponible_cents', antes.disponible_cents),
            jsonb_build_object('disponible_cents', despues.disponible_cents, 'monto_cents', p_monto_cents),
            antes.disponible_cents, despues.disponible_cents, p_motivo);
  return jsonb_build_object('movimiento_id', v_id, 'disponible_antes', antes.disponible_cents, 'disponible_despues', despues.disponible_cents);
end $$;

create or replace function public.promo_admin_recompensa(p_recompensa uuid, p_accion text, p_motivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_admin uuid := public.promo_admin_requerir(); r public.promo_recompensas; v_ok boolean;
begin
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo'; end if;
  select * into r from public.promo_recompensas where id = p_recompensa;
  if not found then raise exception 'Recompensa no encontrada'; end if;
  if p_accion = 'revertir' then
    v_ok := public.promo_revertir_interno(r.id, 'admin:' || p_motivo, v_admin);
  elsif p_accion = 'reacreditar' then
    v_ok := public.promo_reacreditar_interno(r.id, v_admin);
  else raise exception 'Acción no válida'; end if;
  if not v_ok then raise exception 'La recompensa ya estaba en ese estado'; end if;
  perform public.promo_auditar('recompensa_' || p_accion, 'promo_recompensas', r.id::text,
            jsonb_build_object('estado', r.estado),
            jsonb_build_object('estado', case when p_accion = 'revertir' then 'revertida' else 'acreditada' end),
            case when r.estado = 'acreditada' then r.monto_cents else 0 end,
            case when p_accion = 'revertir' then 0 else r.monto_cents end, p_motivo);
  return jsonb_build_object('ok', true);
end $$;

-- Cambio de promotor de un negocio: solo el administrador, siempre auditado.
-- Lo ya acreditado se queda con el promotor anterior; lo nuevo va al nuevo.
create or replace function public.promo_admin_reasignar_negocio(p_negocio uuid, p_promotor_nuevo uuid, p_motivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_admin uuid := public.promo_admin_requerir(); n public.promo_negocios; pr public.promo_promotores;
begin
  if char_length(btrim(coalesce(p_motivo, ''))) < 5 then raise exception 'Escribe el motivo'; end if;
  select * into n from public.promo_negocios where id = p_negocio for update;
  if not found then raise exception 'Negocio no encontrado'; end if;
  select * into pr from public.promo_promotores where id = p_promotor_nuevo;
  if not found then raise exception 'Promotor no encontrado'; end if;
  if pr.user_id = n.negocio_user_id then raise exception 'Un promotor no puede ser su propio negocio'; end if;
  update public.promo_negocios set promotor_id = p_promotor_nuevo where id = p_negocio;
  insert into public.promo_atribuciones (codigo, promotor_id, negocio_user_id, resultado, motivo, detalle)
  values (pr.codigo, pr.id, n.negocio_user_id, 'reasignado_admin', 'admin',
          jsonb_build_object('anterior', n.promotor_id, 'motivo', p_motivo, 'admin', v_admin));
  perform public.promo_auditar('reasignar_negocio', 'promo_negocios', p_negocio::text,
            jsonb_build_object('promotor_id', n.promotor_id), jsonb_build_object('promotor_id', p_promotor_nuevo),
            null, null, p_motivo);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.promo_admin_reprocesar(p_negocio uuid, p_motivo text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_res jsonb;
begin
  perform public.promo_admin_requerir();
  v_res := public.promo_procesar_negocio(p_negocio);
  perform public.promo_auditar('reprocesar_negocio', 'promo_negocios', p_negocio::text, null, v_res, null, null,
            coalesce(nullif(btrim(p_motivo), ''), 'Revisión manual'));
  return v_res;
end $$;

commit;
