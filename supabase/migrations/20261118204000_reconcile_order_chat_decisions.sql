-- Replay decisions already saved by the POS before it received the chat metadata.
do $$
declare
  item record;
  next_state text;
  estimate integer;
begin
  for item in
    select distinct on (o.id) o.id, o.user_id, local.value as decision
      from public.order_chats c
      join public.menu_orders o on o.id = c.order_id
      join public.user_data u on u.user_id = o.user_id and u.key = 'mesa_md_incoming'
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(u.value->'j')='array' then u.value->'j' else '[]'::jsonb end
      ) local(value)
      where c.state='pending' and local.value->>'id'=o.id
        and local.value->>'chatCheckout'='false'
        and local.value->>'status' in ('confirmado','rechazado')
      order by o.id, local.value->>'decidedAt' desc nulls last
  loop
    if item.decision->>'status'='confirmado' then
      if coalesce(item.decision->>'etaMin','') !~ '^[0-9]{1,4}$' then continue; end if;
      estimate := (item.decision->>'etaMin')::integer;
      if estimate not between 1 and 1440 then continue; end if;
      next_state := 'confirmed';
    else
      estimate := null;
      next_state := 'rejected';
    end if;
    begin
      perform public.order_chat_request(item.id,null,item.user_id,'state',
        jsonb_build_object('state',next_state,'eta',estimate,
          'note',coalesce(nullif(item.decision->>'rejectNote',''),item.decision->>'rejectReason')));
    exception when raise_exception then
      if sqlerrm <> 'El pedido ya cambió de estado' then raise; end if;
    end;
  end loop;
end $$;
