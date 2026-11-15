-- =====================================================================
-- VENDOPLUS · PROMOTORES · 02 MOTOR (funciones internas)
-- ---------------------------------------------------------------------
-- Todas son SECURITY DEFINER con search_path fijo. Ninguna escribe en
-- tablas existentes: solo LEEN profiles, user_data, auth.users y las tres
-- tablas de compras de Google Play. Escriben únicamente en promo_*.
-- Permisos de ejecución: ver 04_seguridad.sql (estas quedan solo para
-- service_role / dueño; el navegador no puede llamarlas).
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- Reloj del programa. En producción = now().
-- Solo en una sesión directa de base de datos (pruebas, nunca vía API)
-- se puede simular la fecha con:  set local promo.ahora = '2028-01-16';
-- Las peticiones de la API (PostgREST) entran como 'authenticator' y
-- siempre obtienen now().
-- ---------------------------------------------------------------------
create or replace function public.promo_ahora()
returns timestamptz language plpgsql stable as $$
declare v text;
begin
  if session_user not in ('authenticator','anon','authenticated','service_role') then
    v := current_setting('promo.ahora', true);
    if v is not null and v <> '' then return v::timestamptz; end if;
  end if;
  return now();
end $$;

create or replace function public.promo_cfg()
returns public.promo_config language sql stable security definer
set search_path = public as $$ select * from public.promo_config where id $$;

create or replace function public.promo_es_admin()
returns boolean language sql stable security definer
set search_path = public as $$
  select auth.uid() is not null
     and exists (select 1 from public.promo_admins where user_id = auth.uid())
$$;

create or replace function public.promo_admin_requerir()
returns uuid language plpgsql stable security definer
set search_path = public as $$
begin
  if not public.promo_es_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

-- Código de 8 caracteres, alfabeto de 32 símbolos (distribución uniforme)
create or replace function public.promo_generar_codigo()
returns text language plpgsql volatile
set search_path = public, extensions as $$
declare
  alf constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea; c text; i int;
begin
  loop
    b := extensions.gen_random_bytes(8); c := '';
    for i in 0..7 loop
      c := c || substr(alf, (get_byte(b, i) % 32) + 1, 1);
    end loop;
    exit when not exists (select 1 from public.promo_promotores where codigo = c);
  end loop;
  return c;
end $$;

-- CLABE: 18 dígitos y dígito de control (pesos 3,7,1)
create or replace function public.promo_clabe_valida(p text)
returns boolean language plpgsql immutable as $$
declare
  pesos constant int[] := array[3,7,1,3,7,1,3,7,1,3,7,1,3,7,1,3,7];
  s int := 0; i int;
begin
  if p is null or p !~ '^[0-9]{18}$' then return false; end if;
  for i in 1..17 loop
    s := s + ((substr(p, i, 1)::int * pesos[i]) % 10);
  end loop;
  return ((10 - (s % 10)) % 10) = substr(p, 18, 1)::int;
end $$;

-- Llave para cifrar CLABEs (vive en Vault, nunca en el código)
create or replace function public.promo_clave_bancaria()
returns text language plpgsql stable security definer
set search_path = public as $$
declare k text;
begin
  select decrypted_secret into k from vault.decrypted_secrets where name = 'promo_clave_bancaria';
  if k is null or length(k) < 32 then
    raise exception 'Falta configurar el secreto promo_clave_bancaria en Vault';
  end if;
  return k;
end $$;

-- Nombre del negocio (solo lectura de user_data)
create or replace function public.promo_nombre_negocio(p_user uuid)
returns text language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(btrim(value->'j'->'business'->>'name'), ''),
                     nullif(btrim(value->'j'->>'name'), ''))
       from public.user_data where user_id = p_user and key = 'mesa_user'),
    'Negocio sin nombre')
$$;

-- Primer pago de Google Play (solo lectura de las 3 tablas existentes).
-- Si profiles dice que pagó por Play pero no hay filas de compra, se usa la
-- fecha de actualización como cota (conservador).
create or replace function public.promo_primer_pago_play(p_user uuid)
returns timestamptz language sql stable security definer
set search_path = public as $$
  select coalesce(
    (select min(t) from (
        select min(created_at) t from public.vp_play_compras       where user_id = p_user and not coalesce(test_purchase, false)
        union all
        select min(created_at)   from public.play_purchases        where user_id = p_user and not coalesce(test_purchase, false)
        union all
        select min(created_at)   from public.google_play_purchases where user_id = p_user and not coalesce(test_purchase, false)
     ) x),
    (select least(case when vp_play_pagado_hasta is not null then coalesce(vp_play_actualizado, now()) end,
                  case when play_paid_until      is not null then coalesce(play_updated_at,     now()) end)
       from public.profiles where user_id = p_user)
  )
