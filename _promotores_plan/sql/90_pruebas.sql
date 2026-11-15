-- =====================================================================
-- VENDOPLUS · PROMOTORES · 90 PRUEBAS AUTOMÁTICAS DEL MOTOR
-- ---------------------------------------------------------------------
-- Todo corre dentro de UNA transacción que termina en ROLLBACK:
-- al final no queda NADA en la base (ni usuarios de prueba, ni pagos,
-- ni movimientos). Usa la fecha simulada promo.ahora para "viajar" en el
-- tiempo sin esperar años. Cada prueba imprime "OK <nombre>" o se detiene
-- con "FALLÓ <nombre>".
--
-- Crea filas TEMPORALES en auth.users (y profiles por su trigger) y en
-- vp_play_compras para la prueba de Google Play. El ROLLBACK las elimina.
-- No altera ninguna estructura.
-- =====================================================================
begin;
set local timezone = 'UTC';
set local promo.ahora = '2027-01-10T12:00:00Z';
update public.promo_config set programa_activo = true, stripe_coupon_id = 'VP_PROMOTOR_25';
select vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'promo_clave_bancaria');

-- ---------- Ayudantes (viven solo en esta sesión) ----------
create function pg_temp.ok(cond boolean, nombre text) returns void language plpgsql as $$
begin
  if not coalesce(cond, false) then raise exception 'FALLÓ  %', nombre; end if;
  raise notice 'OK     %', nombre;
end $$;

create function pg_temp.reloj(t text) returns void language sql as $$
  select set_config('promo.ahora', t, true) $$;

create function pg_temp.usuario(correo text, creado timestamptz default '2026-01-01') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', correo, creado, creado);
  return v;
end $$;

create function pg_temp.como(u uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true) $$;

-- Factura de membresía con su periodo de servicio
create function pg_temp.factura(neg uuid, inv text, ini timestamptz, fin timestamptz,
                                estado text default 'paid', monto bigint default 14925,
                                pagado timestamptz default null) returns void language sql as $$
  select public.promo_registrar_pago(jsonb_build_object(
    'invoice_id', inv, 'negocio_id', neg, 'customer_id', 'cus_prueba', 'subscription_id', 'sub_' || neg,
    'billing_reason', 'subscription_cycle', 'estado', estado,
    'pagado_cents', case when estado = 'paid' then monto else 0 end,
    'moneda', 'mxn', 'livemode', true, 'producto_id', 'prod_VNLFsnbvoG0pHz',
    'periodo_inicio', ini, 'periodo_fin', fin, 'pagado_en', case when estado = 'paid' then coalesce(pagado, ini) end)) $$;

-- n meses seguidos pagados desde el ancla (igual que Stripe: ancla + i meses)
create function pg_temp.meses(neg uuid, pref text, ancla timestamptz, desde_mes int, hasta_mes int) returns void language plpgsql as $$
declare i int;
begin
  for i in desde_mes..hasta_mes - 1 loop
    perform pg_temp.factura(neg, pref || i, ancla + make_interval(months => i), ancla + make_interval(months => i + 1));
  end loop;
end $$;

create function pg_temp.neg(u uuid) returns uuid language sql as $$
  select id from public.promo_negocios where negocio_user_id = u $$;

create function pg_temp.recompensas(neg uuid, t text, est text default 'acreditada') returns bigint language sql as $$
  select coalesce(sum(monto_cents), 0) from public.promo_recompensas where negocio_id = neg and tipo = t and estado = est $$;

-- ---------- Personas de prueba ----------
create temp table v (k text primary key, id uuid, txt text);
insert into v values ('admin', pg_temp.usuario('admin@prueba.test'), null);
insert into public.promo_admins (user_id) select id from v where k = 'admin';

insert into v values ('uP', pg_temp.usuario('promotor1@prueba.test'), null), ('uP2', pg_temp.usuario('promotor2@prueba.test'), null),
                     ('uP3', pg_temp.usuario('promotor3@prueba.test'), null);
