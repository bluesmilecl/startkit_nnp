# Autenticación

El acceso es **solo con código de un solo uso (OTP) por correo**, sobre Better Auth montado en la
API (`/api/auth/*`). No existen contraseñas, inicio social ni cambio de correo por autoservicio:
esas rutas de Better Auth están deshabilitadas (`DISABLED_AUTH_PATHS` en
[`packages/auth/src/better-auth.ts`](../packages/auth/src/better-auth.ts)) para que todo cambio de
identidad pase por los servicios auditados.

## Flujo

1. `/login`: la persona escribe su correo → `POST /api/auth/email-otp/send-verification-otp`.
2. Si el correo tiene acceso, se envía un código; si no, la respuesta es **la misma** pero no se
   envía nada (sin enumeración de cuentas).
3. `/verify`: ingresa el código → `POST /api/auth/sign-in/email-otp`. Se crea la sesión (cookie
   `HttpOnly`, `SameSite=Lax`, `Secure` en producción) y se registra `auth.login` en la auditoría.
4. En el primer ingreso se crea el usuario solo si el registro lo permite; se aplican las
   invitaciones pendientes (roles y membresías).

## Parámetros (variables de entorno)

| Variable | Defecto | Efecto |
| --- | --- | --- |
| `OTP_LENGTH` | `6` | Dígitos del código. |
| `OTP_EXPIRES_SECONDS` | `300` | Vigencia del código (5 minutos). |
| `OTP_MAX_ATTEMPTS` | `5` | Intentos fallidos antes de invalidar el código. |
| `OTP_RESEND_SECONDS` | `60` | Espera mínima para pedir otro código (error `OTP_RESEND_COOLDOWN` con `retryAfter`). |
| `SESSION_EXPIRES_DAYS` | `7` | Duración de la sesión (se renueva una vez al día con actividad). |
| `REGISTRATION_MODE` | `invite-only` | Valor inicial del modo de registro (luego se cambia en Configuración). |
| `BETTER_AUTH_SECRET` | — | Secreto de firma (≥ 32 caracteres). |
| `APP_URL`, `TRUSTED_ORIGINS` | — | Origen público y orígenes adicionales aceptados. |

Los códigos se guardan **hasheados**. No hay caché de sesión en cookies: revocar una sesión o
desactivar una cuenta surte efecto en la siguiente solicitud.

### Cuenta de demostración

Para demos y desarrollo, `DEMO_LOGIN_EMAIL=demo@tudominio.cl` hace que **esa cuenta** ingrese
siempre con `DEMO_LOGIN_CODE` (por defecto `111111`, con `OTP_LENGTH` dígitos): no se envía correo,
no aplica la espera entre reenvíos y la pantalla de ingreso muestra el correo y el código con un
botón «Entrar con la cuenta demo». El resto de las cuentas sigue con códigos aleatorios.

- El arranque **falla con `NODE_ENV=production`** si `DEMO_LOGIN_EMAIL` está definido.
- La cuenta debe existir o tener acceso (usa el mismo correo de `OWNER_EMAIL` o invítala); su rol
  es el que tenga en la plataforma, así que en una demo pública cualquiera entra con ese rol.
- `pnpm starter doctor` lo marca como advertencia.

## Modos de registro

| Modo | Quién puede crear cuenta |
| --- | --- |
| `invite-only` (recomendado) | Solo correos con una invitación vigente. |
| `open` | Cualquier correo; recibe el rol `viewer` por defecto. |
| `disabled` | Nadie, salvo la invitación de propietario (*bootstrap*). |

El modo se edita en `/admin/settings` (permiso `settings.update`) y durante el onboarding.

## Invitaciones

`/admin/invitations` (permiso `users.invite`): invita por correo con un rol opcional y vigencia en
días; se pueden reenviar y revocar. La invitación se aplica al ingresar con el código. Los usuarios
también pueden crearse desde `/admin/users` (con o sin correo de invitación).

## Propietario inicial y recuperación

- `OWNER_EMAIL` + `pnpm db:migrate`: si no hay propietarios, se asigna el rol al usuario existente
  o se crea una invitación de tipo *bootstrap* (válida aunque el registro esté deshabilitado).
- `pnpm starter owner assign <correo> [--additional] [--yes]`: asignación de emergencia desde el
  servidor (requiere acceso a la base; nunca se expone por HTTP). Se audita como acción del sistema.
- Nunca se puede desactivar, eliminar ni quitar el rol al **último propietario activo**.

## Protecciones

| Riesgo | Mitigación |
| --- | --- |
| Fuerza bruta de códigos | Intentos máximos por código, expiración, códigos hasheados; límites de tasa: 5 envíos/min y 10 ingresos/min por ruta (desactivados solo con `NODE_ENV=test`), 100 solicitudes/min en general. |
| Spam de correos | Espera entre reenvíos (`OTP_RESEND_SECONDS`) y límite de envíos. |
| Enumeración de cuentas | Misma respuesta para correos sin acceso. |
| CSRF | Cookies `SameSite=Lax` + verificación de `Origin`/`Referer`/`Sec-Fetch-Site` en toda escritura de la API de negocio (`CsrfMiddleware`); Better Auth valida sus propios orígenes de confianza. |
| Cuentas desactivadas | No pueden crear sesión (`ACCOUNT_DISABLED`) y sus sesiones se revocan. |
| Códigos en logs | Se redactan `otp`/`code`; el transporte `log` está prohibido en producción. |
| Código fijo de demostración | `DEMO_LOGIN_EMAIL` se rechaza en producción y solo aplica a ese correo. |

## Correo transaccional

Resend por defecto; también SMTP (servidor propio o de cualquier proveedor), Postmark, SendGrid,
Mailgun y Brevo. Se cambia con `pnpm starter mail use <proveedor>` y se prueba con
`pnpm starter mail test <correo>`. Variables, ejemplos y estado de verificación en
[mail.md](mail.md). El transporte `log` es solo para desarrollo y se rechaza con
`NODE_ENV=production`.

`pnpm starter doctor` y `/admin/diagnostics` revisan las credenciales del proveedor. Si los códigos
no llegan, revisa [troubleshooting.md](troubleshooting.md#no-llega-el-código-otp).

## Sesiones

`/admin/profile` muestra las sesiones activas de la persona y permite cerrar las demás. Un
administrador con `users.disable` puede revocar las sesiones de otra persona. Cuando una sesión
expira o se revoca, el panel lleva a `/session-expired`.