$$;

-- ---------------------------------------------------------------------
-- LIBRO CONTABLE: único punto de escritura. Idempotente por "clave".
-- ---------------------------------------------------------------------
create or replace function public.promo_mover(
  p_promotor uuid, p_tipo text, p_monto bigint, p_disponible timestamptz,
  p_clave text, p_desc text,
  p_recompensa uuid default null, p_retiro uuid default null,
  p_negocio uuid default null, p_por uuid default null)
returns bigint language plpgsql security definer
set search_path = public as $$
declare v_id bigint;
begin
  insert into public.promo_movimientos
    (promotor_id, tipo, monto_cents, disponible_desde, recompensa_id, retiro_id, negocio_id, clave, descripcion, creado_por)
  values
    (p_promotor, p_tipo, p_monto, p_disponible, p_recompensa, p_retiro, p_negocio, p_clave, p_desc, p_por)
  on conflict (clave) do nothing
  returning id into v_id;
  return v_id;   -- null = ya existía (no se duplica)
end $$;

-- Saldos: se CALCULAN del libro; no existe un campo "saldo" editable.
create or replace function public.promo_saldos(p_promotor uuid)
returns table (
  disponible_cents bigint, pendiente_cents bigint, en_retiro_cents bigint, retirado_cents bigint,
  comisiones_cents bigint, anio1_cents bigint, anio_extra_cents bigint,
  reversos_cents bigint, ajustes_cents bigint)
language sql stable security definer
set search_path = public as $$
  with a as (select public.promo_ahora() t),
  m as (
    select coalesce(sum(mv.monto_cents) filter (where mv.disponible_desde <= a.t), 0)::bigint disp,
           coalesce(sum(mv.monto_cents) filter (where mv.disponible_desde >  a.t), 0)::bigint pend,
           coalesce(sum(mv.monto_cents) filter (where mv.tipo = 'reverso'), 0)::bigint rev,
           coalesce(sum(mv.monto_cents) filter (where mv.tipo = 'ajuste_admin'), 0)::bigint aj
      from a left join public.promo_movimientos mv on mv.promotor_id = p_promotor
  ),
  r as (
    select coalesce(sum(monto_cents) filter (where tipo = 'comision_inicial'), 0)::bigint com,
           coalesce(sum(monto_cents) filter (where tipo = 'aniversario' and numero_aniversario = 1), 0)::bigint a1,
           coalesce(sum(monto_cents) filter (where tipo = 'aniversario' and numero_aniversario > 1), 0)::bigint ax
      from public.promo_recompensas where promotor_id = p_promotor and estado = 'acreditada'
  ),
  t as (
    select coalesce(sum(monto_cents) filter (where estado in ('solicitado','aprobado')), 0)::bigint en_ret,
           coalesce(sum(monto_cents) filter (where estado = 'pagado'), 0)::bigint pagado
      from public.promo_retiros where promotor_id = p_promotor
  )
  select m.disp, m.pend, t.en_ret, t.pagado, r.com, r.a1, r.ax, m.rev, m.aj from m, r, t
$$;

-- ---------------------------------------------------------------------
-- COBERTURA: periodos de servicio PAGADOS y VÁLIDOS, unidos en tramos
-- continuos. Un hueco mayor que la tolerancia corta el tramo.
-- Si una suscripción terminó antes de que acabara su periodo pagado
-- (cancelación inmediata), la cobertura se corta en terminada_en.
-- ---------------------------------------------------------------------
create or replace function public.promo_segmentos(p_negocio uuid)
returns table (inicio timestamptz, fin timestamptz)
language sql stable security definer
set search_path = public as $$
  with tol as (select tolerancia_cobertura t from public.promo_config where id),
  p as (
    select pg.periodo_inicio s,
           least(pg.periodo_fin, coalesce(su.terminada_en, 'infinity'::timestamptz)) e
      from public.promo_pagos pg
      left join public.promo_suscripciones su on su.stripe_subscription_id = pg.stripe_subscription_id
     where pg.negocio_id = p_negocio and pg.valido
  ),
  p2 as (select s, e from p where e > s),
  marcado as (
    select s, e,
           case when s > max(e) over (order by s, e rows between unbounded preceding and 1 preceding)
                         + (select t from tol)
                then 1 else 0 end nuevo
      from p2
  ),
  grupos as (select s, e, sum(nuevo) over (order by s, e) g from marcado)
  select min(s), max(e) from grupos group by g order by 1
$$;

create or replace function public.promo_cubierto(p_negocio uuid, p_desde timestamptz, p_hasta timestamptz)
returns boolean language sql stable security definer
set search_path = public as $$
  select exists (
    select 1 from public.promo_segmentos(p_negocio) s, public.promo_config c
     where c.id
       and s.inicio <= p_desde + c.tolerancia_cobertura
       and s.fin + c.tolerancia_cobertura >= p_hasta)