select pg_temp.como((select id from v where k = 'uP'));  select public.promo_registrar_promotor('Ana Promotora', '5512345678');
select pg_temp.como((select id from v where k = 'uP2')); select public.promo_registrar_promotor('Beto Promotor', null);
select pg_temp.como((select id from v where k = 'uP3')); select public.promo_registrar_promotor('Ceci Pendiente', null);
insert into v select 'P',  id, codigo from public.promo_promotores where user_id = (select id from v where k = 'uP');
insert into v select 'P2', id, codigo from public.promo_promotores where user_id = (select id from v where k = 'uP2');
insert into v select 'P3', id, codigo from public.promo_promotores where user_id = (select id from v where k = 'uP3');

select pg_temp.como((select id from v where k = 'admin'));
select public.promo_admin_promotor_estado((select id from v where k = 'P'),  'activo', 'Aprobado en prueba');
select public.promo_admin_promotor_estado((select id from v where k = 'P2'), 'activo', 'Aprobado en prueba');

-- =====================================================================
-- CAPTACIÓN Y COMISIÓN INICIAL
-- =====================================================================
insert into v values ('N1', pg_temp.usuario('negocio1@prueba.test', '2027-01-09'), null);
select pg_temp.ok((public.promo_asociar((select id from v where k='N1'), (select txt from v where k='P'),
                   true, null, null, null, false, null))->>'motivo' = 'asociado',
                  '01 Negocio nuevo llega por enlace y queda asociado');

select pg_temp.como((select id from v where k = 'N1'));
select pg_temp.ok((public.promo_mi_negocio()->>'descuento_en_checkout')::boolean
                  and (public.promo_mi_negocio()->>'precio_descuento_cents')::int = 14925,
                  '02 El negocio ve 25% de descuento: $199.00 -> $149.25');

insert into v values ('Nx', pg_temp.usuario('normal@prueba.test'), null);
select pg_temp.como((select id from v where k = 'Nx'));
select pg_temp.ok(not (public.promo_mi_negocio()->>'asociado')::boolean, '03 Cliente normal NO recibe descuento');

-- Primer pago confirmado: 15 de enero de 2027
select pg_temp.reloj('2027-01-15T12:00:00Z');
select pg_temp.meses(pg_temp.neg((select id from v where k='N1')), 'in_n1_', '2027-01-15T12:00:00Z', 0, 1);
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N1')), 'comision_inicial') = 10000,
                  '04 Primer pago válido genera $100');
select pg_temp.ok((select pendiente_cents = 10000 and disponible_cents = 0 from public.promo_saldos((select id from v where k='P'))),
                  '05 Los $100 quedan PENDIENTES (15 días)');

-- Eventos duplicados y reprocesos
select pg_temp.ok(public.promo_registrar_evento('evt_dup_1', 'invoice.paid', 'in_n1_0', now(), true) = 'nuevo'
              and public.promo_registrar_evento('evt_dup_1', 'invoice.paid', 'in_n1_0', now(), true) = 'reintento', '06a Evento repetido antes de procesarse = reintento');
select public.promo_cerrar_evento('evt_dup_1', 'procesado', 'ok', null);
select pg_temp.ok(public.promo_registrar_evento('evt_dup_1', 'invoice.paid', 'in_n1_0', now(), true) = 'duplicado', '06b Evento ya procesado = duplicado (se ignora)');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1'))) from generate_series(1, 5);
select pg_temp.ok((select count(*) = 1 from public.promo_movimientos where promotor_id = (select id from v where k='P') and tipo = 'comision_inicial'),
                  '07 Repetir el proceso 5 veces NO duplica la comisión');

select pg_temp.reloj('2027-01-31T12:00:00Z');
select pg_temp.ok((select disponible_cents = 10000 and pendiente_cents = 0 from public.promo_saldos((select id from v where k='P'))),
                  '08 A los 16 días los $100 pasan a DISPONIBLE');

-- =====================================================================
-- NEGOCIOS EXISTENTES
-- =====================================================================
insert into v values ('N2', pg_temp.usuario('gratis8meses@prueba.test', '2026-05-01'), null);
select pg_temp.ok((public.promo_asociar((select id from v where k='N2'), (select txt from v where k='P'),
                   true, null, null, null, false, null))->>'motivo' = 'asociado',
                  '09 Negocio gratuito con 8 meses de uso SÍ se asocia');

