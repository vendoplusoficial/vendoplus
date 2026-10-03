# Vendo+ · Cómo conectarlo (≈ 30 min)

Todo el código ya está dentro de `index.html`. Tú solo creas las cuentas, pegas claves y copias dos plantillas de correo.
Ya **no se usa Twilio ni SMS**: todos los códigos (crear cuenta, recuperar contraseña, cambiar contraseña y "Olvidé mi NIP") llegan **por correo**, enviados desde tu Gmail.

## 1. Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor** → pega `schema.sql` → Run. (Crea tablas, seguridad y el bucket de fotos.)
3. **Authentication → Sign In / Providers**:
   - **Email**: actívalo y deja **Confirm email** encendido.
   - **Email OTP Length**: **6** (si pones otro número, cambia también `CODIGO_DIGITOS` en `index.html`).
   - **Email OTP Expiration**: **600** segundos (10 minutos) está bien.
   - **Minimum password length**: **8**.
   - **Phone**: apágalo (ya no se usa).
4. **Project Settings → API**: copia la *Project URL* y la clave *anon / publishable*.
5. Abre `index.html`, busca `VENDO_CONFIG` y pega esas dos cosas.

## 2. Gmail (quien manda los códigos)
Supabase manda los correos usando tu cuenta de Gmail por SMTP.

1. En tu cuenta de Google: **Seguridad → Verificación en 2 pasos** → actívala (sin esto Google no deja crear la contraseña del paso 2).
2. En la misma sección busca **Contraseñas de aplicaciones** → crea una con el nombre `Vendo`. Google te da una clave de **16 letras**: cópiala **sin espacios**. (Esa clave solo sirve para mandar correos; no es tu contraseña de Gmail.)
3. En Supabase: **Authentication → Emails → SMTP Settings** (en algunos proyectos está en *Project Settings → Authentication*) → activa **Enable Custom SMTP** y llena:

| Campo | Qué poner |
|---|---|
| Sender email | tu Gmail completo, ej. `tunegocio@gmail.com` |
| Sender name | `Vendo+` |
| Host | `smtp.gmail.com` |
| Port | `465` |
| Username | tu Gmail completo (el mismo de arriba) |
| Password | la clave de 16 letras del paso 2 |

4. **Authentication → Rate Limits** → *Rate limit for sending emails*: súbelo a **100 por hora** (al poner SMTP propio empieza muy bajo).
   Gmail personal deja mandar unos **500 correos al día**; para un negocio es de sobra.

## 3. Plantillas de correo (lo que le llega al cliente)
En **Authentication → Emails → Templates** cambia **dos** plantillas. Las dos llevan `{{ .Token }}` (el código). Si dejan el link de antes, llega un link en vez del código y la app no funciona.

### a) "Confirm signup" (le llega a quien crea su cuenta)
**Subject:** `Tu código para crear tu cuenta de Vendo+`
```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#16213E;">
  <h2 style="margin:0 0 8px;">Confirma tu correo</h2>
  <p style="margin:0 0 18px;color:#5B6478;">Escribe este código en Vendo+ para crear tu cuenta:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;background:#E5FAEC;color:#0E7A3D;border-radius:14px;padding:18px 0;">{{ .Token }}</div>
  <p style="margin:18px 0 0;font-size:13px;color:#8A93AC;">El código vence en 10 minutos. Si tú no pediste crear una cuenta, ignora este correo.</p>
</div>
```

### b) "Magic Link" (recuperar o cambiar contraseña y "Olvidé mi NIP")
**Subject:** `Tu código de Vendo+`
```html
<div style="font-family:Arial,Helvetica,sans-serif;max-width:460px;margin:0 auto;padding:24px;color:#16213E;">
  <h2 style="margin:0 0 8px;">Tu código de verificación</h2>
  <p style="margin:0 0 18px;color:#5B6478;">Escribe este código en Vendo+ para continuar:</p>
  <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;background:#E5FAEC;color:#0E7A3D;border-radius:14px;padding:18px 0;">{{ .Token }}</div>
  <p style="margin:18px 0 0;font-size:13px;color:#8A93AC;">Sirve para cambiar tu contraseña o recuperar un NIP. No se lo compartas a nadie que no sea de tu negocio. Vence en 10 minutos.</p>
</div>
```

## 4. Stripe
1. Productos → crea **Vendo+ mensual**, precio recurrente mensual, **$149 MXN** (moneda **MXN**). `TRIAL_PRECIO` en `index.html` ya dice 149; si algún día cambias el precio, cambia los dos.
   > **Si ya tenías creado el precio de $129:** en Stripe los precios no se pueden editar. Dentro del mismo producto dale **Add another price** → $149 MXN mensual, archiva el de $129 y usa el `price_...` **nuevo** en el paso 3. Lo que se cobra de verdad es ese `price_...`; el 149 del index solo es el texto que ve el cliente.
