-- =====================================================================
-- Vendo+ · Esquema de Supabase.  Pégalo completo en SQL Editor y dale "Run".
-- =====================================================================

-- 1) Membresía de cada cuenta. El cliente SOLO puede leerla; la escribe
--    el servidor (trigger al crear cuenta y webhook de Stripe).
create table if not exists public.profiles (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  trial_start        timestamptz not null default now(),
  trial_end          timestamptz not null default (now() + interval '1 month'),  -- prueba de 1 mes
  paid_until         timestamptz,
  stripe_customer_id text unique,
  created_at         timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "leer mi perfil" on public.profiles for select using (auth.uid() = user_id);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Cuentas que ya existan antes de correr este script
insert into public.profiles (user_id) select id from auth.users on conflict do nothing;

-- 2) ¿La cuenta tiene acceso? (prueba vigente o membresía pagada)
create or replace function public.has_access(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where user_id = uid and (trial_end > now() or coalesce(paid_until, '-infinity') > now())
  );
$$;

-- 3) Datos del negocio (productos, ventas, clientes, caja, etc.)
--    Una fila por cada "caja" de datos de la app: (usuario, clave) -> JSON
create table if not exists public.user_data (
  user_id    uuid not null references auth.users(id) on delete cascade,
  key        text not null,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);
alter table public.user_data enable row level security;
create policy "leer mis datos"   on public.user_data for select using (auth.uid() = user_id);
create policy "crear mis datos"  on public.user_data for insert with check (auth.uid() = user_id and public.has_access(auth.uid()));
create policy "editar mis datos" on public.user_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id and public.has_access(auth.uid()));
create policy "borrar mis datos" on public.user_data for delete using (auth.uid() = user_id);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch before update on public.user_data
  for each row execute function public.touch_updated_at();

-- 4) Fotos (productos, logo, perfil). Cada quien solo escribe en su carpeta.
insert into storage.buckets (id, name, public) values ('fotos', 'fotos', true)
  on conflict (id) do nothing;
create policy "ver fotos"      on storage.objects for select using (bucket_id = 'fotos');
create policy "subir mis fotos" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access(auth.uid()));
create policy "editar mis fotos" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text and public.has_access(auth.uid()));
create policy "borrar mis fotos" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and (storage.foldername(name))[1] = auth.uid()::text);
