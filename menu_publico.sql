-- =====================================================================
-- Vendo plus · Menú Digital público
-- Para que el link del menú abra en el celular de CUALQUIER persona.
-- Pégalo completo en Supabase → SQL Editor → Run.  (Se puede correr
-- más de una vez sin problema.)
-- =====================================================================

-- La copia del menú que ven tus clientes. Solo lleva lo que se muestra
-- en el menú (nombre, logo, color, horario, WhatsApp, productos activos
-- y precios). Nunca costos, ventas, clientes ni correos.
create table if not exists public.public_menus (
  id         text primary key check (char_length(id) between 4 and 64),  -- el id del link: …/#menu/<id>
  user_id    uuid not null references auth.users(id) on delete cascade,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists public_menus_user_idx on public.public_menus (user_id);
alter table public.public_menus enable row level security;

-- Cualquiera con el link lo puede ver, mientras la cuenta tenga acceso
-- (prueba vigente o membresía pagada). Si la cuenta se pausa, el menú también.
drop policy if exists "ver menus publicos" on public.public_menus;
create policy "ver menus publicos" on public.public_menus
  for select to anon, authenticated using (public.has_access(user_id));

-- Solo el dueño de la cuenta publica, cambia o quita su menú.
drop policy if exists "publicar mi menu" on public.public_menus;
create policy "publicar mi menu" on public.public_menus
  for insert to authenticated with check (auth.uid() = user_id and public.has_access(auth.uid()));
drop policy if exists "actualizar mi menu" on public.public_menus;
create policy "actualizar mi menu" on public.public_menus
  for update to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id and public.has_access(auth.uid()));
drop policy if exists "quitar mi menu" on public.public_menus;
create policy "quitar mi menu" on public.public_menus
  for delete to authenticated using (auth.uid() = user_id);

grant select on public.public_menus to anon, authenticated;
grant insert, update, delete on public.public_menus to authenticated;
grant execute on function public.has_access(uuid) to anon, authenticated;
