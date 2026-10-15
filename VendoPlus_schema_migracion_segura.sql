-- =====================================================================
-- Vendo+ · MIGRACIÓN SEGURA DE schema.sql
-- Pégalo completo en Supabase > SQL Editor > Run.
-- NO borra tablas, NO borra datos y puede ejecutarse sobre tu proyecto actual.
-- =====================================================================

-- ============================================================
-- 1) PROFILES / MEMBRESÍA
-- ============================================================
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  trial_start timestamptz not null default now(),
  trial_end timestamptz not null default (now() + interval '1 month'),
  paid_until timestamptz,
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

-- Si la tabla ya existía, agrega únicamente lo que pudiera faltar.
alter table public.profiles add column if not exists trial_start timestamptz;
alter table public.profiles add column if not exists trial_end timestamptz;
alter table public.profiles add column if not exists paid_until timestamptz;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists created_at timestamptz;

-- Completa valores nulos antes de aplicar los valores por defecto.
update public.profiles
set trial_start = coalesce(trial_start, now()),
    trial_end = coalesce(trial_end, now() + interval '1 month'),
    created_at = coalesce(created_at, now())
where trial_start is null
   or trial_end is null
   or created_at is null;

alter table public.profiles alter column trial_start set default now();
alter table public.profiles alter column trial_end set default (now() + interval '1 month');
alter table public.profiles alter column created_at set default now();
alter table public.profiles alter column trial_start set not null;
alter table public.profiles alter column trial_end set not null;
alter table public.profiles alter column created_at set not null;

alter table public.profiles enable row level security;

drop policy if exists "leer mi perfil" on public.profiles;
create policy "leer mi perfil"
on public.profiles for select
using (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

insert into public.profiles (user_id)
select id from auth.users
on conflict do nothing;

create or replace function public.has_access(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where user_id = uid
      and (
        trial_end > now()
        or coalesce(paid_until, '-infinity') > now()
      )
  );
$$;

grant execute on function public.has_access(uuid) to anon, authenticated;


-- ============================================================
-- 2) DATOS DEL NEGOCIO
-- ============================================================
create table if not exists public.user_data (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.user_data add column if not exists value jsonb;
alter table public.user_data add column if not exists updated_at timestamptz;

update public.user_data
set updated_at = coalesce(updated_at, now())
where updated_at is null;

alter table public.user_data alter column updated_at set default now();
alter table public.user_data alter column updated_at set not null;

alter table public.user_data enable row level security;

drop policy if exists "leer mis datos" on public.user_data;
create policy "leer mis datos"
on public.user_data for select
using (auth.uid() = user_id);

drop policy if exists "crear mis datos" on public.user_data;
create policy "crear mis datos"
on public.user_data for insert
with check (
  auth.uid() = user_id
  and public.has_access(auth.uid())
);

drop policy if exists "editar mis datos" on public.user_data;
create policy "editar mis datos"
on public.user_data for update
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and public.has_access(auth.uid())
);

drop policy if exists "borrar mis datos" on public.user_data;
create policy "borrar mis datos"
on public.user_data for delete
using (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_data_touch on public.user_data;
create trigger user_data_touch
before update on public.user_data
for each row execute function public.touch_updated_at();


-- ============================================================
-- 3) FOTOS
-- ============================================================
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do nothing;

drop policy if exists "ver fotos" on storage.objects;
create policy "ver fotos"
on storage.objects for select
using (bucket_id = 'fotos');

drop policy if exists "subir mis fotos" on storage.objects;
create policy "subir mis fotos"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'fotos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_access(auth.uid())
);

drop policy if exists "editar mis fotos" on storage.objects;
create policy "editar mis fotos"
on storage.objects for update to authenticated
using (
  bucket_id = 'fotos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and public.has_access(auth.uid())
);

drop policy if exists "borrar mis fotos" on storage.objects;
create policy "borrar mis fotos"
on storage.objects for delete to authenticated
using (
  bucket_id = 'fotos'
  and (storage.foldername(name))[1] = auth.uid()::text
);


