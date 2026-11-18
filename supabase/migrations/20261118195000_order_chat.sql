create table public.order_chats (
  order_id text primary key references public.menu_orders(id) on delete cascade,
  token_hash text not null unique,
  topic uuid not null default gen_random_uuid(),
  state text not null check (state in ('payment','pending','confirmed','preparing','route','delivered','rejected','cancelled')),
  eta integer,
  total numeric not null,
  customer_read bigint not null default 0,
  business_read bigint not null default 0
);
create table public.order_chat_messages (
  id bigint generated always as identity primary key,
  order_id text not null references public.order_chats(order_id) on delete cascade,
  author text not null check (author in ('system','customer','business')),
  body text not null check (char_length(body) between 1 and 1000),
  nonce uuid,
  created_at timestamptz not null default now(),
  unique (order_id, author, nonce)
);
create index order_chat_messages_timeline on public.order_chat_messages(order_id, id);
alter table public.order_chats enable row level security;
alter table public.order_chat_messages enable row level security;
revoke all on public.order_chats, public.order_chat_messages from public, anon, authenticated;
grant select, insert, update on public.order_chats, public.order_chat_messages to service_role;
grant usage on sequence public.order_chat_messages_id_seq to service_role;

create function public.order_chat_paid() returns trigger
language plpgsql set search_path = '' as $$
declare v_topic uuid;
begin
  if new.charge_status = 'paid' and old.charge_status is distinct from 'paid' then
    if current_user not in ('service_role','postgres') then raise exception 'El pago requiere confirmación del proveedor'; end if;
    if old.data->>'chatCheckout' is distinct from 'true' then return new; end if;
    update public.order_chats set state = 'pending'
      where order_id = new.id and state = 'payment' returning topic into v_topic;
    if found then
      new.data := new.data || '{"chatReady":true,"chatState":"pending"}'::jsonb;
      insert into public.order_chat_messages(order_id, author, body)
        values (new.id, 'system', '¡Pedido realizado! Estamos esperando la confirmación del negocio');
      perform realtime.send('{}'::jsonb, 'changed', 'order-chat:' || v_topic, false);
    end if;
  end if;
  return new;
end $$;
revoke all on function public.order_chat_paid() from public, anon, authenticated;
create trigger order_chat_paid before update of charge_status on public.menu_orders
  for each row execute function public.order_chat_paid();

create function public.order_chat_request(p_order_id text, p_hash text, p_owner uuid, p_action text, p_payload jsonb)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_order public.menu_orders%rowtype;
  v_chat public.order_chats%rowtype;
  v_menu jsonb;
  v_out jsonb;
  v_author text;
  v_next text;
  v_body text;
  v_eta integer;
  v_cursor bigint;
  v_unread integer;
  v_changed boolean := false;
