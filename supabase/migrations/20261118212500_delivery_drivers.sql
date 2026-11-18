create table public.delivery_handoffs (
  order_id text primary key references public.order_chats(order_id) on delete cascade,
  code_hash text not null unique,
  expires_at timestamptz not null,
  driver_id uuid references auth.users(id) on delete set null
);
create index delivery_handoffs_driver on public.delivery_handoffs(driver_id);
create table public.delivery_businesses (
  driver_id uuid references auth.users(id) on delete cascade,
  business_id uuid references auth.users(id) on delete cascade,
  name text not null,
  primary key(driver_id,business_id)
);
alter table public.delivery_handoffs enable row level security;
alter table public.delivery_businesses enable row level security;
revoke all on public.delivery_handoffs,public.delivery_businesses from public,anon,authenticated;
grant select,insert,update on public.delivery_handoffs,public.delivery_businesses to service_role;

create function public.delivery_driver_request(p_actor uuid,p_action text,p_id text,p_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare
  o public.menu_orders%rowtype;
  c public.order_chats%rowtype;
  h public.delivery_handoffs%rowtype;
  target_id text;
  next_state text;
  business_name text;
  payload jsonb;
begin
  if p_actor is null then raise exception 'Inicia sesión para continuar'; end if;
  if p_action='list' then
    return jsonb_build_object('ok',true,
      'businesses',coalesce((select jsonb_agg(jsonb_build_object('name',b.name) order by b.name)
        from public.delivery_businesses b where b.driver_id=p_actor),'[]'::jsonb),
      'orders',coalesce((select jsonb_agg(jsonb_build_object(
        'id',m.id,'code',m.code,'state',q.state,'business',coalesce(b.name,'Negocio'),
        'reference',m.data#>>'{customer,loc,ref}','lat',m.data#>'{customer,loc,lat}','lng',m.data#>'{customer,loc,lng}'
      ) order by m.created_at desc)
      from public.delivery_handoffs d join public.menu_orders m on m.id=d.order_id
      join public.order_chats q on q.order_id=d.order_id
      left join public.delivery_businesses b on b.driver_id=d.driver_id and b.business_id=m.user_id
      where d.driver_id=p_actor and q.state in ('confirmed','preparing','route')),'[]'::jsonb));
  end if;
  if p_action='link' then
    select order_id into target_id from public.delivery_handoffs where code_hash=p_hash;
  else target_id:=p_id;
  end if;
  select * into o from public.menu_orders where id=target_id for update;
  if not found or o.data#>>'{customer,service}' is distinct from 'domicilio' then raise exception 'Pedido no disponible'; end if;
  select * into c from public.order_chats where order_id=target_id for update;
  if not found then raise exception 'Pedido no disponible'; end if;
  select * into h from public.delivery_handoffs where order_id=target_id for update;

  if p_action='invite' then
    if o.user_id<>p_actor or c.state not in ('confirmed','preparing') then raise exception 'Pedido no disponible'; end if;
    if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Código inválido'; end if;
    insert into public.delivery_handoffs(order_id,code_hash,expires_at)
      values (target_id,p_hash,now()+interval '24 hours')
      on conflict(order_id) do update set code_hash=excluded.code_hash, expires_at=excluded.expires_at, driver_id=null;
    return jsonb_build_object('ok',true);
  elsif p_action='link' then
    if h.code_hash is distinct from p_hash or h.expires_at<=now() or
        (h.driver_id is not null and h.driver_id<>p_actor) or c.state not in ('confirmed','preparing')
      then raise exception 'Código vencido o ya utilizado'; end if;
    select coalesce(nullif(data#>>'{biz,name}',''),'Negocio') into business_name from public.public_menus where id=o.menu_id;
    insert into public.delivery_businesses(driver_id,business_id,name)
      values(p_actor,o.user_id,coalesce(business_name,'Negocio'))
      on conflict(driver_id,business_id) do update set name=excluded.name;
    update public.delivery_handoffs set driver_id=p_actor where order_id=target_id;
    return jsonb_build_object('ok',true);
  end if;

  if h.driver_id is distinct from p_actor then raise exception 'Pedido no disponible'; end if;
  if p_action='start' and c.state in ('confirmed','preparing','route') then next_state:='route';
  elsif p_action='deliver' and c.state in ('route','delivered') then next_state:='delivered';
  else raise exception 'El pedido ya cambió de estado'; end if;
  -- Reuse the same state transition and customer notification as the POS.
  payload:=public.order_chat_request(target_id,null,o.user_id,'state',jsonb_build_object('state',next_state));
  return jsonb_build_object('ok',true,'state',payload->>'state');
end $$;
revoke all on function public.delivery_driver_request(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.delivery_driver_request(uuid,text,text,text) to service_role;
