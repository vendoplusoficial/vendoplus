select cron.schedule('stripe-menu-test-delivery', '* * * * *', $job$
  select net.http_post(
    url := 'https://yacmyrpluhjaphvrbqno.supabase.co/functions/v1/stripe-menu-test-checkout',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-stripe-test-worker',
      (select decrypted_secret from vault.decrypted_secrets where name = 'stripe_menu_test_worker')),
    body := '{}'::jsonb,
    timeout_milliseconds := 45000
  );
$job$);