# Vendo Plus · de "mes gratis y luego se bloquea" a **gratis + Premium**

Actualizado: 23 de octubre de 2026

---

## 1. Lo que cambió, en corto

**Antes:** un mes gratis y después la app entera se bloqueaba con una pantalla de "Tu cuenta está pausada".
Eso es justo lo que espantaba a la gente: *"prueba gratis = luego me van a cobrar a huevo"*.

**Ahora:** la app **nunca se bloquea**. Lo que se vende es **Premium, $149 MXN al mes**, y solo
desbloquea 4 funciones. Si alguien nunca paga, puede usar Vendo Plus toda la vida.

### Gratis para siempre (sin tarjeta, sin avisos, sin fecha límite)
- Vender y cobrar
- Generar tickets y **enviarlos**
- Historial de ventas
- Caja, corte y gastos
- Clientes y crédito (fiado)
- Inventario completo, **con fotos de productos ilimitadas**
- Mi cuenta, mi negocio y toda la configuración
- **Estadísticas simples**: ganancia, ventas netas, pedidos, ticket promedio, gráficas y productos más vendidos
- **3 escaneos de carta con IA al mes**

### Premium · $149 MXN al mes
| Función | Gratis | Premium |
|---|---|---|
| Menú Digital (carta en línea + pedidos) | se configura, no se activa | ✅ |
| Chat con IA (el asistente del robot) | robot inactivo | ✅ |
| Escáner de carta con IA | 3 al mes | ✅ sin límite |
| Estadísticas **detalladas** | — | ✅ |

El cobro **no cambió**: en la web sigue siendo tu mismo precio de Stripe y en la app de Play Store
tu misma suscripción de Google Play (`vendoplus_app_membresia`). Solo cambió **cuándo** se ofrece.

---

## 2. Cómo se bloquea (sin un solo candado a la vista)

No hay iconos de "bloqueado" en ninguna parte. La app se ve completa; lo que cambia es el momento
en que aparece la pantalla de Premium:

| Función | Qué ve el usuario gratis |
|---|---|
| **Menú Digital** | Entra normal, abre la configuración y la llena igual que siempre. Al tocar **"Activar Menú Digital"** → pantalla de Premium. El botón nunca se queda apagado, para que nadie se atore sin saber por qué. |
| **Estadísticas detalladas** | El botón **"Ver estadísticas detalladas"** se ve exactamente igual que antes. Al tocarlo → pantalla de Premium. (El contenido detallado ni siquiera se manda a la pantalla.) |
| **Chat con IA** | El robot sigue ahí, pero **inactivo**. Al tocarlo → pantalla de Premium. |
| **Escáner con IA** | Escanea normal sus 3 del mes. Al cuarto → pantalla de Premium. |

---

## 3. La pantalla de Premium

Es de **pantalla completa**, blanca, **en una sola vista y sin deslizar**, con la corona arriba
(la imagen viene incrustada en el propio archivo `vendo-premium.js`, sin fondo negro y sin archivos
sueltos que se puedan quedar sin subir):

> ✕ · corona · **Desbloquea más funciones con Premium** · las 4 tarjetas · **$149 MXN / por mes ·
> Cancela cuando quieras** · botón verde **Suscribirme ahora** · *"Lo demás de Vendo Plus sigue
> siendo tuyo, gratis."*

Toda la paleta es **blanco y verde**. No se usa azul marino en ningún fondo, botón ni tarjeta.

**Cabe entera en cualquier celular, sin scroll interno.** La hoja dejó de desplazarse y se volvió una
columna: la corona, el título y el botón miden lo suyo, y las cuatro tarjetas se reparten lo que
sobra. Todos los tamaños van con `clamp()` atado al **alto** de la pantalla, así que el mismo diseño
se achica o se agranda solo. En pantallas muy bajitas se va soltando lo menos importante, en este
orden: la letra chiquita legal → el párrafo de arriba → las descripciones de las tarjetas → la
corona. Medido sin un solo pixel de scroll en: 320×568, 375×667, 360×740, 390×844, 412×915, 430×932,
tablet 768×1024 y computadora 1280×800 y 1280×620.
En Android el precio se trae de Google Play (sale en la moneda del país) y abajo aparece
*"Ya pagué · Restaurar compra"*. Se cierra con la ✕, con **Esc** en computadora o con el botón
**Atrás** en Android.

