CREATE OR REPLACE FUNCTION public.submit_menu_order(p_menu_id text, p_order jsonb)
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

  v_checkout := coalesce(p_order->'mpCheckout' = 'true'::jsonb, false);
  if v_checkout then
    if p_order#>>'{customer,payment}' is distinct from 'tarjeta'
       or coalesce(v_data#>>'{cfg,payments,mp,on}', '') <> 'true'
       or not exists (select 1 from public.mp_accounts where user_id = v_menu.user_id and public_key <> '') then
      return jsonb_build_object('ok', false, 'error', 'El negocio no tiene habilitado el pago en línea');
    end if;
    if p_order#>>'{customer,service}' is distinct from 'domicilio' then
      v_charge := round(v_total, 2);
      if v_data#>>'{tax,taxMode}' = 'agregar' then
        v_tax := coalesce((v_data#>>'{tax,taxRate}')::numeric, 0);
        v_charge := v_charge + round(v_charge * v_tax / 100, 2);
      end if;
      if v_charge <= 0 or v_charge > 1000000 then
        return jsonb_build_object('ok', false, 'error', 'El total del pedido no es válido para pagar con tarjeta');
      end if;
    end if;
  end if;

  -- ---- Se guarda. Si el mismo pedido llega dos veces (el cliente le
  --      picó dos veces, o se reintentó el envío), no se duplica.
  insert into menu_orders (id, menu_id, user_id, code, data, created_at, charge_total, charge_status)
  values (
    v_id,
    p_menu_id,
    v_menu.user_id,
    v_code,
    jsonb_build_object(
      'v',        1,
      'id',       v_id,
      'code',     v_code,
      'createdAt', to_char(v_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'customer', coalesce(p_order->'customer', '{}'::jsonb),
      'original', v_lines,
      'mpCheckout', v_checkout,
      'total',    round(v_total, 2)        -- total autorizado por el servidor
    ),
    v_created, v_charge, case when v_charge is not null then 'pending' end
  )
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'code', v_code, 'total', round(v_total, 2));
end;
$function$;