$$;

-- Causa por la que una recompensa dejó de ser válida
create or replace function public.promo_causa_invalidez(p_rec uuid)
returns text language sql stable security definer
set search_path = public as $$
  with r as (select * from public.promo_recompensas where id = p_rec),
  pg as (
    select pg.* from public.promo_pagos pg, r
     where (r.tipo = 'comision_inicial' and pg.stripe_invoice_id = r.stripe_invoice_id)
        or (r.tipo = 'aniversario' and pg.negocio_id = r.negocio_id
            and tstzrange(pg.periodo_inicio, pg.periodo_fin) && tstzrange(r.ventana_desde, r.ventana_hasta))
  )
  select case
    when exists (select 1 from pg where monto_reembolsado_cents >= monto_pagado_cents and monto_pagado_cents > 0) then 'reembolso'
    when exists (select 1 from pg where disputa_estado = 'perdida') then 'disputa_perdida'
    when exists (select 1 from pg where disputa_estado = 'abierta') then 'disputa'
    else 'cobertura' end
$$;

create or replace function public.promo_revertir_interno(p_rec uuid, p_motivo text, p_por uuid)
returns boolean language plpgsql security definer
set search_path = public as $$
declare r public.promo_recompensas; v_orig timestamptz; v_n int; v_ahora timestamptz := public.promo_ahora();
begin
  select * into r from public.promo_recompensas where id = p_rec for update;
  if not found or r.estado = 'revertida' then return false; end if;
  select disponible_desde into v_orig from public.promo_movimientos
   where recompensa_id = r.id and monto_cents > 0 order by id desc limit 1;
  select count(*) + 1 into v_n from public.promo_movimientos where recompensa_id = r.id and tipo = 'reverso';
  -- Si el dinero aún estaba pendiente, el reverso se anula dentro de "pendiente";
  -- si ya estaba disponible, se descuenta ahora (puede dejar saldo negativo que
  -- se compensa con ganancias futuras).
  perform public.promo_mover(r.promotor_id, 'reverso', -r.monto_cents,
            greatest(coalesce(v_orig, v_ahora), v_ahora),
            'reverso:' || r.id || ':' || v_n,
            'Ajuste por ' || replace(p_motivo, 'automatico:', ''),
            r.id, null, r.negocio_id, p_por);
  update public.promo_recompensas
     set estado = 'revertida', motivo_reverso = p_motivo, revertida_en = v_ahora
   where id = r.id;
  return true;
end $$;

create or replace function public.promo_reacreditar_interno(p_rec uuid, p_por uuid)
returns boolean language plpgsql security definer
set search_path = public as $$
declare r public.promo_recompensas; v_n int; v_ahora timestamptz := public.promo_ahora();
begin
  select * into r from public.promo_recompensas where id = p_rec for update;
  if not found or r.estado = 'acreditada' then return false; end if;
  select count(*) + 1 into v_n from public.promo_movimientos where recompensa_id = r.id and tipo = 'reacreditacion';
  perform public.promo_mover(r.promotor_id, 'reacreditacion', r.monto_cents, v_ahora,
            'reacreditacion:' || r.id || ':' || v_n, 'Se volvió a acreditar (pago confirmado)',
            r.id, null, r.negocio_id, p_por);
  update public.promo_recompensas
     set estado = 'acreditada', motivo_reverso = null, revertida_en = null
   where id = r.id;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- MOTOR PRINCIPAL · se ejecuta por negocio. Idempotente: llamarlo 1 o
-- 100 veces produce el mismo resultado. Bloquea la fila del negocio, así
-- que el webhook, la conciliación y el cron nunca se pisan entre sí.
-- ---------------------------------------------------------------------
create or replace function public.promo_procesar_negocio(p_negocio uuid)
returns jsonb language plpgsql security definer
set search_path = public
set "TimeZone" = 'UTC' as $$
declare
  cfg public.promo_config; n public.promo_negocios; v_ahora timestamptz := public.promo_ahora();
  v_primera public.promo_pagos; v_play timestamptz; v_rec public.promo_recompensas;
  v_valida boolean; v_causa text; seg record; k int; w_ini timestamptz; w_fin timestamptz;
  v_num int; v_monto bigint; v_id uuid;
  c_creadas int := 0; c_revertidas int := 0; c_reacred int := 0;
