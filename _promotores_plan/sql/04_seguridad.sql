-- =====================================================================
-- VENDOPLUS · PROMOTORES · 04 SEGURIDAD (RLS y permisos)
-- ---------------------------------------------------------------------
-- Principio: el navegador NUNCA escribe directo en las tablas promo_*.
--   · Lectura directa: solo lo propio (promotor) o todo (administrador).
--   · Escritura: únicamente por funciones SECURITY DEFINER que validan.
--   · Datos bancarios: ni el promotor ni el administrador los leen directo.
-- Solo afecta objetos promo_*; no toca permisos de tablas existentes.
-- =====================================================================
begin;

-- 1) RLS en TODAS las tablas nuevas
alter table public.promo_config          enable row level security;
alter table public.promo_admins          enable row level security;
alter table public.promo_promotores      enable row level security;
alter table public.promo_negocios        enable row level security;
alter table public.promo_atribuciones    enable row level security;
alter table public.promo_suscripciones   enable row level security;
alter table public.promo_pagos           enable row level security;
alter table public.promo_eventos         enable row level security;
alter table public.promo_retiros         enable row level security;
alter table public.promo_recompensas     enable row level security;
alter table public.promo_movimientos     enable row level security;
alter table public.promo_datos_bancarios enable row level security;
alter table public.promo_auditoria       enable row level security;
alter table public.promo_corridas        enable row level security;

-- 2) Quitar todo permiso de tabla a anon/authenticated y dar solo SELECT donde aplica
revoke all on public.promo_config, public.promo_admins, public.promo_promotores, public.promo_negocios,
              public.promo_atribuciones, public.promo_suscripciones, public.promo_pagos, public.promo_eventos,
              public.promo_retiros, public.promo_recompensas, public.promo_movimientos,
              public.promo_datos_bancarios, public.promo_auditoria, public.promo_corridas
  from anon, authenticated;

grant select on public.promo_promotores, public.promo_recompensas, public.promo_movimientos, public.promo_retiros,
                public.promo_negocios, public.promo_atribuciones, public.promo_suscripciones, public.promo_pagos,
                public.promo_eventos, public.promo_auditoria, public.promo_corridas, public.promo_config
  to authenticated;
-- promo_datos_bancarios y promo_admins: SIN permiso para anon/authenticated.

-- 3) Políticas de lectura
create policy promo_promotores_leer on public.promo_promotores for select to authenticated
  using (user_id = auth.uid() or public.promo_es_admin());

create policy promo_recompensas_leer on public.promo_recompensas for select to authenticated
  using (promotor_id in (select id from public.promo_promotores where user_id = auth.uid()) or public.promo_es_admin());

create policy promo_movimientos_leer on public.promo_movimientos for select to authenticated
  using (promotor_id in (select id from public.promo_promotores where user_id = auth.uid()) or public.promo_es_admin());

create policy promo_retiros_leer on public.promo_retiros for select to authenticated
  using (promotor_id in (select id from public.promo_promotores where user_id = auth.uid()) or public.promo_es_admin());

-- Solo administrador (contienen correos de negocios, pagos o bitácoras)
create policy promo_negocios_admin     on public.promo_negocios      for select to authenticated using (public.promo_es_admin());
create policy promo_atribuciones_admin on public.promo_atribuciones  for select to authenticated using (public.promo_es_admin());
create policy promo_suscr_admin        on public.promo_suscripciones for select to authenticated using (public.promo_es_admin());
create policy promo_pagos_admin        on public.promo_pagos         for select to authenticated using (public.promo_es_admin());
create policy promo_eventos_admin      on public.promo_eventos       for select to authenticated using (public.promo_es_admin());
create policy promo_auditoria_admin    on public.promo_auditoria     for select to authenticated using (public.promo_es_admin());
create policy promo_corridas_admin     on public.promo_corridas      for select to authenticated using (public.promo_es_admin());
create policy promo_config_admin       on public.promo_config        for select to authenticated using (public.promo_es_admin());
-- Sin políticas de INSERT/UPDATE/DELETE: con RLS activo, quedan prohibidas.

-- 4) Funciones: por defecto Postgres/Supabase dan EXECUTE a todos.
--    Se quita a public/anon/authenticated en TODAS las promo_* y luego se
--    concede una por una solo lo que debe ser llamable desde las páginas.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'promo\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;

-- Página pública del enlace (sin sesión)
grant execute on function public.promo_codigo_info(text) to anon, authenticated;

-- Necesaria para evaluar las políticas RLS
grant execute on function public.promo_es_admin() to authenticated;

-- Negocio
grant execute on function public.promo_mi_negocio() to authenticated;

-- Promotor
grant execute on function public.promo_registrar_promotor(text, text)              to authenticated;
grant execute on function public.promo_mi_panel()                                  to authenticated;
grant execute on function public.promo_mis_negocios(date)                          to authenticated;
grant execute on function public.promo_mis_negocios_por_mes()                      to authenticated;
grant execute on function public.promo_guardar_datos_bancarios(text, text, text)   to authenticated;
grant execute on function public.promo_mis_datos_bancarios()                       to authenticated;
grant execute on function public.promo_solicitar_retiro(bigint)                    to authenticated;
grant execute on function public.promo_cancelar_retiro(uuid)                       to authenticated;

-- Administrador (cada una vuelve a verificar promo_es_admin() por dentro)
grant execute on function public.promo_admin_promotores()                                     to authenticated;
grant execute on function public.promo_admin_negocios(uuid)                                   to authenticated;
grant execute on function public.promo_admin_detalle_negocio(uuid)                            to authenticated;
grant execute on function public.promo_admin_promotor_estado(uuid, text, text)                to authenticated;
grant execute on function public.promo_admin_retiro(uuid, text, text, text, timestamptz)      to authenticated;
grant execute on function public.promo_admin_exportar_retiros(text[])                         to authenticated;
grant execute on function public.promo_admin_ajuste(uuid, bigint, text, uuid)                 to authenticated;
grant execute on function public.promo_admin_recompensa(uuid, text, text)                     to authenticated;
grant execute on function public.promo_admin_reasignar_negocio(uuid, uuid, text)              to authenticated;
grant execute on function public.promo_admin_reprocesar(uuid, text)                           to authenticated;

-- Internas (promo_asociar, promo_procesar_negocio, promo_registrar_pago,
-- promo_mover, promo_saldos, promo_segmentos, …): SOLO service_role.

-- 5) Administrador maestro. Reemplazar <CORREO_ADMIN> antes de ejecutar.
insert into public.promo_admins (user_id, nota)
select id, 'Administrador maestro' from auth.users where lower(email) = lower('<CORREO_ADMIN>')
on conflict do nothing;

commit;
