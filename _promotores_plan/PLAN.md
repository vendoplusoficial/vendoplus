# ETAPA 2 · Plan completo del programa de promotores

**Estado:** propuesta para revisar. **No se ha ejecutado nada:** ni migraciones, ni funciones, ni cambios en Stripe o en el sitio.

Esta carpeta empieza con `_`, así que GitHub Pages **no la publica** en vendoplusoficial.com.

| Archivo | Contenido |
|---|---|
| `sql/01_esquema.sql` | Tablas, relaciones, índices, restricciones y protecciones |
| `sql/02_motor.sql` | Motor interno: comisión, aniversarios, libro contable, asociación |
| `sql/03_api.sql` | Funciones que llaman las páginas (negocio, promotor y administrador) |
| `sql/04_seguridad.sql` | RLS, permisos y alta del administrador maestro |
| `sql/05_automatizacion.sql` | Cron diario (pg_cron + pg_net) |
| `sql/90_pruebas.sql` | 41 pruebas automáticas que terminan en `ROLLBACK` |
| `sql/99_reversion.sql` | Cómo apagar o deshacer el sistema |
| `functions/*` | 4 Edge Functions nuevas y un módulo compartido |
| `RETIRO_FUNCIONES_REF.md` | Plan separado para retirar las funciones `ref-*` |

---

## 0. Garantías de no afectación

| No se toca | Cómo se garantiza |
|---|---|
| Tablas existentes (`profiles`, `user_data`, `vp_play_compras`, etc.) | Solo se **leen**. No hay `ALTER`, `UPDATE`, `INSERT` ni `DELETE` sobre ellas. Las llaves foráneas nuevas hacia `auth.users` usan `ON DELETE SET NULL`, así que **eliminar una cuenta nunca se bloquea**. |
| `create-checkout` | No cambia. Los clientes sin promotor y la app Android siguen usándola igual. |
| `stripe-webhook` y su endpoint en Stripe | No cambian. Siguen activando **todas** las membresías, incluidas las que llevan descuento, porque `promo-checkout` manda la misma metadata (`supabase_user_id`). |
| Google Play (`google-play`, `vp-play-*`) | No se tocan. El sistema nuevo solo lee las tablas de compras para saber si un negocio pagó por Play. |
| `has_access` y la regla RLS de `user_data` | No se tocan (lo pediste aparte). |
| Funciones `ref-*` | No se tocan (plan separado). |
| Precio normal ($199) | No cambia. El descuento es un **cupón** que solo agrega `promo-checkout`. |

**Interruptor general:** `promo_config.programa_activo` empieza en `false`. Con el interruptor apagado, el enlace no asocia negocios y `promo-checkout` responde `usar_normal`, así que la página vuelve sola al cobro normal.

---

## 1. Tablas nuevas

```
auth.users ─┬─< promo_promotores (user_id, código único, estado)
            │        │
            │        ├─< promo_negocios (negocio_user_id ÚNICO → 1 promotor por negocio)
            │        │        ├─< promo_pagos ───────────< (facturas de Stripe, 1 por factura)
            │        │        ├─< promo_suscripciones
            │        │        └─< promo_recompensas  ÚNICO(negocio, tipo, nº aniversario)
            │        │                    │
            │        ├─< promo_movimientos (libro contable, solo agregar) >── promo_retiros
            │        ├─< promo_retiros  (1 activa por promotor)
            │        └── promo_datos_bancarios (CLABE cifrada)
            └── promo_admins
promo_atribuciones (cada intento de asociación) · promo_eventos (evt_… únicos)
promo_auditoria (acciones del admin, solo agregar) · promo_corridas · promo_config
```

**Restricciones clave contra duplicados y errores de dinero:**