begin
  select * into cfg from public.promo_config where id;
  select * into n from public.promo_negocios where id = p_negocio for update;
  if not found then return jsonb_build_object('ok', false, 'motivo', 'negocio_inexistente'); end if;

  -- A) Revalidar lo ya acreditado (reembolsos, contracargos, disputas ganadas)
  for v_rec in select * from public.promo_recompensas where negocio_id = p_negocio order by creada_en loop
    if v_rec.tipo = 'comision_inicial' then
      select valido into v_valida from public.promo_pagos where stripe_invoice_id = v_rec.stripe_invoice_id;
    else
      v_valida := public.promo_cubierto(p_negocio, v_rec.ventana_desde, v_rec.ventana_hasta);
    end if;
    v_valida := coalesce(v_valida, false);

    if v_rec.estado = 'acreditada' and not v_valida then
      v_causa := public.promo_causa_invalidez(v_rec.id);
      perform public.promo_revertir_interno(v_rec.id, 'automatico:' || v_causa, null);
      c_revertidas := c_revertidas + 1;
    elsif v_rec.estado = 'revertida' and v_valida
          and v_rec.motivo_reverso = 'automatico:disputa'          -- solo disputas ganadas regresan
          and not exists (select 1 from public.promo_recompensas o
                           where o.negocio_id = p_negocio and o.id <> v_rec.id and o.tipo = 'aniversario'
                             and o.estado = 'acreditada' and v_rec.tipo = 'aniversario'
                             and tstzrange(o.ventana_desde, o.ventana_hasta) && tstzrange(v_rec.ventana_desde, v_rec.ventana_hasta)) then
      perform public.promo_reacreditar_interno(v_rec.id, null);
      c_reacred := c_reacred + 1;
    end if;
  end loop;

  -- B) Exclusión Google Play: si su PRIMERA membresía fue por Play, no genera nada
  select * into v_primera from public.promo_pagos
   where negocio_id = p_negocio and estado_factura = 'paid' and monto_pagado_cents > 0 and livemode
   order by coalesce(pagado_en, periodo_inicio), periodo_inicio limit 1;
  if n.excluido_motivo is null and n.negocio_user_id is not null then
    v_play := public.promo_primer_pago_play(n.negocio_user_id);
    if v_play is not null and (v_primera.stripe_invoice_id is null
                               or v_play < coalesce(v_primera.pagado_en, v_primera.periodo_inicio)) then
      update public.promo_negocios set excluido_motivo = 'primera_membresia_google_play' where id = p_negocio;
      n.excluido_motivo := 'primera_membresia_google_play';
    end if;
  end if;
  if n.excluido_motivo is not null then
    return jsonb_build_object('ok', true, 'excluido', n.excluido_motivo,
                              'revertidas', c_revertidas, 'reacreditadas', c_reacred);
  end if;

  -- C) Comisión inicial: SOLO por la primera factura pagada de su historia,
  --    y solo si esa factura es válida (no reembolsada / no disputada).
  if v_primera.stripe_invoice_id is not null and v_primera.valido
     and not exists (select 1 from public.promo_recompensas
                      where negocio_id = p_negocio and tipo = 'comision_inicial') then
    insert into public.promo_recompensas (negocio_id, promotor_id, tipo, numero_aniversario, monto_cents, stripe_invoice_id)
    values (p_negocio, n.promotor_id, 'comision_inicial', 0, cfg.comision_inicial_cents, v_primera.stripe_invoice_id)
    on conflict (negocio_id, tipo, numero_aniversario) do nothing
    returning id into v_id;
    if v_id is not null then
      perform public.promo_mover(n.promotor_id, 'comision_inicial', cfg.comision_inicial_cents,
                v_ahora + make_interval(days => cfg.dias_retencion),
                'recompensa:' || v_id,
                'Comisión inicial · ' || coalesce(n.nombre_negocio_snapshot, 'negocio'),
                v_id, null, p_negocio, null);
      c_creadas := c_creadas + 1;
    end if;
  end if;

  -- D) Aniversarios: ventanas de 12 meses dentro de cada tramo continuo.
  --    Aniversario #1 = $250; #2, #3, … = $50. Los números nunca se reutilizan.
  for seg in select * from public.promo_segmentos(p_negocio) loop
    k := 1;
    loop
      w_ini := seg.inicio + make_interval(months => 12 * (k - 1));
      w_fin := seg.inicio + make_interval(months => 12 * k);
      exit when w_fin > v_ahora or w_fin > seg.fin + cfg.tolerancia_cobertura;
      if not exists (select 1 from public.promo_recompensas
                      where negocio_id = p_negocio and tipo = 'aniversario' and ventana_desde = w_ini)
         and not exists (select 1 from public.promo_recompensas
                          where negocio_id = p_negocio and tipo = 'aniversario' and estado = 'acreditada'
                            and tstzrange(ventana_desde, ventana_hasta) && tstzrange(w_ini, w_fin)) then
        select coalesce(max(numero_aniversario), 0) + 1 into v_num
          from public.promo_recompensas where negocio_id = p_negocio and tipo = 'aniversario';
        v_monto := case when v_num = 1 then cfg.recompensa_anio1_cents else cfg.recompensa_anio_extra_cents end;
        insert into public.promo_recompensas
          (negocio_id, promotor_id, tipo, numero_aniversario, monto_cents, ventana_desde, ventana_hasta)
        values (p_negocio, n.promotor_id, 'aniversario', v_num, v_monto, w_ini, w_fin)
        returning id into v_id;
        perform public.promo_mover(n.promotor_id,
                  case when v_num = 1 then 'recompensa_anio1' else 'recompensa_anio_extra' end,
                  v_monto, v_ahora + make_interval(days => cfg.dias_retencion),
                  'recompensa:' || v_id,
                  case when v_num = 1 then 'Primer año pagando · ' else 'Año adicional #' || v_num || ' · ' end
                    || coalesce(n.nombre_negocio_snapshot, 'negocio'),
                  v_id, null, p_negocio, null);
        c_creadas := c_creadas + 1;
      end if;
      k := k + 1;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'creadas', c_creadas, 'revertidas', c_revertidas, 'reacreditadas', c_reacred);
