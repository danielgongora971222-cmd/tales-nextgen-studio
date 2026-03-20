# STRIPE IMPLEMENTACIÓN FINAL — STAGING

Esta guía está aterrizada a **staging** y al estado actual del proyecto.

## Objetivo

1. Integrar Stripe sin tocar `main`.
2. Mantener vivas las herramientas admin que ya existen para asignar planes y créditos manualmente.
3. Limpiar el catálogo de billing antes de crear productos y precios en Stripe.
4. Dejar `staging` listo para probar en modo test y, cuando todo funcione, dejar Stripe real activo también en `staging`.

---

## Estado detectado antes de Stripe

### 1) Los topups tienen filas duplicadas en la base

Se detectó que `credit_topup_products` puede tener duplicados del mismo pack.

### 2) `credits_amount` quedó desalineado en algunos topups

En algunos entornos el nombre ya dice `1,108`, `2,218`, etc., pero `credits_amount` sigue con valores viejos (`1000`, `2200`, etc.).

Eso es importante porque:

- la UI y el backend consumen `credits_amount`
- Stripe también debe quedar alineado con ese valor

### 3) Antes de crear precios en Stripe hay que normalizar el catálogo

Por eso este bundle añade un patch nuevo:

```text
infra/supabase/patches/2026-03-20_billing_catalog_cleanup_and_reprice.sql
```

Ese patch hace tres cosas:

- sube `pro_month` a **37.99 USD**
- sube `partner_month` a **67.99 USD**
- corrige créditos de esos planes manteniendo el valor actual de créditos por dólar
- sincroniza topups canónicos
- desactiva duplicados de topups para dejar una sola fila activa por pack

---

## Catálogo final que debes dejar en staging antes de crear precios en Stripe

### Planes

Valores finales esperados:

- `basic_week` → **4.99 USD** → **1100 créditos**
- `standard_month` → **17.99 USD** → **3994 créditos**
- `pro_month` → **37.99 USD** → **8434 créditos**
- `partner_month` → **67.99 USD** → **15094 créditos**
- `business_month` → **87.99 USD** → **19534 créditos**

### Topups

Valores finales esperados:

- `topup_499_1108` → **4.99 USD** → **1108 créditos**
- `topup_999_2218` → **9.99 USD** → **2218 créditos**
- `topup_1999_4438` → **19.99 USD** → **4438 créditos**
- `topup_3499_7768` → **34.99 USD** → **7768 créditos**
- `topup_4999_11098` → **49.99 USD** → **11098 créditos**

---

## Orden correcto de trabajo

Hazlo en este orden exacto:

1. Reemplaza archivos del bundle en tu repo local.
2. Entra a Supabase.
3. Ejecuta el patch nuevo de limpieza y reprice.
4. Verifica que el catálogo quedó limpio.
5. Crea productos y precios en Stripe **TEST MODE**.
6. Configura portal y webhook en Stripe.
7. Configura variables en Render.
8. Configura `VITE_API_BASE_URL` en Vercel staging.
9. Ejecuta el patch de Stripe checkout.
10. Mapea los `price_...` en Supabase.
11. Haz deploy a `staging`.
12. Prueba.
13. Solo cuando todo funcione, cambia `ALLOW_PUBLIC_MOCK_BILLING=0`.

---

## Paso 1 — Reemplaza los archivos del bundle

Ruta local:

```powershell
C:\PROYECTOS\tales-nextgen-studio
```

Descomprime el bundle y reemplaza los archivos homólogos en tu repo.

---

## Paso 2 — Ejecuta primero el patch nuevo de catálogo

Archivo:

```text
infra/supabase/patches/2026-03-20_billing_catalog_cleanup_and_reprice.sql
```

### Cómo aplicarlo en Supabase

1. Abre tu proyecto en Supabase.
2. Ve a **SQL Editor**.
3. Crea una query nueva.
4. Abre el archivo del patch en tu repo local.
5. Copia todo su contenido.
6. Pégalo en el editor SQL.
7. Ejecuta la query.

---

## Paso 3 — Verifica que el catálogo quedó bien

Después del patch nuevo, ejecuta esto.

### Planes

```sql
select slug, name, billing_period, price_cents, plan_credits, bonus_credits, stripe_price_id
from public.billing_plans
where is_active = true
order by price_cents asc;
```

Debes ver, como mínimo, esto en la parte de planes:

- `pro_month` con `price_cents = 3799` y `plan_credits = 8434`
- `partner_month` con `price_cents = 6799` y `plan_credits = 15094`

### Topups

```sql
select id, sku, name, price_cents, credits_amount, stripe_price_id, is_active
from public.credit_topup_products
order by price_cents asc, created_at asc;
```

### Qué debes comprobar

- solo debe quedar **1 fila activa** por cada pack de precio
- los `sku` deben quedar así:
  - `topup_499_1108`
  - `topup_999_2218`
  - `topup_1999_4438`
  - `topup_3499_7768`
  - `topup_4999_11098`
- `credits_amount` debe coincidir con el nombre del pack
- si había duplicados, los sobrantes deben quedar `is_active = false`

Si en este punto todavía ves dos filas activas con el mismo precio, **no sigas con Stripe todavía**.

---

## Paso 4 — Crea los productos y precios en Stripe TEST MODE

Primero activa **Test mode** en Stripe.

### Producto 1: membresías

Crea **un solo producto** para las suscripciones.

Nombre recomendado:

```text
Tales NextGen Studio Membership
```

Dentro de ese producto crea estos precios recurrentes:

1. `basic_week`
   - **4.99 USD**
   - **Recurring**
   - **Weekly**

2. `standard_month`
   - **17.99 USD**
   - **Recurring**
   - **Monthly**

3. `pro_month`
   - **37.99 USD**
   - **Recurring**
   - **Monthly**

4. `partner_month`
   - **67.99 USD**
   - **Recurring**
   - **Monthly**

5. `business_month`
   - **87.99 USD**
   - **Recurring**
   - **Monthly**

### Producto 2: créditos extra

Crea otro producto:

```text
Tales NextGen Studio Extra Credits
```

Dentro de ese producto crea precios **One time**:

- **4.99 USD**
- **9.99 USD**
- **19.99 USD**
- **34.99 USD**
- **49.99 USD**

---

## Paso 5 — Cómo encontrar cada `price_...` en Stripe

Tu integración crea Checkout Sessions usando **Price IDs**, no montos escritos a mano. Stripe documenta que Checkout usa el `price` ID en `line_items`, y que productos y precios se gestionan desde el catálogo de productos del Dashboard. citeturn830733search2turn233855search3turn830733search0

### Haz esto para cada precio

1. Ve a **Stripe Dashboard**.
2. Asegúrate de que **Test mode** está activo.
3. Entra a **Product catalog**.
4. Abre el producto que acabas de crear.
5. Dentro del producto verás la lista de precios.
6. Abre uno de los precios.
7. Copia el identificador que empieza por:

```text
price_
```

Guárdalo en un bloc de notas.

### Qué debes guardar

Debes terminar con 10 IDs de prueba:

#### Planes

- `basic_week` → `price_...`
- `standard_month` → `price_...`
- `pro_month` → `price_...`
- `partner_month` → `price_...`
- `business_month` → `price_...`

#### Topups

- `topup_499_1108` → `price_...`
- `topup_999_2218` → `price_...`
- `topup_1999_4438` → `price_...`
- `topup_3499_7768` → `price_...`
- `topup_4999_11098` → `price_...`

---

## Paso 6 — Configura Stripe Customer Portal

Stripe permite configurar desde el Dashboard qué puede hacer el cliente en el portal: cambiar plan, actualizar método de pago, ver facturas, etc. También permite fijar una configuración concreta por `configuration` ID cuando lanzas la sesión. citeturn233855search0turn233855search1turn233855search5

### Qué debes activar

En el portal deja habilitado:

- cambio de plan
- actualización de método de pago
- historial de facturas
- cancelación de suscripción
- downgrade al final del periodo

### Recomendación

Para este proyecto deja:

- cancelación al final del periodo
- cambios de plan al final del periodo si estás haciendo downgrade

### Sobre `STRIPE_BILLING_PORTAL_CONFIGURATION_ID`

No es obligatorio.

Úsalo solo si:

- tienes varias configuraciones del portal
- quieres obligar al backend a usar una específica

Si solo tienes una configuración por defecto en Stripe, puedes **omitir esta variable**.

---

## Paso 7 — Crea el webhook de Stripe hacia Render staging