insert into v values ('N3', pg_temp.usuario('pago3dias@prueba.test', '2026-06-01'), null);
select pg_temp.ok((public.promo_asociar((select id from v where k='N3'), (select txt from v where k='P'),
                   true, '2027-01-28T12:00:00Z', 'cus_n3', 'sub_n3', true, null))->>'descuento_estado' = 'pendiente_aplicar',
                  '10 Pagó con Stripe hace 3 días: se asocia y el 25% queda para su siguiente renovación');
select pg_temp.factura(pg_temp.neg((select id from v where k='N3')), 'in_n3_0', '2027-01-28T12:00:00Z', '2027-02-28T12:00:00Z', 'paid', 19900);
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N3')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N3')), 'comision_inicial') = 10000,
                  '11 Ese negocio (pagó $199 hace < 7 días) también genera los $100');

insert into v values ('N4', pg_temp.usuario('pago7dias@prueba.test', '2026-06-01'), null);
select pg_temp.ok((public.promo_asociar((select id from v where k='N4'), (select txt from v where k='P'),
                   true, '2027-01-24T12:00:00Z', 'cus_n4', 'sub_n4', true, null))->>'mensaje'
                   = 'Este negocio ya tiene una membresía activa desde hace más de 7 días y no puede asociarse con un promotor.',
                  '12 Pagó hace 7 días exactos: NO se asocia (mensaje claro)');

select pg_temp.ok((public.promo_asociar((select id from v where k='N1'), (select txt from v where k='P2'),
                   true, null, null, null, false, null))->>'mensaje' = 'Este negocio ya tiene un promotor asignado.',
                  '13 Negocio con promotor NO se cambia a otro');

select pg_temp.ok((public.promo_asociar((select id from v where k='uP'), (select txt from v where k='P'),
                   true, null, null, null, false, null))->>'motivo' = 'autoreferido',
                  '14 Un promotor no puede asociarse a sí mismo');

insert into v values ('N5', pg_temp.usuario('pendiente@prueba.test'), null);
select pg_temp.ok((public.promo_asociar((select id from v where k='N5'), (select txt from v where k='P3'),
                   true, null, null, null, false, null))->>'motivo' = 'promotor_no_activo',
                  '15 Enlace de promotor NO aprobado no funciona');

-- Google Play
insert into v values ('NG', pg_temp.usuario('play@prueba.test', '2026-06-01'), null);
insert into public.vp_play_compras (purchase_token, user_id, product_id, state, created_at)
values ('tok_prueba_promo', (select id from v where k='NG'), 'vendoplus_app_membresia', 'ACTIVE', '2027-01-29T12:00:00Z');
select pg_temp.ok((public.promo_asociar((select id from v where k='NG'), (select txt from v where k='P'),
                   true, null, null, null, false, null))->>'descuento_estado' = 'no_aplica',
                  '16 Negocio de Google Play: sin descuento');
select pg_temp.factura(pg_temp.neg((select id from v where k='NG')), 'in_ng_0', '2027-01-30T12:00:00Z', '2027-02-28T12:00:00Z', 'paid', 19900);
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='NG')));
select pg_temp.ok(not exists (select 1 from public.promo_recompensas where negocio_id = pg_temp.neg((select id from v where k='NG'))),
                  '17 Primera membresía por Google Play: NO genera comisión ni recompensas');

-- =====================================================================
-- PERMANENCIA (ANIVERSARIOS)
-- =====================================================================
-- N1: 12 meses pagados desde el 15 ene 2027
select pg_temp.meses(pg_temp.neg((select id from v where k='N1')), 'in_n1_', '2027-01-15T12:00:00Z', 1, 12);
select pg_temp.reloj('2028-01-14T12:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N1')), 'aniversario') = 0,
                  '18 Un día antes del aniversario todavía no hay recompensa');
select pg_temp.reloj('2028-01-16T12:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N1')), 'aniversario') = 25000,
                  '19 Primer aniversario (15 ene 2028) = $250');

select pg_temp.meses(pg_temp.neg((select id from v where k='N1')), 'in_n1_', '2027-01-15T12:00:00Z', 12, 36);
select pg_temp.reloj('2029-01-16T12:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N1')), 'aniversario') = 30000,
                  '20 Segundo aniversario = $50 (total $300)');
