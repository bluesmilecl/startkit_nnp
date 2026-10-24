# Correo

El starter envía códigos de acceso, invitaciones y alertas de presupuesto. El proveedor se elige
con una variable (`MAIL_TRANSPORT`) y sus credenciales viven solo en `.env` o en los secretos del
despliegue: nunca en la base de datos ni en `starter.config.json`.

**Por defecto: Resend.** El quickstart lo usa cuando existe `RESEND_API_KEY`; si no, deja el correo
en Mailpit (local, sin enviar nada) para que la instalación funcione igual.

## Elegir proveedor

| Proveedor | `MAIL_TRANSPORT` | Variables | Dónde se obtienen |
| --- | --- | --- | --- |
| **Resend** (recomendado) | `resend` | `RESEND_API_KEY` | resend.com → API Keys; verifica tu dominio en Domains |
| Servidor propio o SMTP de cualquier proveedor | `smtp` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE` (o `SMTP_URL`) | tu servidor o el panel del proveedor |
| Postmark | `postmark` | `POSTMARK_SERVER_TOKEN` | Server → API Tokens |
| SendGrid | `sendgrid` | `SENDGRID_API_KEY` | Settings → API Keys (permiso Mail Send) |
| Mailgun | `mailgun` | `MAILGUN_API_KEY`, `MAILGUN_DOMAIN`, `MAILGUN_REGION` (`us` o `eu`) | Sending → Domains y API Keys |
| Brevo | `brevo` | `BREVO_API_KEY` | SMTP & API → API Keys |
| Solo desarrollo | `log` | ninguna | escribe el mensaje en el log; rechazado en producción |

`MAIL_FROM` es el remitente (`"Mesa de Ayuda <no-reply@tudominio.cl>"`) y debe pertenecer a un
dominio verificado en el proveedor.

## Configurarlo en un comando

Las claves se leen de la terminal (nunca como argumento, para que no queden en el historial) y se
escriben en `.env` con permisos 600:

```bash
export RESEND_API_KEY=re_…
pnpm starter mail use resend --mail-from "Mesa de Ayuda <no-reply@tudominio.cl>"
pnpm starter mail test tu@empresa.cl        # envía un correo real de prueba
```

Otros proveedores:

```bash
SMTP_HOST=smtp.tudominio.cl SMTP_PORT=587 SMTP_USER=no-reply@tudominio.cl SMTP_PASSWORD='…' \
  pnpm starter mail use smtp --mail-from "Mesa de Ayuda <no-reply@tudominio.cl>"
POSTMARK_SERVER_TOKEN=… pnpm starter mail use postmark --mail-from "…"
SENDGRID_API_KEY=SG.… pnpm starter mail use sendgrid --mail-from "…"
MAILGUN_API_KEY=… MAILGUN_DOMAIN=mg.tudominio.cl MAILGUN_REGION=eu pnpm starter mail use mailgun --mail-from "…"
BREVO_API_KEY=xkeysib-… pnpm starter mail use brevo --mail-from "…"
```

`mail use` valida las variables, revisa la clave con el proveedor sin enviar nada (en Resend,
además, que el dominio de `MAIL_FROM` esté verificado) y deja listo el cambio; reinicia
`pnpm dev` o los contenedores para aplicarlo. Desde la instalación:

```bash
RESEND_API_KEY=re_… node scripts/quickstart.mjs --owner tu@empresa.cl --mail-from "Mesa de Ayuda <no-reply@tudominio.cl>"
```

En ese caso el quickstart envía un correo de prueba a la persona propietaria antes de terminar.

### Sin dominio verificado todavía (Resend)

Sin `--mail-from`, el remitente es `onboarding@resend.dev`, la dirección de prueba de Resend:
funciona de inmediato, pero **solo entrega al correo de tu cuenta de Resend**. Sirve para entrar
como propietaria el primer día; para invitar a otras personas verifica un dominio y cambia
`MAIL_FROM`.

## SMTP: servidor propio o de un proveedor

Con `SMTP_HOST` y compañía no hace falta codificar la contraseña en una URL. Puerto 587 usa
STARTTLS; 465 (o `SMTP_SECURE=true`) cifra desde el inicio.

| Servicio | `SMTP_HOST` | Puerto | Usuario / contraseña |
| --- | --- | --- | --- |
| Servidor propio (Postfix, Exim…) | el de tu servidor | 587 o 465 | la cuenta de envío |
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | el correo completo / contraseña de aplicación (requiere verificación en dos pasos) |
| Microsoft 365 | `smtp.office365.com` | 587 | el buzón / su contraseña; requiere SMTP AUTH habilitado y Microsoft está retirando la autenticación básica, así que conviene un proveedor transaccional |
| Amazon SES | `email-smtp.<región>.amazonaws.com` | 587 | credenciales SMTP de SES (no las claves IAM) |
| Resend | `smtp.resend.com` | 465 | `resend` / tu API key |
| Postmark | `smtp.postmarkapp.com` | 587 | el Server API token en ambos campos |
| SendGrid | `smtp.sendgrid.net` | 587 | `apikey` / tu API key |
| Mailgun | `smtp.mailgun.org` (UE: `smtp.eu.mailgun.org`) | 587 | credenciales SMTP del dominio |
| Brevo | `smtp-relay.brevo.com` | 587 | tu login SMTP / clave SMTP |

En desarrollo, `SMTP_URL=smtp://localhost:1025` (Mailpit, `pnpm infra:up`) muestra todos los
correos en http://localhost:8025 sin enviarlos.

## Diagnóstico

- `pnpm starter doctor` y **/admin/diagnostics** revisan la conexión y las credenciales del
  proveedor configurado.
- `pnpm starter mail test <correo>` envía un mensaje real y muestra el motivo si el proveedor lo
  rechaza (clave inválida, dominio sin verificar, destinatario no permitido).
- Los errores de envío siguen el [estándar de errores](errors.md): un rechazo del proveedor (4xx)
  no se reintenta; una caída (5xx, 429, red) sí, con backoff, en los trabajos en segundo plano.

## Estado de verificación

| Transporte | Cómo está probado |
| --- | --- |
| `smtp` | E2E de punta a punta con Mailpit (código de acceso real) |
| `resend` | Implementado con el SDK oficial; verificación de dominio probada con respuestas simuladas |
| `postmark`, `sendgrid`, `mailgun`, `brevo` | Peticiones probadas contra el formato documentado de cada API con respuestas simuladas; confirma tu cuenta con `pnpm starter mail test` |
