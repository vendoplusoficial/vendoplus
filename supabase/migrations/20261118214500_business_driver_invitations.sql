create table public.delivery_business_invites (
  business_id uuid primary key references auth.users(id) on delete cascade,
  code text not null unique check (code ~ '^[a-f0-9]{32}$'),
  name text not null
);
alter table public.delivery_business_invites enable row level security;
revoke all on public.delivery_business_invites from public,anon,authenticated;
grant select,insert,update on public.delivery_business_invites to service_role;

create function public.delivery_business_request(p_actor uuid,p_action text,p_code text,p_name text,p_id text,p_driver uuid,p_hash text)
returns jsonb language plpgsql set search_path='' as $$
declare
  invitation public.delivery_business_invites%rowtype;
  target public.menu_orders%rowtype;
  state text;
begin
  if p_actor is null then raise exception 'Inicia sesión para continuar'; end if;
  if p_action='business-invite' then
    insert into public.delivery_business_invites(business_id,code,name)
      values(p_actor,p_code,coalesce(nullif(left(btrim(p_name),120),''),'Negocio'))
      on conflict(business_id) do update set name=excluded.name
      returning * into invitation;
    return jsonb_build_object('ok',true,'code',invitation.code);
  elsif p_action='business-link' then
    select * into invitation from public.delivery_business_invites where code=p_code;
    if not found then raise exception 'Invitación de negocio inválida'; end if;
    insert into public.delivery_businesses(driver_id,business_id,name)
      values(p_actor,invitation.business_id,invitation.name)
      on conflict(driver_id,business_id) do update set name=excluded.name;
    return jsonb_build_object('ok',true,'name',invitation.name);
  elsif p_action='business-drivers' then
    return jsonb_build_object('ok',true,'drivers',coalesce((
      select jsonb_agg(jsonb_build_object('id',u.id,'label',coalesce(u.email,'Repartidor')) order by u.email)
      from public.delivery_businesses b join auth.users u on u.id=b.driver_id
      where b.business_id=p_actor
    ),'[]'::jsonb));
  elsif p_action='business-assign' then
    select * into target from public.menu_orders where id=p_id for update;
    if not found or target.user_id<>p_actor or target.data#>>'{customer,service}' is distinct from 'domicilio'
      then raise exception 'Pedido no disponible'; end if;
    select c.state into state from public.order_chats c where c.order_id=p_id for update;
    if not found or state not in ('confirmed','preparing') then raise exception 'El pedido ya cambió de estado'; end if;
    if not exists(select 1 from public.delivery_businesses b where b.business_id=p_actor and b.driver_id=p_driver)
      then raise exception 'Este repartidor todavía no está enlazado'; end if;
    insert into public.delivery_handoffs(order_id,code_hash,expires_at,driver_id)
      values(p_id,p_hash,now(),p_driver)
      on conflict(order_id) do update set code_hash=excluded.code_hash,expires_at=excluded.expires_at,driver_id=excluded.driver_id;
    return jsonb_build_object('ok',true);
  end if;
  raise exception 'Acción inválida';
end $$;
revoke all on function public.delivery_business_request(uuid,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.delivery_business_request(uuid,text,text,text,text,uuid,text) to service_role;
