-- =====================================================================
-- VENDOPLUS · PROGRAMA DE PROMOTORES · 01 ESQUEMA
-- ---------------------------------------------------------------------
-- SOLO CREA OBJETOS NUEVOS con prefijo promo_. No altera, renombra ni
-- borra ninguna tabla existente (profiles, user_data, vp_play_compras…).
--
-- Dinero: SIEMPRE en centavos (bigint). $199.00 = 19900, $149.25 = 14925.
-- Fechas: timestamptz. Los cálculos de meses se hacen en UTC (igual que
-- Stripe) y las agrupaciones "por mes" en America/Mexico_City.
--
-- Borrado de cuentas: las referencias a auth.users usan ON DELETE SET NULL
-- para que eliminar una cuenta (eliminar-cuenta.html) NUNCA quede bloqueado
-- y el historial contable se conserve.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN (una sola fila)
-- ---------------------------------------------------------------------
create table public.promo_config (
  id                          boolean primary key default true check (id),
  programa_activo             boolean not null default false,  -- interruptor general
  precio_normal_cents         integer not null default 19900 check (precio_normal_cents > 0),
  descuento_pct               numeric(5,2) not null default 25 check (descuento_pct > 0 and descuento_pct < 100),
  comision_inicial_cents      integer not null default 10000 check (comision_inicial_cents > 0),
  recompensa_anio1_cents      integer not null default 25000 check (recompensa_anio1_cents > 0),
  recompensa_anio_extra_cents integer not null default 5000  check (recompensa_anio_extra_cents > 0),
  dias_retencion              integer not null default 15 check (dias_retencion between 0 and 120),
  retiro_minimo_cents         integer not null default 20000 check (retiro_minimo_cents > 0),
  dias_ventana_asociacion     integer not null default 7 check (dias_ventana_asociacion between 0 and 60),
  -- Hueco máximo entre dos periodos pagados que NO se considera interrupción
  -- (absorbe diferencias de segundos/minutos en las fechas de Stripe).
  tolerancia_cobertura        interval not null default interval '24 hours'
                              check (tolerancia_cobertura >= interval '0' and tolerancia_cobertura <= interval '72 hours'),
  stripe_coupon_id            text,                                         -- 'VP_PROMOTOR_25'
  stripe_productos            text[] not null default array['prod_VNLFsnbvoG0pHz'],  -- membresía
  moneda                      text not null default 'mxn',
  url_base_enlace             text not null default 'https://vendoplusoficial.com/registro/?promotor=',
  actualizado_en              timestamptz not null default now()
);
insert into public.promo_config default values;