end $$;

-- Estado de un negocio para paneles (no escribe nada)
create or replace function public.promo_estado_negocio(p_negocio uuid)
returns jsonb language plpgsql stable security definer
set search_path = public
set "TimeZone" = 'UTC' as $$
declare
  n public.promo_negocios; cfg public.promo_config; v_ahora timestamptz := public.promo_ahora();
  v_primer timestamptz; s record; v_pagando boolean := false; v_meses int := 0; v_prox timestamptz;
  v_cumplio boolean; v_total bigint; v_estado text;
begin
  select * into n from public.promo_negocios where id = p_negocio;
  select * into cfg from public.promo_config where id;
  select min(periodo_inicio) into v_primer from public.promo_pagos where negocio_id = p_negocio and valido;
  select * into s from public.promo_segmentos(p_negocio) order by inicio desc limit 1;
  if s.inicio is not null and s.inicio <= v_ahora and s.fin + cfg.tolerancia_cobertura >= v_ahora then
    v_pagando := true;
    v_meses := (extract(year from age(v_ahora, s.inicio)) * 12 + extract(month from age(v_ahora, s.inicio)))::int;
    v_prox := s.inicio + make_interval(months => 12 * (v_meses / 12 + 1));
  end if;
  select exists (select 1 from public.promo_recompensas where negocio_id = p_negocio
                  and tipo = 'aniversario' and estado = 'acreditada') into v_cumplio;
  select coalesce(sum(monto_cents), 0) into v_total from public.promo_recompensas
   where negocio_id = p_negocio and estado = 'acreditada';
  v_estado := case
    when n.excluido_motivo is not null then 'Paga con Google Play (no participa)'
    when v_primer is null then 'Todavía no paga'
    when v_pagando then 'Pagando'
    else 'Dejó de pagar' end;
  return jsonb_build_object(
    'negocio_id', n.id,
    'nombre', case when n.negocio_user_id is not null then public.promo_nombre_negocio(n.negocio_user_id)
                   else coalesce(n.nombre_negocio_snapshot, 'Cuenta eliminada') end,
    'registrado_en', (select created_at from auth.users where id = n.negocio_user_id),
    'asociado_en', n.asociado_en,
    'primer_pago_valido_en', v_primer,
    'estado', v_estado,
    'pagando', v_pagando and n.excluido_motivo is null,
    'meses_pagando', case when n.excluido_motivo is null then v_meses else 0 end,
    'proxima_recompensa_en', case when n.excluido_motivo is null then v_prox end,
    'cumplio_primer_anio', v_cumplio,
    'recompensas_cents', v_total,
    'nunca_pago', v_primer is null and n.excluido_motivo is null);
end $$;

