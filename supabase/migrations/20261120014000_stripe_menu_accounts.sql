create table public.stripe_menu_accounts (
  user_id uuid not null references auth.users(id) on delete cascade,
  livemode boolean not null,
  stripe_account_id text not null check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  primary key (user_id, livemode),
  unique (stripe_account_id, livemode)
);

alter table public.stripe_menu_accounts enable row level security;
revoke all on public.stripe_menu_accounts from public, anon, authenticated;
grant select, insert on public.stripe_menu_accounts to service_role;