Stripe exige endpoint HTTPS accesible públicamente y firma propia del webhook (`whsec_...`). Además, la firma del webhook es distinta de la API key. citeturn581740search1turn581740search2turn581740search0

### URL

```text
https://TU-BACKEND-STAGING-RENDER.onrender.com/api/billing/stripe/webhook
```

### Eventos mínimos

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`

### Qué guardar

Cuando Stripe te muestre el secreto del endpoint, copia el valor que empieza por:

```text
whsec_
```

Ese valor va en Render.

---

## Paso 8 — Variables de entorno en Render

Estas son las variables para el backend de **staging**.

### Obligatorias

```text
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
APP_PUBLIC_URL=https://TU-FRONTEND-STAGING-VERCEL
ALLOW_PUBLIC_MOCK_BILLING=1
ALLOWED_ORIGINS=https://TU-FRONTEND-STAGING-VERCEL
```

### Qué significa cada una

- `STRIPE_SECRET_KEY`: tu secret key de Stripe test. Stripe indica que las claves secretas de pruebas empiezan por `sk_test_` y se gestionan en la zona de API keys del Dashboard. citeturn581740search0
- `STRIPE_WEBHOOK_SECRET`: el secreto del webhook que empieza por `whsec_...`; Stripe lo muestra en la configuración del endpoint. citeturn581740search1turn581740search0
- `APP_PUBLIC_URL`: URL de tu frontend staging en Vercel
- `ALLOW_PUBLIC_MOCK_BILLING=1`: deja el cobro mock público activo mientras conectas Stripe
- `ALLOWED_ORIGINS`: **ponla sí o sí** si el frontend de staging hablará directo con Render usando `VITE_API_BASE_URL`

### `STRIPE_ENABLE_AUTOMATIC_TAX=0`

Puedes añadirla, pero no es obligatoria para arrancar.

Tu código ya trata la ausencia de esta variable como `false`. Añadirla en `0` solo deja explícito que **no** vas a usar Stripe Tax todavía.

Stripe documenta que `automatic_tax[enabled]=true` activa cálculo automático de impuestos en Checkout; si no vas a configurarlo todavía, dejarlo apagado es correcto. citeturn242547search0turn242547search4

Valor recomendado ahora:

```text
STRIPE_ENABLE_AUTOMATIC_TAX=0
```

### `ALLOWED_ORIGIN_SUFFIXES=.vercel.app`

Solo añádela si realmente usarás **preview URLs** de Vercel.

- Si vas a probar siempre desde una sola URL fija de staging, puedes **no ponerla**.
- Si quieres que también funcionen previews temporales de Vercel, entonces sí añádela:

```text
ALLOWED_ORIGIN_SUFFIXES=.vercel.app
```

### `STRIPE_BILLING_PORTAL_CONFIGURATION_ID=bpc_...`

Déjala vacía si no la necesitas.

Solo la pones si en Stripe ves varias configuraciones del portal y quieres fijar una concreta.

### Cupones de referido

```text
STRIPE_COUPON_REFERRAL_5=coupon_xxx
STRIPE_COUPON_REFERRAL_10=coupon_xxx
STRIPE_COUPON_REFERRAL_15=coupon_xxx
STRIPE_COUPON_REFERRAL_20=coupon_xxx
```

Estas variables no son obligatorias para arrancar Stripe básico.

Pero **sí son obligatorias** si quieres que una compra de plan con descuento por referido funcione también en Stripe.

Si no las configuras:

- el checkout normal sin referido funciona
- el checkout con código de referido que requiera descuento no quedará completo correctamente

Mi recomendación para una implementación limpia es:

- si vas a probar solo flujo normal, puedes dejarlo para después
- antes de abrir Stripe al público en staging, configura también estos 4 cupones si quieres conservar ese comportamiento premium

---

## Paso 9 — Variable en Vercel staging

En Vercel staging agrega:

```text
VITE_API_BASE_URL=https://TU-BACKEND-STAGING-RENDER.onrender.com
```

Hazlo en el entorno que uses para staging.

Esto es importante porque tu repo tiene un rewrite fijo en `vercel.json`, y para staging conviene forzar explícitamente la URL del backend correcto.

---

## Paso 10 — Aplica el patch de Stripe checkout

Archivo:

```text
infra/supabase/patches/2026-03-17_stripe_billing_checkout.sql
```

### Cómo aplicarlo

1. En Supabase abre una query nueva.
2. Pega el contenido completo del archivo.
3. Ejecuta.

Ese patch crea las tablas y funciones necesarias para Stripe:

- clientes Stripe
- auditoría de webhooks
- checkout de topups
- sincronización de suscripciones

---

## Paso 11 — Mapea los `price_...` en Supabase

Después del patch de Stripe, ejecuta estos `update`.

### Planes

```sql
update public.billing_plans set stripe_price_id = 'price_xxx' where slug = 'basic_week';
update public.billing_plans set stripe_price_id = 'price_xxx' where slug = 'standard_month';
update public.billing_plans set stripe_price_id = 'price_xxx' where slug = 'pro_month';
update public.billing_plans set stripe_price_id = 'price_xxx' where slug = 'partner_month';
update public.billing_plans set stripe_price_id = 'price_xxx' where slug = 'business_month';
```

### Topups

Hazlo por `sku`, no por nombre:

```sql
update public.credit_topup_products set stripe_price_id = 'price_xxx' where sku = 'topup_499_1108';
update public.credit_topup_products set stripe_price_id = 'price_xxx' where sku = 'topup_999_2218';
update public.credit_topup_products set stripe_price_id = 'price_xxx' where sku = 'topup_1999_4438';
update public.credit_topup_products set stripe_price_id = 'price_xxx' where sku = 'topup_3499_7768';
update public.credit_topup_products set stripe_price_id = 'price_xxx' where sku = 'topup_4999_11098';
```

### Verificación

```sql
select slug, price_cents, stripe_price_id
from public.billing_plans
where is_active = true
order by price_cents asc;