-- ---------------------------------------------------------------------
-- ASOCIACIÓN negocio ↔ promotor  (la llama SOLO la Edge Function
-- promo-asociar, que antes consultó Stripe del lado del servidor)
-- ---------------------------------------------------------------------
create or replace function public.promo_asociar(
  p_negocio_user uuid, p_codigo text,
  p_stripe_verificado boolean, p_stripe_primer_pago timestamptz,
  p_stripe_customer text, p_stripe_sub_activa text,
  p_sub_apta_descuento boolean, p_nota_descuento text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare
  cfg public.promo_config; pr public.promo_promotores; n public.promo_negocios;
  v_codigo text := upper(btrim(coalesce(p_codigo, ''))); v_ahora timestamptz := public.promo_ahora();
  v_play timestamptz; v_primero timestamptz; v_prov text; v_id uuid; v_desc text;
  v_det jsonb := jsonb_build_object('stripe_primer_pago', p_stripe_primer_pago, 'sub', p_stripe_sub_activa);

  -- registra el rechazo y devuelve el mensaje para la persona
  function_result jsonb;
begin
  select * into cfg from public.promo_config where id;
  select * into pr from public.promo_promotores where codigo = v_codigo;

  if not cfg.programa_activo then
    function_result := jsonb_build_object('ok', false, 'motivo', 'programa_inactivo',
      'mensaje', 'El programa de promotores no está disponible en este momento.');
  elsif pr.id is null then
    function_result := jsonb_build_object('ok', false, 'motivo', 'codigo_invalido',
      'mensaje', 'Este enlace de promotor no es válido.');
  elsif pr.estado <> 'activo' then
    function_result := jsonb_build_object('ok', false, 'motivo', 'promotor_no_activo',
      'mensaje', 'Este enlace de promotor todavía no está activo.');
  elsif pr.user_id = p_negocio_user then
    function_result := jsonb_build_object('ok', false, 'motivo', 'autoreferido',
      'mensaje', 'No puedes usar tu propio enlace de promotor.');
  end if;
  if function_result is not null then
    insert into public.promo_atribuciones (codigo, promotor_id, negocio_user_id, resultado, motivo, detalle)
    values (left(v_codigo, 20), pr.id, p_negocio_user, 'rechazado', function_result->>'motivo', v_det);
    return function_result;
  end if;

  -- Serializa intentos simultáneos del mismo negocio
  perform pg_advisory_xact_lock(hashtextextended('promo_negocio:' || p_negocio_user::text, 0));

  select * into n from public.promo_negocios where negocio_user_id = p_negocio_user;
  if found then
    if n.promotor_id = pr.id then
      insert into public.promo_atribuciones (codigo, promotor_id, negocio_user_id, resultado, motivo, detalle)
      values (v_codigo, pr.id, p_negocio_user, 'ya_asociado_mismo', 'ya_asociado_mismo', v_det);
      return jsonb_build_object('ok', true, 'motivo', 'ya_asociado_mismo', 'negocio_id', n.id,
        'mensaje', 'Tu negocio ya está asociado con este promotor.');
    end if;
    function_result := jsonb_build_object('ok', false, 'motivo', 'ya_tiene_promotor',
      'mensaje', 'Este negocio ya tiene un promotor asignado.');
  elsif not coalesce(p_stripe_verificado, false) then
    function_result := jsonb_build_object('ok', false, 'motivo', 'verificacion_fallida',
      'mensaje', 'No pudimos verificar tu cuenta en este momento. Intenta de nuevo en unos minutos.');
  end if;

  if function_result is null then
    v_play := public.promo_primer_pago_play(p_negocio_user);
    v_primero := least(p_stripe_primer_pago, v_play);          -- least() ignora nulos
    v_prov := case when v_primero is null then null
                   when v_play is not null and v_play <= coalesce(p_stripe_primer_pago, 'infinity') then 'google_play'
                   else 'stripe' end;

    if v_primero is null and exists (
         select 1 from public.profiles where user_id = p_negocio_user
            and (paid_until is not null or web_paid_until is not null or vp_web_pagado_hasta is not null)) then
      -- profiles dice que pagó, pero no encontramos el pago: no se adivina.
      function_result := jsonb_build_object('ok', false, 'motivo', 'requiere_revision',
        'mensaje', 'No pudimos confirmar el historial de pagos de este negocio. Escríbenos para revisarlo.');
    elsif v_primero is not null and v_ahora - v_primero >= make_interval(days => cfg.dias_ventana_asociacion) then
      function_result := jsonb_build_object('ok', false, 'motivo', 'membresia_antigua',
        'mensaje', 'Este negocio ya tiene una membresía activa desde hace más de 7 días y no puede asociarse con un promotor.');
    end if;
  end if;

  if function_result is not null then
    insert into public.promo_atribuciones (codigo, promotor_id, negocio_user_id, resultado, motivo, detalle)
    values (v_codigo, pr.id, p_negocio_user, 'rechazado', function_result->>'motivo',
            v_det || jsonb_build_object('primer_pago', v_primero, 'proveedor', v_prov));
    return function_result;
  end if;

  v_desc := case
    when v_prov = 'google_play'          then 'no_aplica'
    when p_stripe_sub_activa is not null then case when coalesce(p_sub_apta_descuento, false)
                                                   then 'pendiente_aplicar' else 'no_aplica' end
    else 'checkout' end;

  insert into public.promo_negocios
    (negocio_user_id, promotor_id, asociado_en, origen, primer_pago_previo_en, primer_pago_previo_prov,
     stripe_customer_id, nombre_negocio_snapshot, correo_snapshot,
     descuento_estado, descuento_sub_id, descuento_nota, excluido_motivo)
  values
    (p_negocio_user, pr.id, v_ahora, 'enlace', v_primero, v_prov,
     p_stripe_customer, public.promo_nombre_negocio(p_negocio_user),
     (select email from auth.users where id = p_negocio_user),
     v_desc, p_stripe_sub_activa,
     case when v_desc = 'no_aplica' then coalesce(p_nota_descuento,
          case when v_prov = 'google_play' then 'Su membresía es de Google Play' end) end,
     case when v_prov = 'google_play' then 'primera_membresia_google_play' end)
  returning id into v_id;

  insert into public.promo_atribuciones (codigo, promotor_id, negocio_user_id, resultado, motivo, detalle)
  values (v_codigo, pr.id, p_negocio_user, 'asociado', 'ok',
          v_det || jsonb_build_object('primer_pago', v_primero, 'proveedor', v_prov, 'descuento', v_desc));

  return jsonb_build_object('ok', true, 'motivo', 'asociado', 'negocio_id', v_id, 'descuento_estado', v_desc,
    'mensaje', '¡Listo! Tu negocio quedó registrado con tu promotor ' || split_part(pr.nombre, ' ', 1) || '.');
end $$;

-- ---------------------------------------------------------------------
-- Escrituras que hace el servidor después de leer Stripe
-- ---------------------------------------------------------------------
-- Busca el negocio de un cliente de Stripe (solo LEE profiles)
create or replace function public.promo_negocio_por_cliente(p_customer text, p_user uuid default null)
returns uuid language plpgsql security definer
set search_path = public as $$
declare v uuid;
begin
  select id into v from public.promo_negocios where stripe_customer_id = p_customer limit 1;
  if v is null then
    select n.id into v from public.profiles p
      join public.promo_negocios n on n.negocio_user_id = p.user_id
     where p.stripe_customer_id = p_customer limit 1;
  end if;
  if v is null and p_user is not null then
    select id into v from public.promo_negocios where negocio_user_id = p_user;
  end if;
  if v is not null then
    update public.promo_negocios set stripe_customer_id = p_customer
     where id = v and stripe_customer_id is null;
  end if;
  return v;
end $$;

-- Guarda/actualiza una factura. Protege contra fotos viejas que lleguen tarde:
-- 'paid' no regresa a otro estado, los reembolsos solo crecen y una disputa
-- cerrada no se reabre.
create or replace function public.promo_registrar_pago(p jsonb)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.promo_pagos as t
    (stripe_invoice_id, negocio_id, stripe_customer_id, stripe_subscription_id, stripe_charge_id,
     billing_reason, estado_factura, monto_pagado_cents, monto_reembolsado_cents, descuento_cents,
     moneda, livemode, producto_id, periodo_inicio, periodo_fin, pagado_en, disputa_estado)
  values
    (p->>'invoice_id', (p->>'negocio_id')::uuid, p->>'customer_id', p->>'subscription_id', p->>'charge_id',
     p->>'billing_reason', p->>'estado', coalesce((p->>'pagado_cents')::bigint, 0),
     coalesce((p->>'reembolsado_cents')::bigint, 0), coalesce((p->>'descuento_cents')::bigint, 0),
     lower(p->>'moneda'), (p->>'livemode')::boolean, p->>'producto_id',
     (p->>'periodo_inicio')::timestamptz, (p->>'periodo_fin')::timestamptz,
     (p->>'pagado_en')::timestamptz, p->>'disputa')
  on conflict (stripe_invoice_id) do update set
     estado_factura          = case when t.estado_factura = 'paid' then 'paid' else excluded.estado_factura end,
     monto_pagado_cents      = greatest(t.monto_pagado_cents, excluded.monto_pagado_cents),
     monto_reembolsado_cents = greatest(t.monto_reembolsado_cents, excluded.monto_reembolsado_cents),
     descuento_cents         = excluded.descuento_cents,
     stripe_charge_id        = coalesce(excluded.stripe_charge_id, t.stripe_charge_id),
     pagado_en               = coalesce(t.pagado_en, excluded.pagado_en),
     disputa_estado          = case when t.disputa_estado in ('ganada','perdida') and excluded.disputa_estado = 'abierta'
                                    then t.disputa_estado
                                    else coalesce(excluded.disputa_estado, t.disputa_estado) end;
end $$;

create or replace function public.promo_registrar_suscripcion(p jsonb)
returns void language plpgsql security definer
set search_path = public as $$
begin
  insert into public.promo_suscripciones as t
    (stripe_subscription_id, negocio_id, stripe_customer_id, estado, producto_id, cancel_al_final, terminada_en, cupon_id)
  values
    (p->>'subscription_id', (p->>'negocio_id')::uuid, p->>'customer_id', p->>'estado', p->>'producto_id',
     coalesce((p->>'cancel_al_final')::boolean, false), (p->>'terminada_en')::timestamptz, p->>'cupon_id')
  on conflict (stripe_subscription_id) do update set
     estado = excluded.estado, cancel_al_final = excluded.cancel_al_final,
     terminada_en = coalesce(t.terminada_en, excluded.terminada_en), cupon_id = excluded.cupon_id;
end $$;

-- Idempotencia de eventos: 'nuevo' | 'reintento' (falló antes) | 'duplicado'
create or replace function public.promo_registrar_evento(
  p_event_id text, p_tipo text, p_objeto text, p_creado timestamptz, p_livemode boolean)
returns text language plpgsql security definer
set search_path = public as $$
declare v_nuevo boolean; v_estado text;
begin
  insert into public.promo_eventos as e (event_id, tipo, objeto_id, creado_stripe, livemode)
  values (p_event_id, p_tipo, p_objeto, p_creado, p_livemode)
  on conflict (event_id) do update set veces_recibido = e.veces_recibido + 1
  returning (xmax = 0), estado into v_nuevo, v_estado;
  update public.promo_eventos set intentos = intentos + 1 where event_id = p_event_id;
  if v_nuevo then return 'nuevo'; end if;
  if v_estado in ('procesado','ignorado') then return 'duplicado'; end if;
  return 'reintento';
end $$;

create or replace function public.promo_cerrar_evento(p_event_id text, p_estado text, p_motivo text, p_negocio uuid)
returns void language sql security definer
set search_path = public as $$
  update public.promo_eventos
     set estado = p_estado, motivo = left(p_motivo, 500), negocio_id = coalesce(p_negocio, negocio_id),
         procesado_en = now()
   where event_id = p_event_id
$$;

create or replace function public.promo_marcar_descuento(p_negocio uuid, p_estado text, p_sub text, p_nota text)
returns void language sql security definer
set search_path = public as $$
  update public.promo_negocios
     set descuento_estado = p_estado,
         descuento_sub_id = coalesce(p_sub, descuento_sub_id),
         descuento_aplicado_en = case when p_estado = 'aplicado' then now() else descuento_aplicado_en end,
         descuento_nota = left(p_nota, 300)
   where id = p_negocio
$$;

create or replace function public.promo_guardar_cliente(p_negocio uuid, p_customer text)
returns void language sql security definer
set search_path = public as $$
  update public.promo_negocios set stripe_customer_id = p_customer
   where id = p_negocio and stripe_customer_id is null
$$;

-- Lote para la conciliación diaria (los menos recientes primero)
create or replace function public.promo_negocios_para_conciliar(p_limite int default 150)
returns table (negocio_id uuid, negocio_user_id uuid, stripe_customer_id text,
               descuento_estado text, descuento_sub_id text)
language sql stable security definer
set search_path = public as $$
  select n.id, n.negocio_user_id, coalesce(n.stripe_customer_id, p.stripe_customer_id),
         n.descuento_estado, n.descuento_sub_id
    from public.promo_negocios n
    left join public.profiles p on p.user_id = n.negocio_user_id
   where coalesce(n.stripe_customer_id, p.stripe_customer_id) is not null
   order by n.ultima_conciliacion_en nulls first
   limit greatest(1, least(p_limite, 500))
$$;

create or replace function public.promo_marcar_conciliado(p_negocio uuid)
returns void language sql security definer
set search_path = public as $$
  update public.promo_negocios set ultima_conciliacion_en = now() where id = p_negocio
$$;

-- Evaluación diaria (aniversarios que se cumplen sin que llegue ningún evento)
create or replace function public.promo_evaluar_todos()
returns jsonb language plpgsql security definer
set search_path = public as $$
declare v_corrida bigint; r record; ok int := 0; err int := 0; res jsonb; errores jsonb := '[]'::jsonb;
begin
  insert into public.promo_corridas (tipo) values ('evaluacion_diaria') returning id into v_corrida;
  for r in select id from public.promo_negocios loop
    begin
      perform public.promo_procesar_negocio(r.id);
      ok := ok + 1;
    exception when others then
      err := err + 1;
      errores := errores || jsonb_build_object('negocio', r.id, 'error', left(sqlerrm, 200));
    end;
  end loop;
  res := jsonb_build_object('negocios', ok, 'errores', err, 'detalle', errores);
  update public.promo_corridas set fin = now(), resultado = res where id = v_corrida;
  return res;
end $$;

commit;
