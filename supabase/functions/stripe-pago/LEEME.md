# Pago con tarjeta (Stripe) desde el Menú Digital

- El cliente elige Tarjeta y toca «Enviar y pagar»: `submit_menu_order` guarda el
  pedido con `stripeCheckout: true` y fija `charge_total` en el servidor.
- El menú abre `#pagar/<pedido>` (stripe-pago crea el cobro en la cuenta de
  Stripe del negocio). Al pagar, el cliente manda el pedido por WhatsApp.
- En el POS el pedido no se cobra solo: el negocio toca «Ya pagó con tarjeta».