select pg_temp.reloj('2030-01-16T12:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N1'))) from generate_series(1, 3);
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N1')), 'aniversario') = 35000
              and (select count(*) = 1 from public.promo_recompensas
                    where negocio_id = pg_temp.neg((select id from v where k='N1')) and monto_cents = 25000),
                  '21 Tercer aniversario = $50; los $250 se pagaron UNA sola vez; repetir no duplica');

-- Reintentos de cobro: el mes 6 se pagó 10 días tarde, pero cubre su periodo
insert into v values ('N7', pg_temp.usuario('tarde@prueba.test'), null);
select pg_temp.reloj('2027-03-01T12:00:00Z');
select public.promo_asociar((select id from v where k='N7'), (select txt from v where k='P'), true, null, null, null, false, null);
select pg_temp.meses(pg_temp.neg((select id from v where k='N7')), 'in_n7_', '2027-03-05T00:00:00Z', 0, 6);
select pg_temp.meses(pg_temp.neg((select id from v where k='N7')), 'in_n7_', '2027-03-05T00:00:00Z', 7, 12);
select pg_temp.factura(pg_temp.neg((select id from v where k='N7')), 'in_n7_6', '2027-09-05T00:00:00Z', '2027-10-05T00:00:00Z',
                       'paid', 14925, '2027-09-15T00:00:00Z');
select pg_temp.reloj('2028-03-06T00:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N7')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N7')), 'aniversario') = 25000,
                  '22 Factura pagada tarde por reintentos (cubre su periodo) SÍ cuenta');

-- Cancela antes de cumplir el año
insert into v values ('N8', pg_temp.usuario('cancela@prueba.test'), null);
select pg_temp.reloj('2027-03-01T12:00:00Z');
select public.promo_asociar((select id from v where k='N8'), (select txt from v where k='P'), true, null, null, null, false, null);
select pg_temp.meses(pg_temp.neg((select id from v where k='N8')), 'in_n8_', '2027-03-05T00:00:00Z', 0, 8);
select public.promo_registrar_suscripcion(jsonb_build_object('subscription_id', 'sub_' || pg_temp.neg((select id from v where k='N8')),
        'negocio_id', pg_temp.neg((select id from v where k='N8')), 'customer_id', 'cus_prueba', 'estado', 'canceled',
        'terminada_en', '2027-11-05T00:00:00Z'));
select pg_temp.reloj('2028-04-01T00:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N8')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N8')), 'aniversario') = 0,
                  '23 Canceló en el mes 8: NO genera recompensa');

-- Pago fallido = hueco real: el contador se reinicia
insert into v values ('N9', pg_temp.usuario('fallido@prueba.test'), null);
select pg_temp.reloj('2027-02-01T18:00:00Z');   -- mediodía en CDMX: cuenta en febrero
select public.promo_asociar((select id from v where k='N9'), (select txt from v where k='P'), true, null, null, null, false, null);
select pg_temp.meses(pg_temp.neg((select id from v where k='N9')), 'in_n9_', '2027-02-01T00:00:00Z', 0, 4);
select pg_temp.factura(pg_temp.neg((select id from v where k='N9')), 'in_n9_4', '2027-06-01T00:00:00Z', '2027-07-01T00:00:00Z', 'uncollectible');
select pg_temp.meses(pg_temp.neg((select id from v where k='N9')), 'in_n9_', '2027-02-01T00:00:00Z', 5, 17);
select pg_temp.reloj('2028-02-02T00:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N9')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N9')), 'aniversario') = 0,
                  '24 Un pago fallido (mes 5) NO cuenta: no hay recompensa al año del primer pago');
select pg_temp.reloj('2028-07-02T00:00:00Z');
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N9')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N9')), 'aniversario') = 25000
              and (select ventana_desde = '2027-07-01T00:00:00Z' from public.promo_recompensas
                    where negocio_id = pg_temp.neg((select id from v where k='N9')) and tipo = 'aniversario'),
                  '25 Tras el hueco, el contador reinicia desde el siguiente pago (jul 2027 -> jul 2028)');