-- ============================================================
-- 4) MENÚ DIGITAL PÚBLICO
-- ============================================================
create table if not exists public.public_menus (
  id text primary key check (char_length(id) between 4 and 64),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.public_menus add column if not exists data jsonb;
alter table public.public_menus add column if not exists updated_at timestamptz;

update public.public_menus
set updated_at = coalesce(updated_at, now())
where updated_at is null;

alter table public.public_menus alter column updated_at set default now();
alter table public.public_menus alter column updated_at set not null;

create index if not exists public_menus_user_idx
on public.public_menus (user_id);

alter table public.public_menus enable row level security;

drop policy if exists "ver menus publicos" on public.public_menus;
create policy "ver menus publicos"
on public.public_menus
for select to anon, authenticated
using (public.has_access(user_id));

drop policy if exists "publicar mi menu" on public.public_menus;
create policy "publicar mi menu"
on public.public_menus
for insert to authenticated
with check (
  auth.uid() = user_id
  and public.has_access(auth.uid())
);

drop policy if exists "actualizar mi menu" on public.public_menus;
create policy "actualizar mi menu"
on public.public_menus
for update to authenticated
using (auth.uid() = user_id)
with check (
  auth.uid() = user_id
  and public.has_access(auth.uid())
);

drop policy if exists "quitar mi menu" on public.public_menus;
create policy "quitar mi menu"
on public.public_menus
for delete to authenticated
using (auth.uid() = user_id);

grant select on public.public_menus to anon, authenticated;
grant insert, update, delete on public.public_menus to authenticated;


-- ============================================================
-- 5) PEDIDOS DEL MENÚ DIGITAL
-- ============================================================
create table if not exists public.menu_orders (
  id text primary key check (id ~ '^o[a-z0-9]{6,24}$'),
  menu_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null check (code ~ '^MD-[A-Z0-9]{4,6}$'),
  data jsonb not null,
  created_at timestamptz not null default now(),
  received_at timestamptz
);

alter table public.menu_orders add column if not exists menu_id text;
alter table public.menu_orders add column if not exists code text;
alter table public.menu_orders add column if not exists data jsonb;
alter table public.menu_orders add column if not exists created_at timestamptz;
alter table public.menu_orders add column if not exists received_at timestamptz;

update public.menu_orders
set created_at = coalesce(created_at, now())
where created_at is null;

alter table public.menu_orders alter column created_at set default now();
alter table public.menu_orders alter column created_at set not null;

create index if not exists menu_orders_user_idx
on public.menu_orders (user_id, created_at desc);

create index if not exists menu_orders_pending_idx
on public.menu_orders (user_id)
where received_at is null;

create index if not exists menu_orders_menu_idx
on public.menu_orders (menu_id, created_at desc);

alter table public.menu_orders enable row level security;

drop policy if exists "ver mis pedidos del menu" on public.menu_orders;
create policy "ver mis pedidos del menu"
on public.menu_orders
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "marcar mis pedidos del menu" on public.menu_orders;
create policy "marcar mis pedidos del menu"
on public.menu_orders
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "borrar mis pedidos del menu" on public.menu_orders;
create policy "borrar mis pedidos del menu"
on public.menu_orders
for delete to authenticated
using (auth.uid() = user_id);

revoke all on public.menu_orders from anon;
grant select, update, delete on public.menu_orders to authenticated;


-- ============================================================
-- 6) FUNCIÓN PARA RECIBIR PEDIDOS
-- ============================================================
create or replace function public.submit_menu_order(
  p_menu_id text,
  p_order jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_id text := p_order->>'id';
  v_code text := upper(coalesce(p_order->>'code', ''));
  v_lines jsonb := p_order->'original';
  v_n int;
begin
  if p_menu_id is null
     or char_length(p_menu_id) not between 4 and 64 then
    raise exception 'menu_not_found' using errcode = 'P0002';
  end if;

  select user_id
  into v_user
  from public.public_menus
  where id = p_menu_id;

  if v_user is null then
    raise exception 'menu_not_found' using errcode = 'P0002';
  end if;

  if not public.has_access(v_user) then
    raise exception 'menu_paused' using errcode = 'P0001';
  end if;

  if v_id is null
     or v_id !~ '^o[a-z0-9]{6,24}$'
     or v_code !~ '^MD-[A-Z0-9]{4,6}$'
     or jsonb_typeof(v_lines) is distinct from 'array'
     or octet_length(p_order::text) > 30000 then
    raise exception 'bad_order' using errcode = '22023';
  end if;

  v_n := jsonb_array_length(v_lines);

  if v_n < 1 or v_n > 150 then
    raise exception 'bad_order' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.menu_orders
    where menu_id = p_menu_id
      and created_at > now() - interval '1 minute'
  ) >= 40 then
    raise exception 'too_many_orders' using errcode = 'P0001';
  end if;

  insert into public.menu_orders (
    id, menu_id, user_id, code, data
  )
  values (
    v_id,
    p_menu_id,
    v_user,
    v_code,
    jsonb_build_object(
      'customer', coalesce(p_order->'customer', '{}'::jsonb),
      'original', v_lines
    )
  )
  on conflict (id) do nothing;

  delete from public.menu_orders
  where user_id = v_user
    and created_at < now() - interval '60 days';

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'code', v_code
  );
end;
$$;

revoke all on function public.submit_menu_order(text, jsonb) from public;
grant execute on function public.submit_menu_order(text, jsonb) to anon, authenticated;


-- ============================================================
-- 7) REALTIME
-- ============================================================
do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  )
  and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'menu_orders'
  ) then
    alter publication supabase_realtime
    add table public.menu_orders;
  end if;
end;
$$;

-- =====================================================================
-- FIN DE LA MIGRACIÓN
-- =====================================================================
