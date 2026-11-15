-- =====================================================================
-- VENDOPLUS · PROMOTORES · 05 AUTOMATIZACIÓN (cron diario)
-- ---------------------------------------------------------------------
-- Activa dos extensiones NUEVAS (no existen hoy): pg_cron y pg_net.
-- No afectan a nada existente; solo se usan para los 2 trabajos de abajo.
-- Los secretos se generan al implementar y NO se escriben en este archivo.
-- =====================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Secretos en Vault (se ejecutan una sola vez con valores aleatorios reales):
--   select vault.create_secret('<64 caracteres aleatorios>', 'promo_cron_secret', 'Llave de la conciliación diaria');
--   select vault.create_secret('<64 caracteres aleatorios>', 'promo_clave_bancaria', 'Cifrado de CLABEs de promotores');
-- El mismo valor de promo_cron_secret se guarda como secreto de Edge Functions
-- PROMO_CRON_SECRET (lo comprueba promo-conciliar).
-- ⚠ promo_clave_bancaria: si se borra, las CLABEs guardadas ya no se pueden leer.

-- 1) 03:17 hora de CDMX (09:17 UTC): conciliación con Stripe (Edge Function)
select cron.schedule('promo_conciliacion_stripe', '17 9 * * *', $cron$
  select net.http_post(
    url     := 'https://yacmyrpluhjaphvrbqno.supabase.co/functions/v1/promo-conciliar',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-promo-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'promo_cron_secret')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 150000);
$cron$);

-- 2) 04:47 hora de CDMX: evaluación de aniversarios y validez (solo SQL).
--    Corre aunque la conciliación falle: los aniversarios no dependen de
--    que llegue un evento ese día.
select cron.schedule('promo_evaluacion_diaria', '47 10 * * *', $cron$
  select public.promo_evaluar_todos();
$cron$);