-- Reembolso después de acreditar (ya disponible): reverso, nunca se borra nada
insert into v values ('N10', pg_temp.usuario('reembolso@prueba.test'), null);
select pg_temp.reloj('2027-02-01T00:00:00Z');
select public.promo_asociar((select id from v where k='N10'), (select txt from v where k='P2'), true, null, null, null, false, null);
select pg_temp.meses(pg_temp.neg((select id from v where k='N10')), 'in_n10_', '2027-02-01T00:00:00Z', 0, 1);
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N10')));
select pg_temp.reloj('2027-03-01T00:00:00Z');
select pg_temp.ok((select disponible_cents = 10000 from public.promo_saldos((select id from v where k='P2'))), '26a P2 tiene $100 disponibles');
update public.promo_pagos set monto_reembolsado_cents = monto_pagado_cents where stripe_invoice_id = 'in_n10_0';
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N10')));
select pg_temp.ok((select disponible_cents = 0 from public.promo_saldos((select id from v where k='P2')))
              and (select count(*) = 2 from public.promo_movimientos where promotor_id = (select id from v where k='P2'))
              and pg_temp.recompensas(pg_temp.neg((select id from v where k='N10')), 'comision_inicial', 'revertida') = 10000,
                  '26 Reembolso: movimiento inverso de -$100; el movimiento original se conserva');

-- Disputa: abierta = reverso; ganada = se vuelve a acreditar
insert into v values ('N11', pg_temp.usuario('disputa@prueba.test'), null);
select public.promo_asociar((select id from v where k='N11'), (select txt from v where k='P2'), true, null, null, null, false, null);
select pg_temp.meses(pg_temp.neg((select id from v where k='N11')), 'in_n11_', '2027-03-01T00:00:00Z', 0, 1);
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N11')));
update public.promo_pagos set disputa_estado = 'abierta' where stripe_invoice_id = 'in_n11_0';
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N11')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N11')), 'comision_inicial', 'revertida') = 10000,
                  '27a Contracargo abierto: la comisión se revierte');
update public.promo_pagos set disputa_estado = 'ganada' where stripe_invoice_id = 'in_n11_0';
select public.promo_procesar_negocio(pg_temp.neg((select id from v where k='N11')));
select pg_temp.ok(pg_temp.recompensas(pg_temp.neg((select id from v where k='N11')), 'comision_inicial') = 10000,
                  '27b Contracargo ganado: la comisión se vuelve a acreditar');

-- 99 negocios: sin metas mínimas
select pg_temp.como((select id from v where k = 'admin'));
select public.promo_admin_promotor_estado((select id from v where k = 'P3'), 'activo', 'Aprobado en prueba');
select pg_temp.reloj('2027-04-01T00:00:00Z');
do $$
declare i int; u uuid; n uuid;
begin
  for i in 1..99 loop
    u := pg_temp.usuario('n99_' || i || '@prueba.test');
    perform public.promo_asociar(u, (select txt from v where k='P3'), true, null, null, null, false, null);
    n := pg_temp.neg(u);
    perform pg_temp.meses(n, 'in_99_' || i || '_', '2027-04-02T00:00:00Z', 0, 12);
  end loop;
end $$;
select pg_temp.reloj('2028-04-03T00:00:00Z');
select public.promo_evaluar_todos();
select pg_temp.ok((select anio1_cents = 99 * 25000 and comisiones_cents = 99 * 10000
                     from public.promo_saldos((select id from v where k='P3'))),
                  '28 99 negocios con 12 meses = $24,750 + $9,900 de comisiones (sin exigir 100)');

-- Negocios de distintos meses se acumulan
select pg_temp.como((select id from v where k = 'uP'));
select pg_temp.ok(jsonb_array_length(public.promo_mis_negocios_por_mes()) >= 3
              and (select sum((m->>'conseguidos')::int) from jsonb_array_elements(public.promo_mis_negocios_por_mes()) m)
                  = (select count(*) from public.promo_negocios where promotor_id = (select id from v where k='P')),
                  '29 "Mis negocios por mes" separa por mes y el total acumula todos');

-- =====================================================================
-- RETIROS
-- =====================================================================
select pg_temp.ok((select public.promo_clabe_valida('032180000118359719') and not public.promo_clabe_valida('032180000118359718')),
                  '30 Validación de CLABE (dígito de control)');
