# Correo

El starter envía códigos de acceso, invitaciones, alertas de presupuesto y los correos de tus
automatizaciones. Todo se administra en el panel, en **Correo** (permisos `mail.read` y
`mail.manage`):

| Pantalla | Qué haces ahí |
| --- | --- |
| **Proveedor** (`/admin/mail`) | Eliges Resend, SMTP propio, Postmark, SendGrid, Mailgun o Brevo; pruebas la conexión y envías un correo de prueba **antes de guardar** |
| **Plantillas** (`/admin/mail/templates`) | Editas el asunto y el HTML con variables, ves la vista previa en escritorio y celular, y generas correos con IA |
| **Automatizaciones** (`/admin/mail/automations`) | Envías una plantilla cuando ocurre algo (primer ingreso, proyecto creado…) o con una programación |
| **Envíos** (`/admin/mail/deliveries`) | Revisas qué se envió, a quién, con qué proveedor y por qué falló; reintentas los fallidos |

**Dónde quedan las credenciales.** Una clave ingresada en el panel se guarda **cifrada** con
`APP_ENCRYPTION_KEY` (que nunca está en la base) y la API solo devuelve una pista (`re_…abcd`).
Si no guardas nada en el panel, se usan las variables `MAIL_*` de `.env` o de los secretos del
despliegue; **Volver a variables de entorno** borra la configuración guardada. Nunca van en
`starter.config.json`, en los logs ni en la auditoría.

**Por defecto: Resend.** El quickstart lo usa cuando existe `RESEND_API_KEY`; si no, deja el correo
en Mailpit (local, sin enviar nada) para que la instalación funcione igual.

## Configurarlo en el panel

1. Entra a **Correo → Proveedor** y elige el servicio. Para SMTP hay ajustes listos (Gmail,
   Microsoft 365, Amazon SES, Resend, Postmark, SendGrid, Mailgun, Brevo, Mailpit).
2. Completa el remitente, el servidor o la clave. **Probar conexión** revisa las credenciales sin
   enviar nada; **Enviar prueba** manda un correo real con lo que está en el formulario.
3. **Guardar**. El cambio se aplica en la API y el worker en segundos, sin reiniciar.

Con varias personas editando, la configuración usa versión: si alguien guardó antes, el panel
pide recargar (412) en lugar de pisar sus cambios. Cambiar de proveedor exige la clave del nuevo:
la anterior nunca se reutiliza con otro servicio.

**Servidores SMTP en redes privadas.** En producción el panel rechaza un servidor SMTP que resuelve
a una IP privada (evita usar la plataforma para sondear tu red interna). Si tu relay es interno,
define `MAIL_ALLOW_PRIVATE_HOSTS=true`. En desarrollo no hay restricción (Mailpit en `localhost`).

## Elegir proveedor con variables de entorno

Lo mismo puede definirse sin el panel (útil en instalaciones automatizadas). Si hay una
configuración guardada en el panel, esa manda.

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

## Configurarlo en un comando (variables de entorno)

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

## Plantillas y variables

Cada correo del sistema es una plantilla editable. Vienen creadas (y `pnpm db:migrate` agrega las
que falten sin tocar las que editaste):

| Plantilla | Clave | Cuándo se envía | Variables propias |
| --- | --- | --- | --- |
| Código de acceso | `auth.otp` | Al pedir un código en la pantalla de ingreso | `code` (obligatoria), `minutes` |
| Invitación | `users.invitation` | Al invitar desde Usuarios o Invitaciones | `loginUrl` (obligatoria), `inviterName`, `roleName`, `email` |
| Confirmación de registro | `account.confirmation` | Automatización «Bienvenida al primer ingreso» (viene desactivada) | variables de automatización |
| Recuperar contraseña | `auth.password_reset` | **No la envía el starter** (el ingreso es con código); queda lista si tu proyecto agrega contraseñas | `resetUrl` (obligatoria), `name`, `minutes` |
| Alerta de presupuesto de IA | `ai.budget_alert` | Al cruzar un umbral de presupuesto | `budgetName`, `threshold` (obligatorias), `spent`, `limit`, `budgetsUrl` |
| Aviso de actividad | `automation.notice` | Plantilla genérica para automatizaciones | variables de automatización |

Todas reciben además `appName`, `appUrl`, `primaryColor`, `logoUrl` y `supportEmail` (de
**Configuración → Marca**) y `year`.

Sintaxis:

| Escribes | Resultado |
| --- | --- |
| `{{recipient.name}}` | El valor, con el HTML escapado (nunca se inserta HTML desde una variable) |
| `{{#inviterName}}…{{/inviterName}}` | El bloque solo si la variable tiene valor |
| `{{^inviterName}}…{{/inviterName}}` | El bloque solo si la variable está vacía |

El editor muestra las variables disponibles (un clic las inserta donde está el cursor), avisa de
variables desconocidas u obligatorias que faltan, y la vista previa usa valores de ejemplo
editables con tu marca real. Una plantilla del sistema no se puede guardar sin sus variables
obligatorias (un código de acceso sin `{{code}}` dejaría a todos afuera) y se puede
**Restablecer** al contenido original. Si una plantilla editada fallara al renderizar, el código de
acceso se envía igual con el contenido incorporado.

Las plantillas propias (**Nueva plantilla**) tienen una clave única (`avisos.renovacion`); no se
pueden eliminar mientras una automatización las use.

