-- Preserve existing orders and historical messages while retiring chat.
drop trigger if exists order_chat_paid on public.menu_orders;
drop function if exists public.order_chat_paid();
drop function if exists public.order_chat_request(text,text,uuid,text,jsonb);
