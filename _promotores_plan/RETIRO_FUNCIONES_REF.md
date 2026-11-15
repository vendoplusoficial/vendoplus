# Plan para retirar las 3 funciones `ref-*` (NO ejecutado)

Funciones: `ref-pagos-sync`, `ref-promotor-registro` y `ref-cliente-registrar`. Quedaron del intento anterior de promotores, que se deshizo con la migración `referral_99_eliminar_todo`.

## 1. Lo que revisé (solo lectura, 15-nov-2026)

| Revisión | Resultado |
|---|---|
| Tablas `referral_*` o `ref_*` en cualquier esquema | **No existen** (las borró `referral_99`) |
| Funciones SQL `ref_*` (las que estas funciones llaman: `ref_cron_ok`, `ref_frecuencia_ok`, `ref_asociar_cliente`, `ref_es_admin`…) | **No existen** |
| Triggers que las llamen | Ninguno |
| Trabajos programados (pg_cron) | No hay. pg_cron ni siquiera está instalado |
| Secretos en Vault | Vault está vacío |
| Usuarios creados por ellas (`@promotores.vendoplusoficial.com` o metadata `referral_*`) | 0 |
| Referencias en el código del sitio (`index.html`, `*.js`, `*.html`) | Ninguna |
| Webhooks de Stripe que apunten a ellas | Ninguno (el único endpoint es `stripe-webhook`) |
| Llamadas en los registros de las últimas 24 h | Ninguna (los registros solo guardan 24 h) |
| Choque de nombres con el sistema nuevo | No hay: el nuevo usa el prefijo `promo-`/`promo_` |

## 2. Qué pasa hoy si alguien las llama

- **`ref-pagos-sync`** (pública): llama a `ref_cron_ok`, que no existe, y responde **401**. No hace nada más.
- **`ref-promotor-registro`** (pública y la más delicada, porque **puede crear usuarios en Auth**): antes de crear el usuario llama a `ref_frecuencia_ok`, que no existe. Como esa llamada falla, responde **429** y nunca llega a crear la cuenta. Hoy no hace daño, pero el código sigue publicado: si algún día se volviera a crear una función SQL con ese nombre, volvería a funcionar sola.
- **`ref-cliente-registrar`** (pide sesión): intenta leer `referral_promoters`, que no existe, y responde **403 o 500**.
- **Posible secreto huérfano:** el código esperaba `REFERRAL_STRIPE_RESTRICTED_KEY`, una clave `rk_` de Stripe. La API no deja listar los secretos de las funciones, así que hay que revisarlo a mano en el panel.

**Conclusión:** no tienen dependencias y quitarlas no afecta nada. Lo recomendable es retirarlas por la función pública que puede crear usuarios.

## 3. Procedimiento propuesto (cuando lo autorices)

1. **Respaldo:** descargar el código de las tres funciones (Supabase → Edge Functions → *Download*, o `supabase functions download <nombre>`). Yo ya tengo una copia de su contenido de la auditoría.
2. **Neutralizar sin borrar (reversible):** volver a publicar cada una como un "stub" que solo responde `410 Gone` y no hace nada más. Si algo dependiera de ellas, se sabría sin haber perdido el código.
3. **Observar 7 días** los registros de `function_edge_logs` para estas tres rutas.
4. **Borrar** las tres funciones desde el panel de Supabase. La herramienta que tengo conectada no puede borrar funciones.
5. **Secretos:** en Supabase → Edge Functions → Secrets, revisar si existe `REFERRAL_STRIPE_RESTRICTED_KEY`. Si existe:
   - revocar esa clave `rk_` en Stripe → Developers → API keys;
   - borrar el secreto en Supabase.
6. **Reversión:** si algo fallara en los pasos 2 a 4, se vuelve a publicar el código del respaldo del paso 1.

Esto es **independiente** del sistema nuevo: se puede hacer antes, después o nunca, sin afectarlo.