### Generar con IA

**Generar con IA** en el editor redacta (o mejora) el asunto y el HTML a partir de una
descripción, respetando las variables disponibles. Usa el modelo del asistente publicado (o
cualquier modelo de chat verificado), registra el costo en **IA → Uso** con la función
`mail_template` y respeta los presupuestos. El HTML generado se trata como no confiable: se
eliminan scripts, iframes, formularios, atributos `on…` y enlaces `javascript:`. El resultado queda
en el editor para revisarlo; nada se guarda hasta que presionas **Guardar** (y **Deshacer** vuelve
a tu versión). Requiere el módulo de IA y los permisos `mail.manage` y `ai.chat`.

### Enviar una plantilla desde código

```ts
await mailer.send({
  to: email,
  subject, html, text,               // contenido de respaldo si la plantilla no existe
  category: 'invitation',
  template: { key: 'users.invitation', data: { loginUrl, inviterName } },
});
```

El `ConfiguredMailer` (inyectado como `MAILER` en la API y en el contexto del worker) resuelve el
proveedor guardado, aplica la plantilla con la marca y deja una fila en **Envíos**. Para una
plantilla nueva del sistema, agrégala a `DEFAULT_MAIL_TEMPLATES` en `packages/mail/src/defaults.ts`.

## Automatizaciones

Una automatización envía una plantilla cuando ocurre una acción auditada o según una programación:

- **Cuándo:** un evento del catálogo (`MAIL_EVENTS` en `packages/contracts/src/mail.ts`) o
  **Programado** con una expresión cron de 5 campos en UTC (con atajos: cada lunes, cada día…).
- **A quién:** la persona del evento (quien ingresó, la persona creada o invitada), quien hizo la
  acción, todas las personas activas de un rol o correos fijos.
- **Demora opcional** en minutos (por ejemplo, un correo de seguimiento 2 días después).

| Evento | Grupo | «La persona del evento» |
| --- | --- | --- |
| `users.register` Primer ingreso de una persona | Personas | quien ingresó |
| `auth.login` Inicio de sesión | Personas | quien ingresó |
| `users.create` Persona creada por un administrador | Personas | la persona creada |
| `users.update` / `users.disable` / `users.enable` | Personas | la persona afectada |
| `users.invite` Invitación enviada | Personas | el correo invitado |
| `roles.update` Rol modificado | Acceso | — |
| `settings.update` Configuración cambiada | Sistema | — |
| `projects.create` / `projects.delete` | Proyectos | — |
| `rag.documents.upload` Documento subido al conocimiento | Conocimiento | — |

Las plantillas de automatización reciben `recipient.name`, `recipient.email`, `event.label`,
`event.date`, `actor.name`, `actor.email` y `resource.name` (nunca los datos completos del
registro auditado). **Enviarme una prueba** manda la plantilla con valores de ejemplo.

Cómo funciona: el worker revisa cada minuto los eventos de auditoría nuevos (con unos 15 segundos
de margen para que terminen las transacciones) y las programaciones vencidas, crea una fila en
**Envíos** por destinatario (con una clave única: un mismo evento nunca envía dos veces) y la
envía con un trabajo durable `mail.send` con reintentos. Solo cuentan los eventos posteriores a
la activación: activar una automatización no reenvía el historial. Si la desactivas antes de que
salga un envío demorado, queda como **omitido**.

**Agregar un evento:** como toda mutación administrativa ya llama a `recordAudit`, basta con
sumar su acción a `MAIL_EVENTS` (con etiqueta, grupo y, si corresponde, de dónde sale «la persona
del evento»).

## Envíos

Cada correo deja una fila con estado (en cola, enviado, fallido, omitido), destinatario, plantilla,
proveedor, identificador del proveedor, intentos y error. **No se guarda el asunto ni el
contenido** (un código de acceso nunca queda en la base). Los envíos fallidos de automatizaciones
se pueden **Reintentar**; los correos del sistema no, porque su contenido no se guarda (pide un
código o invitación nuevos). Las filas de más de 90 días se eliminan en el mantenimiento automático del worker.

## Diagnóstico

- **Correo → Proveedor → Probar conexión** revisa las credenciales guardadas o las del formulario;
  **Envíos** muestra el motivo exacto de cada rechazo.
- `pnpm starter doctor` y **/admin/diagnostics** revisan la conexión y las credenciales del
  proveedor de las variables de entorno.
- `pnpm starter mail test <correo>` envía un mensaje real y muestra el motivo si el proveedor lo
  rechaza (clave inválida, dominio sin verificar, destinatario no permitido).
- Los errores de envío siguen el [estándar de errores](errors.md): un rechazo del proveedor (4xx)
  no se reintenta; una caída (5xx, 429, red) sí, con backoff, en los trabajos en segundo plano.

## Estado de verificación

| Transporte | Cómo está probado |
| --- | --- |
| `smtp` | E2E de punta a punta con Mailpit (código de acceso real, prueba desde el panel y automatización) |
| `resend` | Implementado con el SDK oficial; verificación de dominio probada con respuestas simuladas |
| `postmark`, `sendgrid`, `mailgun`, `brevo` | Peticiones probadas contra el formato documentado de cada API con respuestas simuladas (Postmark también configurado desde el panel en las pruebas de integración); confirma tu cuenta con **Enviar prueba** o `pnpm starter mail test` |
