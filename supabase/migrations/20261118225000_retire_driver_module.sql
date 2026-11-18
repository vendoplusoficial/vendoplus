-- Retire the driver-only API. Existing order and delivery data is preserved.
drop function if exists public.pos_delivery_access_request(text,text,jsonb);
drop function if exists public.pos_delivery_request(uuid,text,jsonb);
drop function if exists public.delivery_business_request(uuid,text,text,text,text,uuid,text);
drop function if exists public.delivery_driver_request(uuid,text,text,text);
