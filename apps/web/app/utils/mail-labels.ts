/** Display data for the mail screens (labels, provider help, SMTP presets). */
export const MAIL_PROVIDERS: Record<string, { name: string; description: string; secretLabel: string | null; secretPlaceholder?: string; help: string; url?: string }> = {
  resend: { name: 'Resend', description: 'API de correo; recomendado', secretLabel: 'API key', secretPlaceholder: 're_…', help: 'En resend.com → API Keys. Verifica tu dominio en Domains para usar tu remitente.', url: 'https://resend.com/api-keys' },
  smtp: { name: 'SMTP', description: 'Servidor propio, Gmail, Microsoft 365, Amazon SES…', secretLabel: 'Contraseña', help: 'Puerto 587 usa STARTTLS; 465 cifra desde el inicio.' },
  postmark: { name: 'Postmark', description: 'Correo transaccional', secretLabel: 'Server token', help: 'En Postmark → Server → API Tokens.', url: 'https://account.postmarkapp.com/servers' },
  sendgrid: { name: 'SendGrid', description: 'Twilio SendGrid', secretLabel: 'API key', secretPlaceholder: 'SG.…', help: 'En Settings → API Keys, con permiso Mail Send.', url: 'https://app.sendgrid.com/settings/api_keys' },
  mailgun: { name: 'Mailgun', description: 'API de Mailgun (EE. UU. o UE)', secretLabel: 'API key', help: 'En Sending → Domains (dominio) y API Keys.', url: 'https://app.mailgun.com' },
  brevo: { name: 'Brevo', description: 'Ex Sendinblue', secretLabel: 'API key', secretPlaceholder: 'xkeysib-…', help: 'En SMTP & API → API Keys.', url: 'https://app.brevo.com/settings/keys/api' },
  log: { name: 'Solo registro', description: 'Desarrollo: no envía, escribe en el log', secretLabel: null, help: 'Se rechaza en producción. Útil para probar sin enviar correos.' },
};

export const SMTP_PRESETS: { label: string; host: string; port: number; secure: boolean; user?: string; hint?: string }[] = [
  { label: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 587, secure: false, hint: 'Usa el correo completo y una contraseña de aplicación (requiere verificación en dos pasos).' },
  { label: 'Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false, hint: 'Requiere SMTP AUTH habilitado en el buzón.' },
  { label: 'Amazon SES (us-east-1)', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, hint: 'Usa las credenciales SMTP de SES (no las claves IAM); cambia la región si corresponde.' },
  { label: 'Resend por SMTP', host: 'smtp.resend.com', port: 465, secure: true, user: 'resend', hint: 'Contraseña: tu API key.' },
  { label: 'Postmark por SMTP', host: 'smtp.postmarkapp.com', port: 587, secure: false, hint: 'Usuario y contraseña: el Server API token.' },
  { label: 'SendGrid por SMTP', host: 'smtp.sendgrid.net', port: 587, secure: false, user: 'apikey', hint: 'Contraseña: tu API key.' },
  { label: 'Mailgun por SMTP', host: 'smtp.mailgun.org', port: 587, secure: false, hint: 'Credenciales SMTP del dominio (UE: smtp.eu.mailgun.org).' },
  { label: 'Brevo por SMTP', host: 'smtp-relay.brevo.com', port: 587, secure: false, hint: 'Tu login y clave SMTP de Brevo.' },
  { label: 'Mailpit (desarrollo)', host: 'localhost', port: 1025, secure: false, hint: 'Captura los correos sin enviarlos.' },
];

export const DELIVERY_CATEGORIES: Record<string, string> = {
  otp: 'Código de acceso',
  invitation: 'Invitación',
  'budget-alert': 'Alerta de presupuesto',
  automation: 'Automatización',
  test: 'Prueba',
};

export const CRON_PRESETS: { label: string; cron: string }[] = [
  { label: 'Todos los días a las 12:00 UTC (09:00 en Chile)', cron: '0 12 * * *' },
  { label: 'De lunes a viernes a las 12:00 UTC', cron: '0 12 * * 1-5' },
  { label: 'Cada lunes a las 12:00 UTC', cron: '0 12 * * 1' },
  { label: 'El día 1 de cada mes a las 12:00 UTC', cron: '0 12 1 * *' },
  { label: 'Cada hora', cron: '0 * * * *' },
];