- `promo_negocios.negocio_user_id UNIQUE`: un negocio solo puede tener un promotor.
- `promo_recompensas UNIQUE (negocio_id, tipo, numero_aniversario)` y `UNIQUE (negocio_id, ventana_desde)`: ningún negocio cobra dos veces el mismo aniversario.
- `promo_movimientos.clave UNIQUE`: el mismo hecho nunca entra dos veces al libro (`recompensa:<id>`, `retiro:<id>`, `reverso:<id>:<n>`).
- `promo_eventos.event_id` es la llave primaria: cada evento de Stripe se procesa una sola vez.
- Índice único parcial en `promo_retiros (promotor_id) WHERE estado IN ('solicitado','aprobado')`: solo una solicitud de retiro abierta por promotor.
- Triggers que **impiden editar o borrar** `promo_movimientos`, `promo_auditoria` y `promo_atribuciones`. Tampoco se pueden borrar pagos, negocios ni retiros. En una recompensa **solo puede cambiar el estado**.
- Los montos se guardan en centavos (`bigint`) y los `CHECK` validan el signo según el tipo de movimiento.

---

## 2. Flujo del negocio

1. El promotor comparte `https://vendoplusoficial.com/registro/?promotor=ABCD2345`.
2. **`registro/index.html`** (página nueva):
   - llama a `promo_codigo_info` para confirmar que el promotor existe y está activo;
   - muestra **$199 tachado → $149.25/mes** y aclara: *"El 25% de descuento es exclusivo al contratar en nuestra página web con tarjeta (Stripe). No aplica a Google Play."*;
   - guarda el código en el navegador y ofrece **Crear cuenta** o **Ya tengo cuenta**, que llevan a la app (`/?promotor=…`) con su registro e inicio de sesión de siempre.
3. **`vendo-promotores.js`** (archivo nuevo, se carga con una sola línea en `index.html`):
   - cuando hay sesión y hay un código guardado, llama a **`promo-asociar`** y muestra el resultado con el mensaje claro que corresponda;
   - en la pantalla de Premium, si `promo_mi_negocio` indica descuento, muestra el precio con descuento y **el botón Pagar usa `promo-checkout`**;
   - en Android (`window.VendoNative` o `window.PlayPay`) **no hace nada**, así que Google Play sigue exactamente igual;
   - si `promo-checkout` responde `usar_normal`, llama al cobro original (`create-checkout`).
4. **`promo-asociar`** (servidor) lee en Stripe el historial real de pagos (primer pago y suscripción activa) y en la base las compras de Google Play. Después, **`promo_asociar`** (SQL, con candado por negocio) aplica las reglas en este orden:
   - el programa debe estar activo;
   - el código debe existir y el promotor debe estar aprobado;
   - el negocio no puede ser el propio promotor;
   - si ya tiene **otro** promotor: *"Este negocio ya tiene un promotor asignado."*;
   - si no se pudo verificar en Stripe: *"Intenta de nuevo en unos minutos"* (no se adivina);
   - si `profiles` indica que pagó pero no se encuentra el pago: se envía a revisión (no se adivina);
   - si su primer pago (Stripe o Play) fue hace **7 días o más**: *"Este negocio ya tiene una membresía activa desde hace más de 7 días y no puede asociarse con un promotor."*;
   - en cualquier otro caso: **se asocia**. Esto incluye a los negocios gratuitos de cualquier antigüedad.
5. **Descuento** (decisión 8):
   - **Sin suscripción:** paga en `promo-checkout` con el cupón y su primer cobro ya es de $149.25.
   - **Ya pagaba $199 con Stripe (menos de 7 días):** el cupón se agrega a **su suscripción existente**, solo si es técnicamente seguro. Afecta **solo las facturas futuras**: no reembolsa, no prorratea y no cambia la fecha ni la metadata. Se considera seguro cuando la suscripción está activa, no tiene cancelación programada, tiene un solo producto, está en MXN, se cobra automáticamente, no tiene otro descuento y no tiene calendario de cambios. Si no cumple, queda como `no_aplica` con el motivo visible para el administrador. Si Stripe falla, la conciliación diaria lo reintenta.
   - **Google Play:** sin descuento y sin generar dinero para el promotor.