select pg_temp.ok((public.promo_guardar_datos_bancarios('Ana Promotora', 'BBVA', '032180000118359719')->>'clabe') = '•••• 9719',
                  '31 La CLABE se guarda cifrada y solo se muestran los últimos 4');

do $$ begin
  perform public.promo_solicitar_retiro(15000);
  raise exception 'FALLÓ  32 Debió rechazar un retiro menor a $200';
exception when sqlstate '22023' then raise notice 'OK     32 Retiro menor a $200 rechazado';
end $$;

create temp table s0 as select * from public.promo_saldos((select id from v where k='P'));
select public.promo_solicitar_retiro(20000);
select pg_temp.ok((select s.disponible_cents = s0.disponible_cents - 20000 and s.en_retiro_cents = 20000
                     from public.promo_saldos((select id from v where k='P')) s, s0),
                  '33 Al solicitar, $200 quedan apartados (salen del disponible)');
do $$ begin
  perform public.promo_solicitar_retiro(20000);
  raise exception 'FALLÓ  34 Debió impedir una segunda solicitud';
exception when sqlstate '55000' then raise notice 'OK     34 No se puede solicitar dos veces el mismo dinero';
end $$;

do $$ begin
  perform pg_temp.como((select id from v where k = 'uP'));
  perform public.promo_admin_promotores();
  raise exception 'FALLÓ  35 Un promotor no debe usar funciones de administrador';
exception when sqlstate '42501' then raise notice 'OK     35 Funciones de administrador bloqueadas para no administradores';
end $$;

select pg_temp.como((select id from v where k = 'admin'));
select public.promo_admin_retiro((select id from public.promo_retiros where promotor_id = (select id from v where k='P')),
                                 'aprobar', 'Aprobado en prueba');
select public.promo_admin_retiro((select id from public.promo_retiros where promotor_id = (select id from v where k='P')),
                                 'pagado', 'Transferencia de prueba', 'SPEI-PRUEBA-001');
select pg_temp.ok((select s.retirado_cents = 20000 and s.en_retiro_cents = 0 and s.disponible_cents = s0.disponible_cents - 20000
                     from public.promo_saldos((select id from v where k='P')) s, s0),
                  '36 Retiro aprobado y pagado: se descuenta UNA sola vez y queda como retirado');
select pg_temp.ok((select count(*) >= 2 from public.promo_auditoria where accion like 'retiro_%'),
                  '37 Cada acción del administrador queda en la auditoría');

-- =====================================================================
-- PROTECCIONES
-- =====================================================================
do $$ begin
  update public.promo_movimientos set monto_cents = 999999 where id = (select min(id) from public.promo_movimientos);
  raise exception 'FALLÓ  38 El libro contable no debe poder editarse';
exception when sqlstate 'P0001' then raise notice 'OK     38 El libro contable no se puede editar ni borrar';
end $$;

-- RLS: como usuario real de la API, P2 no ve los movimientos de P
select set_config('prueba.p_id', (select id::text from v where k = 'P'), true);
select pg_temp.como((select id from v where k = 'uP2'));
set local role authenticated;
do $$ begin
  if (select count(*) from public.promo_movimientos where promotor_id = current_setting('prueba.p_id')::uuid) <> 0 then
    raise exception 'FALLÓ  39 Un promotor ve movimientos de otro';
  end if;
  raise notice 'OK     39 Un promotor no ve los movimientos de otro (RLS)';
  if (select count(*) from public.promo_negocios) <> 0 then
    raise exception 'FALLÓ  40 Un promotor lee la tabla de negocios';
  end if;
  raise notice 'OK     40 Un promotor no lee la tabla de negocios (correos) directamente';
end $$;
do $$ begin
  insert into public.promo_movimientos (promotor_id, tipo, monto_cents, disponible_desde, clave, descripcion)
  values (current_setting('prueba.p_id')::uuid, 'ajuste_admin', 100000, now(), 'hack', 'hack');
  raise exception 'FALLÓ  41 Un promotor no debe poder escribirse saldo';
exception when insufficient_privilege then raise notice 'OK     41 Un promotor no puede escribirse saldo';
end $$;
reset role;

rollback;   -- ← NO queda nada en la base de datos
