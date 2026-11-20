alter table public.stripe_menu_accounts add column if not exists connected boolean not null default true;