> Nota: un negocio que **pagó en el pasado** (hace 7 días o más) y hoy está en modo gratuito **no se puede asociar**, por la regla 4 ("si ya pagó y han transcurrido 7 días o más"). Dime si quieres otra cosa.

---

## 3. `promo-checkout` y el cupón de Stripe

**Cupón** (se crea al implementar, con tu autorización):

```
POST /v1/coupons
  id          = VP_PROMOTOR_25
  name        = "Promotor VendoPlus · 25%"
  percent_off = 25
  duration    = forever
  applies_to[products][] = prod_VNLFsnbvoG0pHz
```

- $199.00 × 0.75 = **$149.25 exactos** (19900 → 14925 centavos; Stripe maneja centavos en MXN).
- `duration=forever` mantiene el descuento en cada renovación. `applies_to` impide que el cupón sirva para otro producto.
- El cupón **no es un código promocional**: nadie puede escribirlo en la página de pago. Solo el servidor lo agrega.

**`promo-checkout`** hace lo mismo que `create-checkout` (mismo precio `STRIPE_PRICE_ID`, mismas URLs de regreso, misma metadata) y además:

- verifica la sesión, que el negocio esté asociado y que no esté excluido;
- verifica que el precio sea de $199 MXN y del producto correcto, y que el cupón sea de 25% y para siempre. **Si algo no cuadra, no cobra** y responde `usar_normal`;
- **impide una segunda suscripción** y también el pago si tiene Google Play activo;
- **no escribe en `profiles`**. Si el negocio no tenía cliente en Stripe, se crea uno y se guarda en `promo_negocios`. El `stripe-webhook` actual lo guarda en `profiles` al completarse el pago, como hace hoy.

---

## 4. Webhook adicional `promo-stripe-eventos`

- Será un **segundo endpoint en Stripe** (el actual no se toca), creado con la versión de API **fija `2024-12-18.acacia`**, la misma que usa el código. Así los objetos llegan con la forma esperada.
- **Eventos:** `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `invoice.voided`, `invoice.marked_uncollectible`, `charge.refunded`, `charge.refund.updated`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`, `customer.subscription.updated` y `customer.subscription.deleted`.
- **Funcionamiento:**
  1. Verifica la firma con **su propio secreto** (`PROMO_STRIPE_WEBHOOK_SECRET`).
  2. Registra el `evt_…` en `promo_eventos`. Si ya se procesó, responde 200 y **no hace nada más**.
  3. Identifica al cliente. Si no es de un negocio referido, marca el evento como `ignorado` (que será lo más común).
  4. **No confía en el contenido del evento para el dinero.** Vuelve a leer de Stripe todas las facturas del cliente: importe pagado, moneda, `livemode`, periodo de servicio, reembolsos (`charge.amount_refunded`) y disputas. Luego guarda con `upsert`. Por eso **no importa el orden** en que lleguen los eventos.
  5. Ejecuta el motor del negocio, que bloquea al negocio y es idempotente.
  6. Si algo falla, responde 500 y Stripe reintenta hasta 3 días.
- **Datos que verifica y guarda:** ID del evento, factura, suscripción, cliente, cargo, importe pagado, importe reembolsado, descuento, moneda, `livemode`, periodo y estado de la disputa. La sesión de Checkout se usa para ligar al cliente con el negocio (`metadata.supabase_user_id`).

**Conciliación diaria (`promo-conciliar`, decisión 6):** pg_cron la llama todos los días a las 03:17 (hora de la Ciudad de México) con un secreto de Vault. Vuelve a sincronizar con Stripe a los negocios por lotes (los menos recientes primero), reintenta los descuentos pendientes y deja registro en `promo_corridas`. Como todo usa `upsert` y el motor es idempotente, repetirla **no duplica nada**. A las 04:47 corre además `promo_evaluar_todos()` (solo SQL), que revisa los aniversarios aunque ese día no llegue ningún evento.

---

## 5. Cálculo de aniversarios

