create table public.pos_delivery_codes (
  business_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[A-F0-9]{16}$'),
  name text not null
);
create table public.pos_delivery_drivers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.pos_delivery_codes(business_id) on delete cascade,
  name text not null,
  name_key text not null,
  unique(business_id,name_key)
);
create table public.pos_delivery_assignments (
  order_id text primary key references public.order_chats(order_id) on delete cascade,
  driver_id uuid not null references public.pos_delivery_drivers(id) on delete cascade
);
create index pos_delivery_assignments_driver on public.pos_delivery_assignments(driver_id);
alter table public.pos_delivery_codes enable row level security;
alter table public.pos_delivery_drivers enable row level security;
alter table public.pos_delivery_assignments enable row level security;
revoke all on public.pos_delivery_codes,public.pos_delivery_drivers,public.pos_delivery_assignments from public,anon,authenticated;
grant select,insert,update,delete on public.pos_delivery_codes,public.pos_delivery_drivers,public.pos_delivery_assignments to service_role;

create function public.pos_delivery_request(p_actor uuid,p_action text,p_payload jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare
  business public.pos_delivery_codes%rowtype;
  driver public.pos_delivery_drivers%rowtype;
  purchase public.menu_orders%rowtype;
  tracking text;
  display_name text;
  normalized text;
  next_state text;
  order_id_arg text := p_payload->>'id';
begin
  if p_action in ('manage','remove','assign') then
    if p_actor is null then raise exception 'Inicia sesión como negocio'; end if;
    if p_action='manage' then
      insert into public.pos_delivery_codes(business_id,code,name)
        values(p_actor,p_payload->>'new_code',coalesce(nullif(left(btrim(p_payload->>'business_name'),120),''),'Negocio'))
        on conflict(business_id) do update set name=excluded.name
        returning * into business;
      return jsonb_build_object('ok',true,'code',business.code,'drivers',coalesce((
        select jsonb_agg(jsonb_build_object('id',d.id,'name',d.name) order by d.name_key)
        from public.pos_delivery_drivers d where d.business_id=p_actor),'[]'::jsonb));
    end if;
    if p_action='remove' then
      delete from public.pos_delivery_drivers where business_id=p_actor and id=(p_payload->>'driver')::uuid;
      return jsonb_build_object('ok',true);
    end if;
    select * into purchase from public.menu_orders where id=order_id_arg for update;
    if not found or purchase.user_id<>p_actor or purchase.data#>>'{customer,service}' is distinct from 'domicilio' then
      raise exception 'Pedido no disponible';
    end if;
    select state into tracking from public.order_chats where order_id=order_id_arg for update;
    if not found or tracking not in ('confirmed','preparing','route') then raise exception 'El pedido ya cambió de estado'; end if;
    select * into driver from public.pos_delivery_drivers
      where id=(p_payload->>'driver')::uuid and business_id=p_actor for key share;
    if not found then raise exception 'El repartidor no pertenece a este negocio'; end if;
    insert into public.pos_delivery_assignments(order_id,driver_id) values(order_id_arg,driver.id)
      on conflict(order_id) do update set driver_id=excluded.driver_id;
    return jsonb_build_object('ok',true);
  end if;

  if p_action not in ('enter','list','start','deliver') then raise exception 'Acción inválida'; end if;
  select * into business from public.pos_delivery_codes where code=upper(btrim(p_payload->>'code'));
  if not found then raise exception 'Código de negocio incorrecto'; end if;
  display_name := regexp_replace(btrim(coalesce(p_payload->>'name','')),'[[:space:]]+',' ','g');
  if char_length(display_name) not between 2 and 50 or display_name ~ '[[:cntrl:]]'
    then raise exception 'Escribe un nombre de 2 a 50 caracteres'; end if;
  normalized := translate(lower(display_name),'áéíóúü','aeiouu');
  if p_action='enter' then
    insert into public.pos_delivery_drivers(business_id,name,name_key)
      values(business.business_id,display_name,normalized) on conflict(business_id,name_key) do nothing;
  end if;
  select * into driver from public.pos_delivery_drivers
    where business_id=business.business_id and name_key=normalized;
  if not found then raise exception 'El negocio eliminó este perfil. Vuelve a entrar si necesitas registrarlo.'; end if;
  if p_action in ('enter','list') then
    return jsonb_build_object('ok',true,'name',driver.name,'business',business.name,'orders',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',m.id,'code',m.code,'state',c.state,'reference',m.data#>>'{customer,loc,ref}',
        'lat',m.data#>'{customer,loc,lat}','lng',m.data#>'{customer,loc,lng}'
      ) order by m.created_at desc)
      from public.pos_delivery_assignments a join public.menu_orders m on m.id=a.order_id
      join public.order_chats c on c.order_id=a.order_id
      where a.driver_id=driver.id and c.state in ('confirmed','preparing','route')),'[]'::jsonb));
  end if;

  select * into purchase from public.menu_orders where id=order_id_arg for update;
  if not found or purchase.user_id<>business.business_id then raise exception 'Pedido no disponible'; end if;
  select state into tracking from public.order_chats where order_id=order_id_arg for update;
  perform 1 from public.pos_delivery_assignments where order_id=order_id_arg and driver_id=driver.id for update;
  if not found then raise exception 'Este pedido no está asignado a tu perfil'; end if;
  if p_action='start' and tracking in ('confirmed','preparing','route') then next_state:='route';
  elsif p_action='deliver' and tracking in ('route','delivered') then next_state:='delivered';
  else raise exception 'El pedido ya cambió de estado'; end if;
  perform public.order_chat_request(order_id_arg,null,business.business_id,'state',jsonb_build_object('state',next_state));
  return jsonb_build_object('ok',true,'state',next_state);
end $$;
revoke all on function public.pos_delivery_request(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.pos_delivery_request(uuid,text,jsonb) to service_role;
