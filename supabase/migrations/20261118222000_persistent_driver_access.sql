create table public.pos_delivery_access (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  driver_id uuid not null references public.pos_delivery_drivers(id) on delete cascade
);
create index pos_delivery_access_driver on public.pos_delivery_access(driver_id);
alter table public.pos_delivery_access enable row level security;
revoke all on public.pos_delivery_access from public,anon,authenticated;
grant select,insert,delete on public.pos_delivery_access to service_role;

create function public.pos_delivery_access_request(p_action text,p_hash text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  profile public.pos_delivery_drivers%rowtype;
  business_code text;
  response jsonb;
begin
  if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'expired',true,'error','Vuelve a entrar a reparto');
  end if;
  if p_action='enter' then
    response := public.pos_delivery_request(null,'enter',p_payload);
    select d.* into strict profile from public.pos_delivery_drivers d
      join public.pos_delivery_codes b on b.business_id=d.business_id
      where b.code=upper(btrim(p_payload->>'code')) and d.name=response->>'name'
      for key share of d;
    insert into public.pos_delivery_access(token_hash,driver_id) values(p_hash,profile.id);
    return response;
  elsif p_action='logout' then
    delete from public.pos_delivery_access where token_hash=p_hash;
    return jsonb_build_object('ok',true);
  elsif p_action not in ('list','start','deliver') then
    raise exception 'Acción inválida';
  end if;
  select d.* into profile from public.pos_delivery_access a
    join public.pos_delivery_drivers d on d.id=a.driver_id
    where a.token_hash=p_hash for key share of d;
  if not found then
    return jsonb_build_object('ok',false,'expired',true,'error','Tu acceso a reparto ya no está disponible');
  end if;
  select code into strict business_code from public.pos_delivery_codes where business_id=profile.business_id;
  return public.pos_delivery_request(null,p_action,p_payload || jsonb_build_object('name',profile.name,'code',business_code));
end $$;
revoke all on function public.pos_delivery_access_request(text,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_delivery_access_request(text,text,jsonb) to service_role;
