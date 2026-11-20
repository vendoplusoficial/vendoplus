CREATE OR REPLACE FUNCTION public.quote_stripe_test_order(p_menu_id text, p_order jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_menu     record;
  v_data     jsonb;
  v_prods    jsonb;
  v_line     jsonb;
  v_prod     jsonb;
  v_price    numeric;
  v_lines    jsonb := '[]'::jsonb;
  v_total    numeric := 0;
  v_qty      numeric;
  v_id       text;
  v_code     text;
  v_created  timestamptz;
  v_n        int := 0;
  v_stock    numeric;
  v_need     numeric;
  v_pid      text;
  v_checkout boolean;
  v_charge numeric;
  v_tax numeric;
  v_delivery jsonb;
  v_rates jsonb;
  v_tiers integer;
  v_origin_lat double precision;
  v_origin_lng double precision;
  v_dest_lat double precision;
  v_dest_lng double precision;
  v_h double precision;
  v_km numeric;
  v_fee numeric;
begin
  -- ---- El menú tiene que existir, estar activo y no estar en pausa
  select * into v_menu from public_menus where id = p_menu_id limit 1;
  if v_menu is null then
    return jsonb_build_object('ok', false, 'error', 'Este menú no está disponible');
  end if;

  v_data  := coalesce(v_menu.data, '{}'::jsonb);
  v_prods := coalesce(v_data->'prods', '[]'::jsonb);

  if coalesce(((v_data->'cfg')->>'paused')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'El negocio no está recibiendo pedidos');
  end if;

  -- ---- Datos mínimos del pedido
  v_id   := coalesce(p_order->>'id', '');
  v_code := coalesce(p_order->>'code', '');
  if v_id !~ '^o[a-z0-9]{6,24}$' then
    return jsonb_build_object('ok', false, 'error', 'Pedido no válido');
  end if;
  if v_code !~ '^MD-[A-Z0-9]{4,6}$' then
    return jsonb_build_object('ok', false, 'error', 'Folio no válido');
  end if;

  begin
    v_created := coalesce((p_order->>'createdAt')::timestamptz, now());
  exception when others then
    v_created := now();
  end;
  -- Fechas raras (del futuro o muy viejas) se normalizan a ahora
  if v_created > now() + interval '1 hour' or v_created < now() - interval '2 days' then
    v_created := now();
  end if;

  if jsonb_typeof(p_order->'original') <> 'array'
     or jsonb_array_length(p_order->'original') = 0
     or jsonb_array_length(p_order->'original') > 150 then
    return jsonb_build_object('ok', false, 'error', 'El pedido está vacío o es demasiado grande');
  end if;

  -- ---- Línea por línea: existe, alcanza, las elecciones cuadran y el
  --      precio es el autorizado por el catálogo publicado.
  for v_line in select value from jsonb_array_elements(p_order->'original') loop
    v_n := v_n + 1;

    select p into v_prod
    from jsonb_array_elements(v_prods) p
    where p->>'id' = v_line->>'productId'
    limit 1;

    if v_prod is null then
      return jsonb_build_object('ok', false, 'error',
        'Un producto de tu pedido ya no está disponible. Vuelve a abrir el menú.');
    end if;

    v_qty := greatest(0, coalesce((v_line->>'qty')::numeric, 0));
    if v_qty <= 0 or v_qty > 9999 then
      return jsonb_build_object('ok', false, 'error', 'Una cantidad de tu pedido no es válida');
    end if;

    v_price := vendo_line_price(v_prod, v_line);
    if v_price is null then
      return jsonb_build_object('ok', false, 'error',
        'Las opciones de "' || coalesce(v_prod->>'name', 'un producto') ||
        '" cambiaron. Vuelve a armar ese combo.');
    end if;

    -- El precio que escribimos es el NUESTRO, no el que mandó el celular
    v_lines := v_lines || jsonb_build_array(
      jsonb_strip_nulls(jsonb_build_object(
        'productId', v_line->>'productId',
        'name',      left(coalesce(v_prod->>'name', 'Producto'), 120),
        'sizeId',    nullif(v_line->>'sizeId', ''),
        'sizeLabel', nullif(v_line->>'sizeLabel', ''),
        'unit',      coalesce(nullif(v_line->>'unit', ''), 'pieza'),
        'qty',       v_qty,
        'price',     v_price,
        'note',      nullif(left(coalesce(v_line->>'note', ''), 160), ''),
        'combo',     case when jsonb_array_length(coalesce(v_line->'combo', '[]'::jsonb)) > 0
                          then v_line->'combo' else null end
      ))
    );
    v_total := v_total + v_price * v_qty;
  end loop;

  -- ---- Existencias: se revisa el pedido COMPLETO contra cada producto
  --      del menú que lleve control (el combo y sus componentes).
  for v_prod in select value from jsonb_array_elements(v_prods) loop
    if (v_prod->>'stock') is null then
      continue;                             -- sin control: se vende libre
    end if;
    v_pid   := v_prod->>'id';
    v_stock := coalesce((v_prod->>'stock')::numeric, 0);

    select coalesce(sum(vendo_line_stock_use(
             (select p from jsonb_array_elements(v_prods) p where p->>'id' = l->>'productId' limit 1),
             l, v_pid)), 0)
      into v_need
    from jsonb_array_elements(v_lines) l;

    if v_need > v_stock + 0.0001 then
      return jsonb_build_object('ok', false, 'error',
        'Ya no hay suficiente de "' || coalesce(v_prod->>'name', 'un producto') ||
        '". Ajusta tu pedido.');
    end if;
  end loop;

  if p_order#>>'{customer,service}' = 'domicilio' then
    v_delivery := v_data#>'{cfg,delivery}';
    if v_delivery->>'on' is distinct from 'true' then
      return jsonb_build_object('ok', false, 'error', 'El negocio no tiene servicio a domicilio');
    end if;
    v_origin_lat := (v_delivery->>'lat')::double precision;
    v_origin_lng := (v_delivery->>'lng')::double precision;
    if jsonb_typeof(p_order#>'{customer,loc,lat}') is distinct from 'number'
        or jsonb_typeof(p_order#>'{customer,loc,lng}') is distinct from 'number' then
      return jsonb_build_object('ok', false, 'error', 'Marca la ubicación de entrega');
    end if;
    v_dest_lat := round((p_order#>>'{customer,loc,lat}')::numeric, 6);
    v_dest_lng := round((p_order#>>'{customer,loc,lng}')::numeric, 6);
    if not coalesce(v_origin_lat between -90 and 90 and v_origin_lng between -180 and 180
        and abs(v_origin_lat) + abs(v_origin_lng) > 0
        and v_dest_lat between -90 and 90 and v_dest_lng between -180 and 180
        and abs(v_dest_lat) + abs(v_dest_lng) > 0, false) then
      return jsonb_build_object('ok', false, 'error', 'No se pudo calcular el envío con esa ubicación');
    end if;

    v_h := sin(radians(v_dest_lat - v_origin_lat) / 2)^2
      + cos(radians(v_origin_lat)) * cos(radians(v_dest_lat)) * sin(radians(v_dest_lng - v_origin_lng) / 2)^2;
    v_km := round((12742 * asin(sqrt(least(1, v_h))))::numeric, 3);
    v_rates := v_delivery->'rates';
    if jsonb_typeof(v_rates) is distinct from 'array' then
      v_rates := '[25,30,35,40,45,50,55,60,65,70]'::jsonb;
    elsif jsonb_array_length(v_rates) not between 1 and 100 or exists (
      select 1 from jsonb_array_elements(v_rates) as r(rate)
      where case when jsonb_typeof(rate) = 'number' then rate::numeric not between 0 and 10000 else true end
    ) then
      v_rates := '[25,30,35,40,45,50,55,60,65,70]'::jsonb;
    end if;
    v_tiers := jsonb_array_length(v_rates);
    if v_km > v_tiers then
      v_fee := round(round((v_rates->>(v_tiers - 1))::numeric, 2) * v_km / v_tiers, 2);
    else
      v_fee := round((v_rates->>(greatest(1, ceil(v_km)::integer) - 1))::numeric, 2);
    end if;
    if p_order ? 'deliveryQuote' and p_order->'deliveryQuote' is distinct from to_jsonb(v_fee) then
      return jsonb_build_object('ok', false, 'error', 'La tarifa de envío se actualizó. Vuelve a abrir el menú para ver el precio.');
    end if;
  end if;

  v_charge := round(v_total, 2);
  if v_data#>>'{tax,taxMode}' = 'agregar' then
    v_tax := coalesce((v_data#>>'{tax,taxRate}')::numeric, 0);
    v_charge := v_charge + round(v_charge * v_tax / 100, 2);
  end if;
  v_charge := v_charge + coalesce(v_fee, 0);
  if v_charge < 10 or v_charge > 1000000 then
    return jsonb_build_object('ok', false, 'error', 'El total del pedido no es válido para esta prueba');
  end if;
  return jsonb_build_object('ok', true, 'amount', round(v_charge * 100)::integer);
end;
$function$;
revoke all on function public.quote_stripe_test_order(text, jsonb) from public, anon, authenticated;
grant execute on function public.quote_stripe_test_order(text, jsonb) to service_role;