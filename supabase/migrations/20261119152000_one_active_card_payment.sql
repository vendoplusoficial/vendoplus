-- Un pedido solo puede tener un cobro en curso o aprobado.
create unique index if not exists mp_payments_one_active_per_order
  on public.mp_payments (order_id)
  where status in ('creating', 'pending', 'in_process', 'authorized', 'approved');