1. **Qué periodos cuentan:** solo facturas de membresía que estén **pagadas**, con importe mayor a $0, reales (`livemode`), en MXN, **sin reembolso total** y **sin disputa abierta o perdida** (columna calculada `promo_pagos.valido`). Si la suscripción terminó antes de acabar un periodo (cancelación inmediata), ese periodo se corta en la fecha de terminación.
2. **Tramos continuos:** se ordenan los **periodos de servicio** (no se cuentan facturas) y se unen mientras el siguiente empiece antes de que termine el anterior, con una tolerancia de **24 horas** configurable. Cualquier hueco mayor que la tolerancia corta el tramo.
3. **Reintentos de cobro:** la factura del mes cubre el periodo **de ese mes** aunque se haya cobrado 10 días tarde. Si al final se pagó, no hay hueco y el mes cuenta (prueba 22). Si nunca se pagó (`uncollectible` o `void`), hay hueco.
4. **Ventanas de 12 meses:** para un tramo que empieza en la fecha A, las ventanas son [A, A+12m], [A+12m, A+24m], etc. Los meses se suman en UTC, igual que Stripe. Una ventana se premia solo cuando su fecha final ya pasó **y** el tramo la cubre completa.
5. **Número y monto:** cada ventana premiada recibe el siguiente número del negocio: **#1 = $250** y **#2, #3, … = $50**. Los números **nunca se reutilizan**, así que nunca hay un segundo pago de $250.
6. **Cuando hay una interrupción real:** el contador vuelve a empezar desde **el primer periodo pagado después del hueco**. Lo ya acreditado no se toca.
   - Ejemplo: paga de febrero a mayo, falla junio y vuelve en julio. Su recompensa llega en julio del año siguiente (prueba 25).
   - Si nunca había cumplido su primer año, esa recompensa es la #1, de $250.
   - Si ya lo había cumplido, es la siguiente, de $50.
7. **Fechas individuales:** cada negocio usa su propia fecha. Un negocio que empezó el 15-ene-2027 recibe sus recompensas el 15-ene de 2028, 2029, 2030… No se usa el año calendario ni se espera a diciembre.

**Ejemplo de calendario de un negocio con primer pago el 15-ene-2027:**

| Fecha | Qué pasa | Monto |
|---|---|---:|
| 15-ene-2027 | Primer pago válido | Comisión inicial $100 |
| 15-ene-2028 | Aniversario #1 | $250 |
| 15-ene-2029 | Aniversario #2 | $50 |
| 15-ene-2030 | Aniversario #3 | $50 |

**Una vez acreditada**, una recompensa solo se revierte si **el periodo que la generó** se reembolsa por completo o tiene un contracargo. Una cancelación **posterior** no la afecta.

**Decisión conservadora que tomé y que puedes cambiar:** si el aniversario #1 ($250) se revierte por un reembolso, ese número queda usado y el siguiente año completo paga $50. Lo hice así para cumplir literalmente "nunca volver a pagar $250 por el mismo negocio". Si prefieres que en ese caso se vuelva a pagar $250, es un cambio de pocas líneas.

**Reembolso parcial:** **no** invalida el periodo. Queda registrado y el administrador puede revertir la recompensa a mano, con auditoría.

---

## 6. Saldos, movimientos y retiros

**El saldo no existe como un número editable:** se calcula siempre a partir del libro de movimientos.

| Concepto | Cálculo |
|---|---|
| **Disponible** | Suma de movimientos cuya `disponible_desde` ya pasó. Puede quedar **negativo** por un reverso, y entonces se compensa con lo que gane después (decisión 3). |
| **Pendiente** | Suma de movimientos cuya `disponible_desde` todavía no llega (los 15 días de espera). |
| **En retiro** | Retiros en estado `solicitado` o `aprobado`. |
| **Retirado** | Retiros en estado `pagado`. |

Las recompensas futuras **no se muestran como dinero**. En el panel aparecen solo como "Próxima recompensa: 15-ene-2028".

