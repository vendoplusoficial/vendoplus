# Vendo+ · Cómo conectarlo (≈ 30 min)

Todo el código ya está dentro de `index.html`. Tú solo creas las cuentas y pegas claves.

## 1. Supabase
1. Crea un proyecto en supabase.com.
2. **SQL Editor** → pega `supabase/schema.sql` → Run. (Crea tablas, seguridad y el bucket de fotos.)
3. **Authentication → Providers → Phone**: actívalo, elige **Twilio**, pega tu *Account SID*, *Auth Token* y *Message Service SID*. Activa **Enable phone confirmations**.
4. **Authentication → Sign In / Providers → Password**: pon longitud mínima **8**.
5. **Project Settings → API**: copia la *Project URL* y la clave *anon / publishable*.
6. Abre `index.html`, busca `VENDO_CONFIG` y pega esas dos cosas.

## 2. Twilio
- Cuenta con un número o *Messaging Service* que pueda mandar SMS a México (+52).
- Una cuenta de prueba solo manda a números verificados; para público real hay que pasar a cuenta de pago.

## 3. Stripe
1. Productos → crea **Vendo+ mensual**, precio recurrente mensual, **$129 MXN** (si cambias el precio, cambia también `TRIAL_PRECIO` en `index.html`).
2. Copia el `price_...` (ID del precio) y tu clave secreta `sk_...`.
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

## 4. Publicar
Sube `index.html` a tu hosting (Netlify, Vercel, Cloudflare Pages, etc.) y pon esa URL en `APP_URL`.

## Cómo funciona
- **Crear cuenta:** celular + contraseña (mín. 8) → SMS con código → listo. Empieza **1 mes gratis**.
- **Iniciar sesión:** solo celular + contraseña, sin SMS.
- **Olvidé mi contraseña:** SMS con código → eliges contraseña nueva.
- **Datos:** todo se guarda en Supabase; las fotos en Storage (bucket `fotos`).
- **Cobro:** al terminar el mes la cuenta se pausa y sale la pantalla de pago con Stripe. Al pagar, el webhook la reactiva sola. Si no se renueva, vuelve a pausarse.
- **Datos que ya tenías en el navegador:** al crear tu cuenta nueva se suben solos a Supabase.
- Con las claves vacías la app sigue funcionando local, como antes.