**El robot sin membresía** se pone gris frío, **deja de flotar**, se le apaga la pantalla de la cara
(los ojos quedan como dos rayitas grises en vez de verdes) y le late un **puntito verde** discreto.
Se distingue de un vistazo del robot dormido, que sigue verde, con los ojitos en arco y respirando.

**En Mi cuenta** la membresía es una sola línea: *"Versión gratis · Lo que usas hoy seguirá siendo
gratis."* y un botón suave **Ver Premium ›**. Pagando dice **"Premium activo"** con la fecha.

---

## 4. El bug de la computadora, arreglado

**Síntoma:** en PC tocabas el robot bloqueado, la pantalla de Premium abría y se cerraba sola al
instante.

**Causa:** el robot abre la pantalla desde `pointerup`. Justo después el navegador manda el `click`
de ese **mismo** toque, y ese click ya aterriza encima de la pantalla recién abierta: la app lo
entendía como *"tocó afuera"* y la cerraba en el mismo instante. En celular no pasaba porque la
secuencia de eventos del dedo es distinta.

**Arreglo:** la pantalla de Premium se traga ese primer click —y solo ese— antes de que llegue a
nadie (`traseProtegido()` en `vendo-premium.js`). Un toque de verdad, posterior, pasa normal.
Probado con un clic real del mouse en Chromium a 1280×860: abre, se queda abierta y cierra solo con
la ✕.

---

## 5. Archivos

### Nuevo
- **`vendo-premium.js`** — el cerebro de todo esto. Está en las dos apps y es el **mismo archivo**:
  decide quién es Premium, pinta la pantalla de desbloqueo, pone las puertas y apaga el robot.
  Si algún día quieres mover una función de "paga" a "gratis", se cambia **aquí y nada más**.

### Modificados
| Archivo | Qué se le hizo |
|---|---|
| `index.html` (web y Android) | `hasAccess()` ahora siempre deja entrar · se borró la pantalla de "cuenta pausada" · se quitó la bienvenida del mes gratis · términos y textos nuevos · `preconnect` a Supabase · fotos de las listas largas con carga diferida. **El login quedó exactamente como estaba.** |
| `vendo-escaner-ia.js` | 3 escaneos gratis al mes, contados por el servidor · Premium sin límite · al agotarse sale Premium, no un error · un error técnico no gasta escaneo |
| `vendo-mascota.js` | El chat ya no abre sin Premium · el robot se queda **inactivo** (no dormido) y no saluda ni invita |
| `vendo-cerebro.js` (solo Android) | Se sincronizó con la versión de la web, que tenía "hace N días" y a la de Android le faltaba |
| `vendo-app.js` (solo Android) | Se quitó la pantalla de "cuenta pausada" de Google Play |
| `web-nativo/preparar_web.py` | Ahora copia **todos** los `.js` (incluido `vendo-premium.js`) y ajusta bien el texto de Stripe → Google Play. Si lo corres, reproduce los assets exactamente. |
| `app/build.gradle` (Android) | `versionCode 14 → 15`, `versionName 1.2.3 → 1.3.0` (necesario para subir a Play) |
| `supabase/vp_ia_premium.sql` | **Nuevo.** 3 escaneos gratis al mes y Premium sin límite. Ver la sección 6. |
| `supabase/functions/vp-escaner-ia/index.ts` | Se quitó el rechazo por "cuenta pausada" y el mensaje de límite ahora invita a Premium |

---

## 6. El servidor: por qué te daba muchos escaneos (ya corregido)

Con el SQL que me pasaste quedó clarísimo el bug:

```sql
escaneos_mes_por_usuario  int  not null default 60
```

Eran **60 escaneos al mes para todos**, no 3. Y además `vp_ia_reservar()` rechazaba con
`cuenta_pausada` a cualquiera cuya prueba se hubiera vencido —cosa que ya no tiene sentido, porque la
app es gratis y una cuenta nunca se pausa.

### Lo que hay que correr (sirve para las DOS apps)

