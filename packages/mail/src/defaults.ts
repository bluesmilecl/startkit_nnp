import { AUTOMATION_VARIABLES, type MailTemplateVariable } from '@starter/contracts';

export interface DefaultMailTemplate {
  key: string;
  name: string;
  description: string;
  /** Where the platform uses it (shown in the panel). */
  usage: string | null;
  subject: string;
  html: string;
  text: string;
  variables: MailTemplateVariable[];
}

/** Responsive, inline-styled layout (tables: what e-mail clients render consistently). */
function layout(body: string, footer = 'Si no esperabas este correo, puedes ignorarlo.'): string {
  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>{{appName}}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7">
<tr><td align="center" style="padding:32px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e5e7eb;overflow:hidden">
<tr><td style="padding:22px 28px;border-top:4px solid {{primaryColor}}">
{{#logoUrl}}<img src="{{logoUrl}}" alt="{{appName}}" height="32" style="display:block;height:32px;border:0">{{/logoUrl}}{{^logoUrl}}<span style="font-size:18px;font-weight:700">{{appName}}</span>{{/logoUrl}}
</td></tr>
<tr><td style="padding:8px 28px 28px;font-size:15px;line-height:1.6">
${body}
</td></tr>
<tr><td style="padding:18px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5">
${footer}{{#supportEmail}}<br>¿Dudas? Escríbenos a <a href="mailto:{{supportEmail}}" style="color:#6b7280">{{supportEmail}}</a>.{{/supportEmail}}<br>© {{year}} {{appName}}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0"><tr><td style="background:{{primaryColor}};border-radius:8px"><a href="${href}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;text-decoration:none">${label}</a></td></tr></table>`;

export const DEFAULT_MAIL_TEMPLATES: DefaultMailTemplate[] = [
  {
    key: 'auth.otp',
    name: 'Código de acceso',
    description: 'Código de un solo uso para ingresar.',
    usage: 'Se envía al pedir un código en la pantalla de ingreso',
    subject: '{{code}} es tu código de acceso a {{appName}}',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">Tu código de acceso</h1>
<p style="margin:0 0 16px">Usa este código para ingresar a {{appName}}:</p>
<p style="margin:0 0 16px;font-size:34px;letter-spacing:10px;font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace">{{code}}</p>
<p style="margin:0;color:#6b7280">Vence en {{minutes}} minutos y solo puede usarse una vez. Nunca te lo pediremos por teléfono ni por chat.</p>`,
      'Si no intentaste ingresar, puedes ignorar este correo: nadie puede entrar sin el código.',
    ),
    text: 'Tu código de acceso a {{appName}}: {{code}}\nVence en {{minutes}} minutos y solo puede usarse una vez.',
    variables: [
      { name: 'code', description: 'Código de acceso', sample: '482913', required: true },
      { name: 'minutes', description: 'Minutos de vigencia', sample: '5', required: false },
    ],
  },
  {
    key: 'users.invitation',
    name: 'Invitación',
    description: 'Invita a una persona a ingresar a la plataforma.',
    usage: 'Se envía al invitar a una persona desde Usuarios o Invitaciones',
    subject: 'Te invitaron a {{appName}}',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">Tienes una invitación</h1>
<p style="margin:0 0 12px">{{#inviterName}}<strong>{{inviterName}}</strong> te invitó{{/inviterName}}{{^inviterName}}Te invitaron{{/inviterName}} a {{appName}}{{#roleName}} con el rol <strong>{{roleName}}</strong>{{/roleName}}.</p>
<p style="margin:0">Ingresa con tu correo <strong>{{email}}</strong>; te enviaremos un código de acceso.</p>
${button('{{loginUrl}}', 'Ingresar')}
<p style="margin:0;color:#6b7280;font-size:13px">Si el botón no funciona, copia este enlace: {{loginUrl}}</p>`,
    ),
    text: '{{#inviterName}}{{inviterName}} te invitó{{/inviterName}}{{^inviterName}}Te invitaron{{/inviterName}} a {{appName}}{{#roleName}} con el rol {{roleName}}{{/roleName}}.\nIngresa con {{email}} en: {{loginUrl}}',
    variables: [
      { name: 'inviterName', description: 'Quién invita', sample: 'Camila Soto', required: false },
      { name: 'roleName', description: 'Rol asignado', sample: 'Editor', required: false },
      { name: 'email', description: 'Correo invitado', sample: 'ana@empresa.cl', required: false },
      { name: 'loginUrl', description: 'Enlace para ingresar', sample: 'https://app.empresa.cl/login?email=ana%40empresa.cl', required: true },
    ],
  },
  {
    key: 'auth.password_reset',
    name: 'Recuperar contraseña',
    description: 'Enlace para crear una nueva contraseña. La plataforma ingresa con códigos; úsala si tu proyecto agrega contraseñas.',
    usage: null,
    subject: 'Restablece tu contraseña de {{appName}}',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">Restablece tu contraseña</h1>
<p style="margin:0 0 12px">Hola{{#name}} {{name}}{{/name}}, recibimos una solicitud para cambiar la contraseña de tu cuenta en {{appName}}.</p>
${button('{{resetUrl}}', 'Crear nueva contraseña')}
<p style="margin:0;color:#6b7280">El enlace vence en {{minutes}} minutos. Si no lo pediste, ignora este correo: tu contraseña no cambia.</p>`,
    ),
    text: 'Hola{{#name}} {{name}}{{/name}}, para crear una nueva contraseña de {{appName}} abre: {{resetUrl}}\nVence en {{minutes}} minutos.',
    variables: [
      { name: 'name', description: 'Nombre de la persona', sample: 'Ana Pérez', required: false },
      { name: 'resetUrl', description: 'Enlace para restablecer', sample: 'https://app.empresa.cl/reset?token=…', required: true },
      { name: 'minutes', description: 'Minutos de vigencia', sample: '30', required: false },
    ],
  },
  {
    key: 'account.confirmation',
    name: 'Confirmación de registro',
    description: 'Bienvenida y confirmación cuando una persona ingresa por primera vez.',
    usage: 'Automatización «Bienvenida al primer ingreso» (actívala en Automatizaciones)',
    subject: 'Tu cuenta en {{appName}} está lista',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">¡Bienvenida, bienvenido!</h1>
<p style="margin:0 0 12px">Hola{{#recipient.name}} {{recipient.name}}{{/recipient.name}}, confirmamos tu registro en {{appName}} con el correo <strong>{{recipient.email}}</strong>.</p>
<p style="margin:0">Desde ahora ingresas siempre con tu correo y un código de un solo uso.</p>
${button('{{appUrl}}/admin', 'Ir a {{appName}}')}`,
    ),
    text: 'Hola{{#recipient.name}} {{recipient.name}}{{/recipient.name}}, confirmamos tu registro en {{appName}} con {{recipient.email}}.\nIngresa en {{appUrl}}',
    variables: AUTOMATION_VARIABLES.filter((v) => v.name.startsWith('recipient.')),
  },
  {
    key: 'ai.budget_alert',
    name: 'Alerta de presupuesto de IA',
    description: 'Aviso cuando un presupuesto de IA alcanza un umbral.',
    usage: 'Se envía a administradores al cruzar un umbral de presupuesto',
    subject: 'Presupuesto IA "{{budgetName}}" alcanzó {{threshold}}%',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">Presupuesto en {{threshold}}%</h1>
<p style="margin:0 0 12px">El presupuesto <strong>{{budgetName}}</strong> alcanzó el {{threshold}}% de su límite.</p>
<p style="margin:0">Consumo: <strong>{{spent}}</strong> de {{limit}}.</p>
${button('{{budgetsUrl}}', 'Ver presupuestos')}`,
      'Recibes este aviso porque administras los presupuestos de IA.',
    ),
    text: 'El presupuesto {{budgetName}} alcanzó el {{threshold}}% ({{spent}} de {{limit}}). Detalle: {{budgetsUrl}}',
    variables: [
      { name: 'budgetName', description: 'Nombre del presupuesto', sample: 'Mensual de la organización', required: true },
      { name: 'threshold', description: 'Umbral alcanzado (%)', sample: '80', required: true },
      { name: 'spent', description: 'Consumo actual', sample: 'US$ 40,00', required: false },
      { name: 'limit', description: 'Límite', sample: 'US$ 50,00', required: false },
      { name: 'budgetsUrl', description: 'Enlace a presupuestos', sample: 'https://app.empresa.cl/admin/ai/budgets', required: false },
    ],
  },
  {
    key: 'automation.notice',
    name: 'Aviso de actividad',
    description: 'Aviso genérico para automatizaciones: qué pasó, quién y cuándo.',
    usage: null,
    subject: '{{event.label}} · {{appName}}',
    html: layout(
      `<h1 style="font-size:20px;margin:16px 0 8px">{{event.label}}</h1>
<p style="margin:0 0 12px">Hola{{#recipient.name}} {{recipient.name}}{{/recipient.name}}, te avisamos de una actividad en {{appName}}{{#resource.name}}: <strong>{{resource.name}}</strong>{{/resource.name}}.</p>
<p style="margin:0;color:#6b7280">{{#actor.name}}Lo hizo {{actor.name}} · {{/actor.name}}{{event.date}}</p>
${button('{{appUrl}}/admin', 'Abrir {{appName}}')}`,
      'Recibes este aviso por una automatización de correo de {{appName}}.',
    ),
    text: '{{event.label}}{{#resource.name}}: {{resource.name}}{{/resource.name}}\n{{#actor.name}}Lo hizo {{actor.name}} · {{/actor.name}}{{event.date}}\n{{appUrl}}/admin',
    variables: AUTOMATION_VARIABLES,
  },
];

export const DEFAULT_TEMPLATE_KEYS = new Set(DEFAULT_MAIL_TEMPLATES.map((t) => t.key));
export const defaultTemplate = (key: string) => DEFAULT_MAIL_TEMPLATES.find((t) => t.key === key);

/** Automations created once on a new installation (disabled until someone turns them on). */
export const DEFAULT_MAIL_AUTOMATIONS = [
  {
    name: 'Bienvenida al primer ingreso',
    description: 'Confirma el registro cuando una persona ingresa por primera vez.',
    trigger: 'users.register',
    templateKey: 'account.confirmation',
    recipientKind: 'subject' as const,
  },
];