| Hecho | Movimiento en el libro |
|---|---|
| Comisión o aniversario | `+monto`, disponible 15 días después |
| Reembolso o contracargo | `-monto`, **nuevo** registro. Si el dinero seguía pendiente, se anula dentro de lo pendiente; si ya estaba disponible, se descuenta en ese momento. El movimiento original **nunca se borra**. |
| Contracargo ganado | `+monto` (`reacreditacion`) |
| Solicitud de retiro | `-monto` en ese momento: **el dinero queda apartado** |
| Retiro rechazado o cancelado | `+monto` (`retiro_devuelto`) |
| Retiro pagado | **Sin movimiento**, porque ya se descontó al solicitarlo. Así **no se descuenta dos veces**. |
| Ajuste del administrador | `±monto`, con motivo y auditoría (saldo anterior y nuevo) |

**Reglas de retiro:**

- mínimo **$200**;
- no se puede retirar más que el disponible;
- solo **una solicitud abierta** a la vez (protegido por un índice único y un candado en la fila del promotor);
- la cuenta del promotor debe estar activa y tener la CLABE registrada.

Los estados posibles son: `solicitado` → `aprobado` → `pagado` (con referencia de la transferencia), o bien `rechazado` (con motivo) o `cancelado` (lo cancela el propio promotor).

**CLABE:**

- se valida que tenga 18 dígitos y el dígito de control correcto (pesos 3, 7 y 1);
- se guarda **cifrada** con `pgp_sym_encrypt`, usando una llave que vive en Vault;
- solo se muestra `•••• 1234`;
- no se puede cambiar mientras haya un retiro en curso.

**CSV de retiros:** `promo_admin_exportar_retiros()` es la única función que descifra la CLABE completa. Es solo para el administrador y cada exportación queda en la auditoría. El panel arma el archivo CSV.

**Transferencias:** se hacen a mano. **No** hay transferencias automáticas.

---

## 7. Seguridad (resumen de `04_seguridad.sql`)

- **RLS** activo en las 14 tablas nuevas.
- Sin políticas de `INSERT`/`UPDATE`/`DELETE`: **ninguna escritura directa** desde el navegador.
- El promotor lee **solo lo suyo**: su perfil, recompensas, movimientos y retiros.
- Correos, pagos, eventos y auditoría son solo para el administrador.
- **Nadie** lee directamente los datos bancarios.
- `EXECUTE` se quita a todos en todas las funciones `promo_*` y se concede una por una. Las funciones internas (motor, `promo_mover`, `promo_asociar`) quedan **solo para el servidor**.
- **Administrador:** `promo_es_admin()` revisa `auth.uid()` en `promo_admins`, en el servidor. Cambiar algo en el navegador no da acceso.
- Ninguna función recibe montos para acreditar. El único monto que entra es el que el promotor pide retirar, y se valida contra su saldo.

---

## 8. Archivos que se crearían o modificarían

**Base de datos (Supabase):**

- 5 migraciones nuevas (`01` a `05`): solo crean objetos `promo_*`.
- Activar las extensiones `pg_cron` y `pg_net` (son nuevas y no afectan nada existente).
- 2 secretos en Vault: `promo_cron_secret` y `promo_clave_bancaria`.

**Edge Functions nuevas:**

| Función | `verify_jwt` |
|---|---|
| `promo-asociar` | true |
| `promo-checkout` | true |
| `promo-stripe-eventos` | false (se protege con la firma de Stripe) |
| `promo-conciliar` | false (se protege con el secreto del cron) |