Los dos archivos vienen en el ZIP de Android en `supabase/`, y en el de la web en
`_servidor-supabase/` (esa carpeta **no la subas a tu hosting**, es solo para que no se te pierda).

**1) `vp_ia_premium.sql`** → Supabase › SQL Editor › pégalo completo › **Run**.
Se puede correr varias veces, no borra nada y no pierde el consumo que ya llevan tus usuarios.
Lo que hace:

| | Antes | Ahora |
|---|---|---|
| Sin Premium | 60 al mes | **3 al mes** (`escaneos_gratis_mes`) |
| Con Premium | 60 al mes | **sin límite** (`escaneos_premium_mes = 0`) |
| Prueba vencida | `cuenta_pausada`, no escaneaba | ya no existe ese bloqueo |
| `vp_ia_mi_consumo()` | límite fijo | devuelve el límite correcto y `premium: true/false` |

**2) `vp-escaner-ia/index.ts`** → reemplaza el tuyo y despliega:
```
supabase functions deploy vp-escaner-ia
```
Quita el estado 402 de "cuenta pausada" y cambia el mensaje de límite por uno que invita a Premium.

**Corre primero el SQL y después despliega la función.**

### Qué NO gasta escaneo
Esto ya lo hacía bien tu script y se respetó igual: el contador solo sube en `vp_ia_confirmar()`.
Así que **no** gastan ninguno de los 3:
- una foto repetida (se sirve desde la caché),
- una foto de la que no salió ningún producto,
- cualquier error técnico (sin internet, Gemini caído, respuesta inválida) → `vp_ia_liberar()`.

### Para comprobarlo
```sql
select escaneos_gratis_mes, escaneos_premium_mes from public.vp_ia_escaner_config where id = 1;
-- esperado:  3 | 0

select public.vp_ia_mi_consumo();
-- sin Premium: "limite": 3, "restantes": 3
-- con Premium: "limite": null, "premium": true
```
Para volver a probar desde cero con una cuenta:
```sql
delete from public.vp_ia_consumo where user_id = '<el uuid del usuario>';
```

### Un aviso sobre el presupuesto
`presupuesto_mes_usd` sigue en **$25 USD al mes para todos juntos**. Es tu tope de gasto global y es
lo que te protege ahora que Premium es ilimitado. Cuando crezcas, súbelo:
```sql
update public.vp_ia_escaner_config set presupuesto_mes_usd = 60 where id = 1;
```

---

## 6b. Lo que sigue pendiente de tu lado ⚠️

**La oferta de "prueba gratis 1 mes" en Google Play.** En `PlayBilling.java` hay código que, si existe
la oferta `prueba-gratis-1-mes` en tu suscripción de Play Console, la elige primero. **No lo toqué**
porque si tu plan base solo tiene esa oferta, quitarlo rompería la compra. Si ya no quieres regalar el
primer mes de Premium, **borra esa oferta desde Play Console**.

**Los textos de las tiendas.** Dentro de la app ya no se promete ningún mes gratis, pero la ficha de
Google Play y tu página siguen igual. Te conviene algo como *"Punto de venta GRATIS: vende, haz
tickets, lleva tu caja e inventario. Sin tarjeta y sin límite de tiempo. Premium opcional $149/mes."*

---

## 7. Probado

Con un navegador real (Chromium), en las dos apps y en los dos estados:

| | Web gratis | Web Premium | Android gratis | Android Premium |
|---|---|---|---|---|
| ¿Se bloquea la app? | No | No | No | No |
| Menú Digital | Entra · Premium al activar | Activa | Entra · Premium al activar | Activa |
| Chat del robot | Premium | Abre | Premium | Abre |
| Botón "Ver estadísticas detalladas" | Está, abre Premium | Está, abre el detalle | Está, abre Premium | Está, abre el detalle |
| Iconos de candado a la vista | 0 | 0 | 0 | 0 |
| Errores de JavaScript | 0 | 0 | 0 | 0 |

Más el clic real del mouse al robot en PC (1280×860): abre, se queda y cierra con la ✕.
Y la pantalla de Premium sin scroll interno en 9 tamaños distintos, del iPhone SE a la computadora.
También se revisó la sintaxis de los 5 archivos `.js` y de los 23 bloques de script de cada
`index.html`.