begin
  if p_order_id !~ '^o[a-z0-9]{6,24}$' then raise exception 'Pedido inválido'; end if;
  if p_action = 'create' then
    if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Enlace inválido'; end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_order_id, 0));
    if not exists (select 1 from public.order_chats where order_id = p_order_id) then
      if exists (select 1 from public.menu_orders where id = p_order_id) then raise exception 'Pedido duplicado'; end if;
      v_out := public.submit_menu_order(p_payload->>'menu_id', (p_payload->'order') || jsonb_build_object('id', p_order_id));
      if v_out->>'ok' is distinct from 'true' then return v_out; end if;
      select * into strict v_order from public.menu_orders where id = p_order_id;
      select data into v_menu from public.public_menus where id = v_order.menu_id;
      v_next := case when v_order.data->>'mpCheckout' = 'true' then 'payment' else 'pending' end;
      if v_order.data#>>'{customer,payment}' = 'tarjeta' and v_next <> 'payment' then
        raise exception 'La tarjeta requiere un pago verificado';
      end if;
      if v_order.data#>>'{customer,payment}' = 'transferencia' and v_menu#>>'{cfg,payments,transfer}' is distinct from 'true' then
        raise exception 'El negocio no acepta transferencia';
      end if;
      insert into public.order_chats(order_id, token_hash, state, total)
      values (p_order_id, p_hash, v_next, coalesce(v_order.charge_total,
        (v_order.data->>'total')::numeric
        + case when v_menu#>>'{tax,taxMode}' = 'agregar' then
            round((v_order.data->>'total')::numeric * coalesce((v_menu#>>'{tax,taxRate}')::numeric, 0) / 100, 2)
          else 0 end
        + coalesce((v_order.data->>'deliveryFee')::numeric, 0)));
      update public.menu_orders set data = data || jsonb_build_object('chatCheckout',true,'chatReady',v_next = 'pending','chatState',v_next,'chatUnread',0)
        where id = p_order_id;
      if v_next = 'pending' then
        insert into public.order_chat_messages(order_id, author, body)
          values (p_order_id, 'system', '¡Pedido realizado! Estamos esperando la confirmación del negocio');
      end if;
    end if;
  end if;

  -- Acquire locks in the same order as the payment trigger.
  select * into v_order from public.menu_orders where id = p_order_id for update;
  select * into v_chat from public.order_chats where order_id = p_order_id for update;
  if not found then raise exception 'Pedido no disponible'; end if;
  if p_owner is not null and p_owner = v_order.user_id then v_author := 'business';
  elsif p_hash is not null and p_hash = v_chat.token_hash then v_author := 'customer';
  else raise exception 'Pedido no disponible'; end if;
  if p_action = 'create' then return jsonb_build_object('ok',true,'state',v_chat.state,'code',v_order.code); end if;
  if v_chat.state = 'payment' then raise exception 'El pago todavía no está confirmado'; end if;

  if p_action = 'message' then
    v_body := btrim(p_payload->>'body');
    if coalesce(char_length(v_body),0) not between 1 and 1000 then raise exception 'Escribe un mensaje de hasta 1000 caracteres'; end if;
    insert into public.order_chat_messages(order_id, author, body, nonce)
      values (p_order_id, v_author, v_body, (p_payload->>'nonce')::uuid)
      on conflict (order_id, author, nonce) do nothing;
    v_changed := found;
  elsif p_action = 'state' then
    v_next := p_payload->>'state';
    if v_next is distinct from v_chat.state then
      if not coalesce(
        (v_author = 'customer' and v_chat.state = 'pending' and v_next = 'cancelled') or
        (v_author = 'business' and ((v_chat.state = 'pending' and v_next in ('confirmed','rejected')) or
          (v_chat.state = 'confirmed' and v_next in ('preparing','cancelled')) or
          (v_chat.state = 'preparing' and (v_next = 'cancelled' or
            (v_next = 'route' and v_order.data#>>'{customer,service}' = 'domicilio') or
            (v_next = 'delivered' and v_order.data#>>'{customer,service}' <> 'domicilio'))) or
          (v_chat.state = 'route' and v_next in ('delivered','cancelled')))),false)
      then raise exception 'El pedido ya cambió de estado'; end if;
      v_eta := v_chat.eta;
      if v_next = 'confirmed' then
        v_eta := (p_payload->>'eta')::integer;
        if v_eta is null or v_eta not between 1 and 1440 then raise exception 'Indica el tiempo estimado en minutos'; end if;
      end if;
      v_body := case v_next
        when 'confirmed' then '¡Tu pedido fue confirmado! Tiempo estimado de ' || case when v_order.data#>>'{customer,service}'='domicilio' then 'entrega' else 'preparación' end || ': ' || v_eta || ' minutos'
        when 'preparing' then 'Estamos preparando tu pedido'
        when 'route' then '¡Tu pedido está en camino!'
        when 'delivered' then case when v_order.data#>>'{customer,service}'='domicilio' then '¡Tu pedido ya llegó! Gracias por comprar con nosotros' else '¡Tu pedido fue entregado! Gracias por comprar con nosotros' end
        when 'rejected' then 'El negocio rechazó el pedido.' || coalesce(' ' || nullif(left(btrim(p_payload->>'note'),200),''),'')
        when 'cancelled' then 'El pedido fue cancelado.'
      end;
      if v_next in ('rejected','cancelled') and v_order.charge_status = 'paid' then
        v_body := v_body || ' Si pagaste con tarjeta, contacta al negocio en este chat para el reembolso.';
      end if;
      update public.order_chats set state=v_next, eta=v_eta where order_id=p_order_id returning * into v_chat;
      update public.menu_orders set data=data || jsonb_build_object('chatState',v_next,'chatEta',v_eta)
        where id=p_order_id;
      insert into public.order_chat_messages(order_id,author,body) values(p_order_id,'system',v_body);
      v_changed := true;
    end if;
  elsif p_action = 'read' then
    select coalesce(max(id),0) into v_cursor from public.order_chat_messages
      where order_id=p_order_id and id <= coalesce((p_payload->>'through')::bigint,0)
        and author=case when v_author='business' then 'customer' else 'business' end;
    v_changed := v_cursor > case when v_author='business' then v_chat.business_read else v_chat.customer_read end;
    if v_author='business' then
      update public.order_chats set business_read=greatest(business_read,v_cursor) where order_id=p_order_id returning * into v_chat;
    else
      update public.order_chats set customer_read=greatest(customer_read,v_cursor) where order_id=p_order_id returning * into v_chat;
    end if;
  elsif p_action <> 'get' then raise exception 'Acción no disponible';
  end if;

  if p_action in ('message','read') then
    select count(*) into v_unread from public.order_chat_messages
      where order_id=p_order_id and author='customer' and id > v_chat.business_read;
    update public.menu_orders set data=data || jsonb_build_object('chatUnread',v_unread)
      where id=p_order_id and (data->>'chatUnread')::integer is distinct from v_unread;
  end if;
  if v_changed then perform realtime.send('{}'::jsonb,'changed','order-chat:' || v_chat.topic,false); end if;
  select data into v_menu from public.public_menus where id=v_order.menu_id;
  return jsonb_build_object('ok',true,'state',v_chat.state,'eta',v_chat.eta,'topic','order-chat:' || v_chat.topic,
    'code',v_order.code,'business',v_menu#>>'{biz,name}','items',v_order.data->'original',
    'total',v_chat.total,'customer',v_order.data->'customer','paid',v_order.charge_status='paid',
    'messages',coalesce((select jsonb_agg(to_jsonb(m) - 'nonce' - 'order_id' order by m.id)
      from public.order_chat_messages m where m.order_id=p_order_id),'[]'::jsonb),
    'customer_read',v_chat.customer_read,'business_read',v_chat.business_read);
end $$;
revoke all on function public.order_chat_request(text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.order_chat_request(text,text,uuid,text,jsonb) to service_role;

-- MdiCloud listens to order metadata; the chat payload itself stays behind the Edge Function.
do $$ begin
  if exists (select 1 from pg_publication where pubname='supabase_realtime') and
     not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='menu_orders')
  then alter publication supabase_realtime add table public.menu_orders; end if;
end $$;