- Secretos de Edge Functions nuevos: `PROMO_STRIPE_WEBHOOK_SECRET` y `PROMO_CRON_SECRET`.
- Se **reutilizan sin modificar**: `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `APP_URL`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.

**Stripe:** 1 cupón nuevo y 1 endpoint de webhook nuevo. No se cambia nada existente.

**Sitio (repositorio):**

| Archivo | Cambio |
|---|---|
| `registro/index.html` | **Nuevo:** página del enlace |
| `promotores/index.html` | **Nuevo:** registro y panel del promotor (resumen, mi enlace, mis ganancias, ¿cómo gano dinero?, mis negocios por mes, retiros, cuenta bancaria) |
| `admin-promotores/index.html` | **Nuevo:** panel del administrador maestro |
| `vendo-promotores.js` | **Nuevo:** conexión con la app |
| `index.html` | **Modificado: se agrega 1 línea** (`<script src="vendo-promotores.js?v=…"></script>` después de `vendo-premium.js`) |

No se tocan `vendo-premium.js`, `vendo-cerebro.js` ni ningún otro archivo.

**Diseño:** Figtree; colores verde claro, verde principal, blanco y gris claro; sin azul marino, morado, gradientes ni fondos negros; adaptable a celular y computadora.

---

## 9. Pruebas

**A) Automáticas en SQL (`90_pruebas.sql`, 41 casos, terminan en `ROLLBACK`).** Cubren todo lo que pediste: captación, descuento visible, comisión única, eventos duplicados, retención de 15 días, negocios gratuitos, la regla de 7 días, promotor ya asignado, autorreferido, promotor no aprobado, Google Play, aniversarios #1, #2 y #3, que los $250 se paguen una sola vez, pagos tardíos por reintentos, cancelación antes del año, pago fallido con reinicio del contador, reembolso, contracargo abierto y ganado, 99 negocios sin metas, negocios de distintos meses, la CLABE, el mínimo de retiro, el saldo apartado, el doble retiro, permisos del administrador, aprobar y pagar, auditoría, libro inmutable y RLS.

Se ejecutan en la base real dentro de una transacción que se deshace (no queda nada). Mientras corren, crean usuarios y una compra de Play de prueba que el `ROLLBACK` elimina.

**B) Revisiones de seguridad:** `get_advisors` de Supabase después de aplicar las migraciones.

**C) Prueba completa con Stripe real.** Necesito que tú hagas los pagos, porque tu cuenta de Stripe no tiene modo de prueba:

1. Crear un promotor de prueba, aprobarlo y abrir su enlace.
2. Crear una cuenta nueva y pagar en la web: debe cobrar **$149.25**.
3. Revisar que la membresía Premium se active (con el webhook actual) y que aparezca la comisión de $100 pendiente.
4. Reenviar el mismo evento desde Stripe: no debe duplicar nada.
5. Reembolsar ese pago en Stripe: debe aparecer el reverso.
6. Confirmar que una cuenta sin enlace sigue pagando $199 y que Android no cambia.

**No puedo probar automáticamente** el cobro real con tarjeta, la pantalla de pago de Stripe, la entrega real de webhooks con la firma, ni nada de Google Play. Eso queda en la prueba C.

---

## 10. Reversión

Ver `sql/99_reversion.sql`.

- **Nivel 1 (inmediato, sin perder datos):** apagar `programa_activo`, quitar los trabajos del cron, desactivar el endpoint en Stripe y quitar la línea del script en `index.html`. Los cobros vuelven a funcionar exactamente como hoy.
- **Nivel 2 (solo con autorización):** exportar los datos y borrar los objetos `promo_*`. Advertencia: el cupón **sigue** en las suscripciones que ya lo tienen, hasta que se decida otra cosa en Stripe.

---

## 11. Orden de implementación (cuando lo autorices)

1. Aplicar las migraciones `01` a `04`, con el programa **apagado**.
2. Ejecutar las pruebas `90` (con `ROLLBACK`) y `get_advisors`, y mostrarte los resultados.
3. Crear los secretos, publicar las 4 Edge Functions y crear el cupón y el endpoint en Stripe.
4. Activar la automatización `05`.
5. Publicar las páginas y la línea en `index.html` en tu rama, para que la revises **antes** de pasarla a `main`.
6. Prueba C con un pago real y su reembolso.
7. Encender `programa_activo`.
