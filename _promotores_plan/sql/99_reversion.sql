-- =====================================================================
-- VENDOPLUS · PROMOTORES · 99 REVERSIÓN
-- ---------------------------------------------------------------------
-- NIVEL 1 (recomendado ante cualquier duda): APAGAR sin borrar nada.
--   · El enlace deja de asociar, promo-checkout deja de dar descuento
--     (la app vuelve sola al cobro normal de $199 con create-checkout).
--   · Se conserva todo el historial y el dinero de los promotores.
-- =====================================================================
update public.promo_config set programa_activo = false;
select cron.unschedule('promo_conciliacion_stripe');
select cron.unschedule('promo_evaluacion_diaria');
-- + En Stripe: desactivar (no borrar) el endpoint de promo-stripe-eventos.
-- + Quitar la línea <script src="vendo-promotores.js"> de index.html.
-- Nada de esto toca profiles, create-checkout, stripe-webhook ni Google Play.

-- =====================================================================
-- NIVEL 2 (solo con autorización expresa): ELIMINAR el sistema.
-- ⚠ Borra el historial contable de los promotores. ANTES exportar:
--   promo_movimientos, promo_recompensas, promo_retiros, promo_negocios,
--   promo_auditoria (CSV desde el panel de Supabase).
-- ⚠ No quita el cupón de suscripciones que ya lo tengan: esos negocios
--   seguirían pagando $149.25 hasta que se decida otra cosa en Stripe.
-- Se deja comentado a propósito para que no se ejecute por accidente.
-- =====================================================================
/*
begin;
drop table if exists
  public.promo_movimientos, public.promo_retiros, public.promo_recompensas, public.promo_pagos,
  public.promo_suscripciones, public.promo_eventos, public.promo_atribuciones, public.promo_datos_bancarios,
  public.promo_negocios, public.promo_promotores, public.promo_auditoria, public.promo_corridas,
  public.promo_admins, public.promo_config
  cascade;   -- cascade solo arrastra objetos promo_* (triggers/políticas de estas tablas)

do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'promo\_%'
  loop execute 'drop function if exists ' || f.sig || ' cascade'; end loop;
end $$;

delete from vault.secrets where name in ('promo_cron_secret', 'promo_clave_bancaria');
commit;
-- Las extensiones pg_cron / pg_net pueden quedarse (no afectan) o
-- quitarse con: drop extension pg_net; drop extension pg_cron;
-- Edge Functions: borrar promo-asociar, promo-checkout, promo-stripe-eventos, promo-conciliar.
-- Stripe: borrar el endpoint promo y archivar el cupón VP_PROMOTOR_25.
*/