select sku, price_cents, credits_amount, stripe_price_id, is_active
from public.credit_topup_products
where is_active = true
order by price_cents asc;
```

No sigas hasta ver todos los `stripe_price_id` cargados.

---

## Paso 12 — Qué debes probar en staging

### Caso A — compra de plan

1. Inicia sesión con un usuario de prueba.
2. Ve al paywall.
3. Compra `basic_week`.
4. Completa el checkout.
5. Verifica:
   - vuelves a la app
   - el plan queda activo
   - se cargan los créditos del plan
   - `billing_subscriptions.provider = 'stripe'`

### Caso B — compra de topup

1. Compra un pack de créditos.
2. Verifica:
   - el checkout termina
   - suben los créditos
   - existe registro en `credit_topup_purchases`

### Caso C — portal

1. Ve a Profile.
2. Abre la gestión de billing.
3. Verifica que el portal abre.
4. Verifica cambio de método de pago.

### Caso D — cancelación

1. Programa cancelación desde el portal.
2. Verifica:
   - `cancel_at_period_end = true`
   - conserva acceso hasta fin del periodo

### Caso E — admin manual

1. Asigna manualmente un plan a un usuario.
2. Da créditos manuales.
3. Cancela manualmente.
4. Verifica que todo sigue vivo.

### Caso F — referidos

1. Prueba una compra sin código.
2. Prueba una compra con código solo si ya configuraste los `STRIPE_COUPON_REFERRAL_*`.

### Caso G — 1NationUp

Debe seguir como está, sin Stripe por ahora.

---

## Paso 13 — Cuando todo funcione en staging

Solo cuando hayas comprobado:

- checkout de plan
- checkout de topup
- webhook
- portal
- cancelación
- admin manual
- catálogo limpio

entonces cambia en Render:

```text
ALLOW_PUBLIC_MOCK_BILLING=0
```

Eso deja el flujo público apoyado en Stripe en `staging`.

---

## Comandos PowerShell

### Preparar rama

```powershell
cd C:\PROYECTOS\tales-nextgen-studio
git checkout staging
git pull origin staging
```

### Ver cambios

```powershell
git status
```

### Build local

```powershell
npm run build
```

### Commit

```powershell
git add server\routes\billing.js `
        infra\supabase\patches\2026-03-20_billing_catalog_cleanup_and_reprice.sql `
        docs\STRIPE_IMPLEMENTACION_FINAL.md

git commit -m "fix: cleanup billing catalog and reprice pro partner for stripe staging"
git push origin staging
```

---

## Resumen operativo corto

- Los duplicados en topups **no son el estado correcto**.
- Primero limpia catálogo.
- Luego crea precios en Stripe.
- Luego mapea `price_...`.
- Luego prueba.
- Solo al final apagas mock billing público.