-- ---------------------------------------------------------------------
-- 2. ADMINISTRADORES MAESTROS
-- ---------------------------------------------------------------------
create table public.promo_admins (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  nota        text,
  agregado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 3. PROMOTORES
-- ---------------------------------------------------------------------
create table public.promo_promotores (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid unique references auth.users(id) on delete set null,
  -- 8 caracteres sin letras/números confundibles (sin I, O, 0, 1)
  codigo          text not null unique check (codigo ~ '^[A-HJ-NP-Z2-9]{8}$'),
  nombre          text not null check (char_length(btrim(nombre)) between 2 and 80),
  telefono        text check (telefono is null or telefono ~ '^\+?[0-9]{10,15}$'),
  correo_snapshot text,
  estado          text not null default 'pendiente'
                  check (estado in ('pendiente','activo','suspendido','rechazado')),
  motivo_estado   text,
  estado_por      uuid,
  estado_en       timestamptz,
  creado_en       timestamptz not null default now(),
  actualizado_en  timestamptz not null default now()
);
create index promo_promotores_estado_idx on public.promo_promotores (estado, creado_en);

-- ---------------------------------------------------------------------
-- 4. NEGOCIOS REFERIDOS  (1 negocio = 1 promotor, permanente)
-- ---------------------------------------------------------------------
create table public.promo_negocios (
  id                         uuid primary key default gen_random_uuid(),
  negocio_user_id            uuid unique references auth.users(id) on delete set null,
  promotor_id                uuid not null references public.promo_promotores(id) on delete restrict,
  asociado_en                timestamptz not null default now(),
  origen                     text not null default 'enlace' check (origen in ('enlace','admin')),
  -- Si ya había pagado cuando se asoció (regla de los 7 días):
  primer_pago_previo_en      timestamptz,
  primer_pago_previo_prov    text check (primer_pago_previo_prov in ('stripe','google_play')),
  stripe_customer_id         text,
  nombre_negocio_snapshot    text,
  correo_snapshot            text,
  -- Descuento del 25%:
  --   checkout          = se aplica al contratar con promo-checkout
  --   pendiente_aplicar = ya pagaba con Stripe (<7 días): poner cupón en su suscripción
  --   aplicado          = cupón puesto en su suscripción (desde la siguiente renovación)
  --   no_aplica         = no es seguro / no corresponde (motivo en descuento_nota)
  descuento_estado           text not null default 'checkout'
                             check (descuento_estado in ('checkout','pendiente_aplicar','aplicado','no_aplica')),
  descuento_sub_id           text,
  descuento_aplicado_en      timestamptz,
  descuento_nota             text,
  -- Si su PRIMERA membresía fue de Google Play, queda asociado pero no genera nada.
  excluido_motivo            text,
  ultima_conciliacion_en     timestamptz,   -- para repartir la conciliación diaria por lotes
  creado_en                  timestamptz not null default now(),
  actualizado_en             timestamptz not null default now()
);
create index promo_negocios_promotor_idx on public.promo_negocios (promotor_id, asociado_en);
create index promo_negocios_customer_idx on public.promo_negocios (stripe_customer_id);

-- ---------------------------------------------------------------------
-- 5. HISTORIAL DE ATRIBUCIÓN (todos los intentos, aceptados o no)
-- ---------------------------------------------------------------------
create table public.promo_atribuciones (
  id              bigint generated always as identity primary key,
  codigo          text,
  promotor_id     uuid references public.promo_promotores(id) on delete set null,
  negocio_user_id uuid,                     -- sin FK: es bitácora
  resultado       text not null check (resultado in ('asociado','ya_asociado_mismo','rechazado','reasignado_admin')),
  motivo          text not null,
  detalle         jsonb not null default '{}'::jsonb,
  creado_en       timestamptz not null default now()
);
create index promo_atribuciones_negocio_idx  on public.promo_atribuciones (negocio_user_id, creado_en desc);
create index promo_atribuciones_promotor_idx on public.promo_atribuciones (promotor_id, creado_en desc);

-- ---------------------------------------------------------------------
-- 6. SUSCRIPCIONES DE STRIPE OBSERVADAS (solo lectura de Stripe)
-- ---------------------------------------------------------------------
create table public.promo_suscripciones (
  stripe_subscription_id text primary key,
  negocio_id             uuid not null references public.promo_negocios(id) on delete restrict,
  stripe_customer_id     text not null,
  estado                 text not null,         -- active, past_due, canceled, unpaid…
  producto_id            text,
  cancel_al_final        boolean not null default false,
  terminada_en           timestamptz,           -- ended_at: el servicio terminó aquí
  cupon_id               text,
  actualizado_en         timestamptz not null default now()
);
create index promo_suscripciones_negocio_idx on public.promo_suscripciones (negocio_id);

-- ---------------------------------------------------------------------
-- 7. PAGOS (facturas de Stripe de la membresía; una fila por factura)
-- ---------------------------------------------------------------------
create table public.promo_pagos (
  stripe_invoice_id        text primary key,
  negocio_id               uuid not null references public.promo_negocios(id) on delete restrict,
  stripe_customer_id       text not null,
  stripe_subscription_id   text,
  stripe_charge_id         text,
  billing_reason           text,
  estado_factura           text not null check (estado_factura in ('draft','open','paid','void','uncollectible')),
  monto_pagado_cents       bigint not null default 0 check (monto_pagado_cents >= 0),
  monto_reembolsado_cents  bigint not null default 0 check (monto_reembolsado_cents >= 0),
  descuento_cents          bigint not null default 0 check (descuento_cents >= 0),
  moneda                   text not null,
  livemode                 boolean not null,
  producto_id              text,
  periodo_inicio           timestamptz,
  periodo_fin              timestamptz,
  pagado_en                timestamptz,
  disputa_estado           text check (disputa_estado in ('abierta','ganada','perdida')),
  -- Un periodo cuenta SOLO si: pagada, con importe > 0, real (livemode),
  -- en MXN, sin reembolso total y sin disputa abierta o perdida.
  -- Un reembolso PARCIAL no invalida el periodo (queda registrado).
  valido                   boolean generated always as (
                              estado_factura = 'paid'
                              and monto_pagado_cents > 0
                              and livemode
                              and moneda = 'mxn'
                              and monto_reembolsado_cents < monto_pagado_cents
                              and coalesce(disputa_estado, 'ganada') = 'ganada'
                              and periodo_inicio is not null
                              and periodo_fin is not null
                           ) stored,
  primera_vista_en         timestamptz not null default now(),
  actualizado_en           timestamptz not null default now(),
  check (periodo_fin is null or periodo_inicio is null or periodo_fin > periodo_inicio)
);
create index promo_pagos_negocio_idx on public.promo_pagos (negocio_id, periodo_inicio);

-- ---------------------------------------------------------------------
-- 8. EVENTOS DE STRIPE (idempotencia y bitácora de duplicados/rechazos)
-- ---------------------------------------------------------------------
create table public.promo_eventos (
  event_id        text primary key,               -- evt_… de Stripe
  tipo            text not null,
  objeto_id       text,
  creado_stripe   timestamptz,
  livemode        boolean,
  estado          text not null default 'recibido'
                  check (estado in ('recibido','procesado','ignorado','error')),
  motivo          text,
  negocio_id      uuid references public.promo_negocios(id) on delete set null,
  veces_recibido  integer not null default 1,
  intentos        integer not null default 0,
  recibido_en     timestamptz not null default now(),
  procesado_en    timestamptz
);
create index promo_eventos_estado_idx on public.promo_eventos (estado, recibido_en desc);

-- ---------------------------------------------------------------------
-- 9. RETIROS  (se crea antes que movimientos porque éstos la referencian)
-- ---------------------------------------------------------------------
create table public.promo_retiros (
  id               uuid primary key default gen_random_uuid(),
  promotor_id      uuid not null references public.promo_promotores(id) on delete restrict,
  monto_cents      bigint not null check (monto_cents > 0),
  estado           text not null default 'solicitado'
                   check (estado in ('solicitado','aprobado','pagado','rechazado','cancelado')),
  -- Copia de los datos bancarios al momento de solicitar (solo últimos 4)
  titular          text not null,
  banco            text not null,
  clabe_ultimos4   text not null check (clabe_ultimos4 ~ '^[0-9]{4}$'),
  solicitado_en    timestamptz not null default now(),
  aprobado_en      timestamptz,  aprobado_por  uuid,
  pagado_en        timestamptz,  pagado_por    uuid,  referencia_pago text,
  rechazado_en     timestamptz,  rechazado_por uuid,  motivo_rechazo  text,
  cancelado_en     timestamptz,
  actualizado_en   timestamptz not null default now()
);
-- Solo UNA solicitud en curso por promotor: impide pedir dos veces el mismo dinero.
create unique index promo_retiros_uno_activo
  on public.promo_retiros (promotor_id) where estado in ('solicitado','aprobado');
create index promo_retiros_estado_idx on public.promo_retiros (estado, solicitado_en);

-- ---------------------------------------------------------------------
-- 10. RECOMPENSAS (comisión inicial y aniversarios)
-- ---------------------------------------------------------------------
create table public.promo_recompensas (
  id                 uuid primary key default gen_random_uuid(),
  negocio_id         uuid not null references public.promo_negocios(id) on delete restrict,
  promotor_id        uuid not null references public.promo_promotores(id) on delete restrict,
  tipo               text not null check (tipo in ('comision_inicial','aniversario')),
  numero_aniversario integer not null default 0,
  monto_cents        bigint not null check (monto_cents > 0),
  ventana_desde      timestamptz,
  ventana_hasta      timestamptz,
  stripe_invoice_id  text references public.promo_pagos(stripe_invoice_id),
  estado             text not null default 'acreditada' check (estado in ('acreditada','revertida')),
  motivo_reverso     text,          -- 'automatico:reembolso', 'automatico:disputa', 'admin:…'
  revertida_en       timestamptz,
  creada_en          timestamptz not null default now(),
  check ((tipo = 'comision_inicial' and numero_aniversario = 0 and stripe_invoice_id is not null)
      or (tipo = 'aniversario' and numero_aniversario >= 1
          and ventana_desde is not null and ventana_hasta > ventana_desde)),
  -- CLAVE ANTIDUPLICADOS: negocio + tipo + número de aniversario
  unique (negocio_id, tipo, numero_aniversario)
);
-- Una misma ventana de 12 meses nunca se premia dos veces
create unique index promo_recompensas_ventana_uq
  on public.promo_recompensas (negocio_id, ventana_desde) where tipo = 'aniversario';
create index promo_recompensas_promotor_idx on public.promo_recompensas (promotor_id, creada_en);

-- ---------------------------------------------------------------------
-- 11. LIBRO CONTABLE (append-only: nunca se edita ni se borra)
-- ---------------------------------------------------------------------
create table public.promo_movimientos (
  id               bigint generated always as identity primary key,
  promotor_id      uuid not null references public.promo_promotores(id) on delete restrict,
  tipo             text not null check (tipo in (
                     'comision_inicial','recompensa_anio1','recompensa_anio_extra',
                     'reverso','reacreditacion','retiro','retiro_devuelto','ajuste_admin')),
  monto_cents      bigint not null check (monto_cents <> 0),
  -- Desde cuándo cuenta como "disponible". Antes de esa fecha es "pendiente".
  disponible_desde timestamptz not null,
  recompensa_id    uuid references public.promo_recompensas(id),
  retiro_id        uuid references public.promo_retiros(id),
  negocio_id       uuid references public.promo_negocios(id),
  clave            text not null unique,      -- idempotencia: el mismo hecho no entra dos veces
  descripcion      text not null,
  creado_por       uuid,                      -- null = sistema
  creado_en        timestamptz not null default now(),
  check (
    (tipo in ('comision_inicial','recompensa_anio1','recompensa_anio_extra','reacreditacion','retiro_devuelto') and monto_cents > 0)
 or (tipo in ('reverso','retiro') and monto_cents < 0)
 or (tipo = 'ajuste_admin')
  )
);
create index promo_movimientos_promotor_idx on public.promo_movimientos (promotor_id, disponible_desde);

-- ---------------------------------------------------------------------
-- 12. DATOS BANCARIOS (CLABE cifrada; nadie la lee directo)
-- ---------------------------------------------------------------------
create table public.promo_datos_bancarios (
  promotor_id     uuid primary key references public.promo_promotores(id) on delete cascade,
  titular         text not null check (char_length(btrim(titular)) between 3 and 120),
  banco           text not null check (char_length(btrim(banco)) between 2 and 60),
  clabe_cifrada   bytea not null,
  clabe_ultimos4  text not null check (clabe_ultimos4 ~ '^[0-9]{4}$'),
  actualizado_en  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 13. AUDITORÍA ADMINISTRATIVA (append-only)
-- ---------------------------------------------------------------------
create table public.promo_auditoria (
  id                  bigint generated always as identity primary key,
  admin_id            uuid,                     -- quién
  accion              text not null,            -- qué
  tabla               text not null,
  registro_id         text not null,            -- registro afectado
  valor_anterior      jsonb,
  valor_nuevo         jsonb,
  monto_anterior_cents bigint,
  monto_nuevo_cents    bigint,
  motivo              text not null check (char_length(btrim(motivo)) >= 5),
  creado_en           timestamptz not null default now()   -- cuándo
);
create index promo_auditoria_idx on public.promo_auditoria (creado_en desc);

-- ---------------------------------------------------------------------
-- 14. BITÁCORA DE PROCESOS AUTOMÁTICOS (cron y conciliación)
-- ---------------------------------------------------------------------
create table public.promo_corridas (
  id          bigint generated always as identity primary key,
  tipo        text not null check (tipo in ('evaluacion_diaria','conciliacion_stripe')),
  inicio      timestamptz not null default now(),
  fin         timestamptz,
  resultado   jsonb
);

-- ---------------------------------------------------------------------
-- 15. PROTECCIONES A NIVEL DE TABLA
-- ---------------------------------------------------------------------
-- 15.1 Libro contable y auditoría: prohibido UPDATE/DELETE para todos.
create or replace function public.promo_no_modificar()
returns trigger language plpgsql as $$
begin
  raise exception 'La tabla % es de solo agregar: no se puede % registros', tg_table_name, lower(tg_op)
    using errcode = 'P0001';
end $$;

create trigger promo_movimientos_inmutable before update or delete on public.promo_movimientos
  for each row execute function public.promo_no_modificar();
create trigger promo_auditoria_inmutable before update or delete on public.promo_auditoria
  for each row execute function public.promo_no_modificar();
create trigger promo_atribuciones_inmutable before update or delete on public.promo_atribuciones
  for each row execute function public.promo_no_modificar();

-- 15.2 Recompensas: no se borran; solo puede cambiar su estado.
create or replace function public.promo_recompensa_guardia()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Las recompensas no se borran' using errcode = 'P0001';
  end if;
  if (new.negocio_id, new.promotor_id, new.tipo, new.numero_aniversario, new.monto_cents,
      new.ventana_desde, new.ventana_hasta, new.stripe_invoice_id, new.creada_en)
     is distinct from
     (old.negocio_id, old.promotor_id, old.tipo, old.numero_aniversario, old.monto_cents,
      old.ventana_desde, old.ventana_hasta, old.stripe_invoice_id, old.creada_en) then
    raise exception 'Solo el estado de una recompensa puede cambiar' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger promo_recompensas_guardia before update or delete on public.promo_recompensas
  for each row execute function public.promo_recompensa_guardia();

-- 15.3 Pagos y negocios no se borran (son la evidencia de cada recompensa).
create or replace function public.promo_no_borrar()
returns trigger language plpgsql as $$
begin
  raise exception 'No se pueden borrar registros de %', tg_table_name using errcode = 'P0001';
end $$;
create trigger promo_pagos_no_borrar    before delete on public.promo_pagos
  for each row execute function public.promo_no_borrar();
create trigger promo_negocios_no_borrar before delete on public.promo_negocios
  for each row execute function public.promo_no_borrar();
create trigger promo_retiros_no_borrar  before delete on public.promo_retiros
  for each row execute function public.promo_no_borrar();

-- 15.4 actualizado_en automático (función propia; no se reutilizan las existentes)
create or replace function public.promo_tocar()
returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
create trigger promo_promotores_tocar before update on public.promo_promotores for each row execute function public.promo_tocar();
create trigger promo_negocios_tocar   before update on public.promo_negocios   for each row execute function public.promo_tocar();
create trigger promo_pagos_tocar      before update on public.promo_pagos      for each row execute function public.promo_tocar();
create trigger promo_retiros_tocar    before update on public.promo_retiros    for each row execute function public.promo_tocar();
create trigger promo_suscr_tocar      before update on public.promo_suscripciones for each row execute function public.promo_tocar();
create trigger promo_banco_tocar      before update on public.promo_datos_bancarios for each row execute function public.promo_tocar();
create trigger promo_config_tocar     before update on public.promo_config     for each row execute function public.promo_tocar();

commit;