2. Copia el `price_...` (ID del precio de $149) y tu clave secreta `sk_...`.
3. Instala la CLI de Supabase y, en la carpeta de este proyecto:
```bash
supabase link --project-ref TU_REF
supabase secrets set STRIPE_SECRET_KEY=sk_... STRIPE_PRICE_ID=price_... APP_URL=https://tu-dominio.com/
supabase functions deploy create-checkout
supabase functions deploy stripe-webhook --no-verify-jwt
```
4. Stripe → Developers → **Webhooks** → Add endpoint:
   `https://TU_REF.supabase.co/functions/v1/stripe-webhook`, evento **`invoice.paid`**.
5. Copia el *Signing secret* `whsec_...` y corre:
```bash
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```
> Si tu función `create-checkout` usaba el **teléfono** del usuario para crear el cliente de Stripe, cámbialo por su **correo** (`user.email`), porque las cuentas nuevas ya no tienen teléfono.

**Lo que el `index.html` espera de tus dos funciones** (revísalo antes de probar):

| Función | Tiene que… |
|---|---|
| `create-checkout` | Sacar al usuario del token (el index lo manda solo), crear/reusar su cliente de Stripe con su correo y guardar `stripe_customer_id` en `profiles`. Abrir Checkout en modo **`subscription`** con `STRIPE_PRICE_ID` (el de $149). `success_url` = `APP_URL?pago=ok` y `cancel_url` = `APP_URL?pago=cancel`. Responder `{ "url": "https://checkout.stripe.com/..." }`. |
| `stripe-webhook` | Verificar la firma con `STRIPE_WEBHOOK_SECRET`. En **`invoice.paid`**: buscar el perfil por `stripe_customer_id` y poner `paid_until` = fin del periodo pagado de esa factura (recomendado: + 2 días de colchón por si la renovación tarda). Escribir con la clave `service_role` (el cliente no puede). |

Con eso el flujo queda así: **1 mes gratis → se bloquea → paga $149 en Stripe → `invoice.paid` → se libera**. Cada mes Stripe cobra solo; si la tarjeta falla o cancela, ya no llega `invoice.paid`, `paid_until` vence y la cuenta se vuelve a bloquear. Cuando vuelve a pagar, se libera otra vez.

## 5. Publicar
Sube `index.html` a tu hosting (Netlify, Vercel, Cloudflare Pages, etc.) y pon esa URL en `APP_URL`.

## 6. Prueba rápida
1. Abre la app → **Empezar** → escribe tu correo → **Enviar código a mi correo**.
2. Te llega el correo de "Confirm signup" con 6 dígitos (revisa Spam/Promociones la primera vez) → escríbelo → eliges contraseña → listo.
3. Cierra sesión → **Ya tengo una cuenta** → **¿Olvidaste tu contraseña?** → te llega el correo de "Magic Link".

Si no llega nada: en Supabase revisa **Logs → Auth**. Lo más común es la clave de 16 letras mal copiada (con espacios) o la verificación en 2 pasos apagada.

## Cómo funciona
- **Crear cuenta:** correo → código al correo → eliges contraseña (mín. 8) → listo. Empieza **1 mes gratis**.
- **Iniciar sesión:** correo + contraseña, sin código.
- **Olvidé mi contraseña:** código al correo → eliges contraseña nueva.
- **Cambiar contraseña:** Mi cuenta → Seguridad → Cambiar contraseña (código al correo).
- **Olvidé mi NIP:** el código le llega al correo del Dueño (sirve para el NIP de cualquiera del equipo).
- **Datos:** todo se guarda en Supabase; las fotos en Storage (bucket `fotos`).
- **Cobro:** al terminar el mes gratis la cuenta se pausa y sale la pantalla de pago con Stripe ($149 MXN al mes). Al pagar, el webhook la reactiva sola (la app revisa cada 30 s, no hace falta recargar). Si no se renueva, vuelve a pausarse. El bloqueo también lo pone Supabase: sin acceso, no se puede guardar nada ni subir fotos aunque alguien se brinque la pantalla.
- **Datos que ya tenías en el navegador:** al crear tu cuenta nueva se suben solos a Supabase.
- **Cuentas de prueba creadas antes con celular:** ya no pueden entrar; bórralas en *Authentication → Users* y crea la cuenta con tu correo.
- Con las claves vacías la app sigue funcionando local, como antes (entras solo con tu correo, sin códigos).
