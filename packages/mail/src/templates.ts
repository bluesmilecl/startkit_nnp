export interface Branding {
  appName: string;
  primaryColor?: string;
  appUrl: string;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function layout(b: Branding, title: string, body: string): string {
  const color = b.primaryColor ?? '#2563eb';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escape(title)}</title></head>
<body style="margin:0;background:#f6f7f9;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#fff;border-radius:12px;border:1px solid #e5e7eb">
<tr><td style="padding:24px 28px;border-bottom:3px solid ${color};font-weight:600;font-size:18px">${escape(b.appName)}</td></tr>
<tr><td style="padding:28px">${body}</td></tr>
<tr><td style="padding:16px 28px;color:#6b7280;font-size:12px">Si no solicitaste este correo, puedes ignorarlo.</td></tr>
</table></td></tr></table></body></html>`;
}

export function otpEmail(b: Branding, code: string, minutes: number) {
  const subject = `${code} es tu código de acceso a ${b.appName}`;
  const html = layout(
    b,
    subject,
    `<p style="margin:0 0 16px">Usa este código para ingresar:</p>
<p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:0 0 16px;font-family:ui-monospace,monospace">${escape(code)}</p>
<p style="margin:0;color:#6b7280">Vence en ${minutes} minutos y solo puede usarse una vez.</p>`,
  );
  const text = `Tu código de acceso a ${b.appName}: ${code}\nVence en ${minutes} minutos y solo puede usarse una vez.`;
  return { subject, html, text };
}

export function invitationEmail(b: Branding, inviterName: string | null, roleName: string | null, email: string) {
  const url = `${b.appUrl.replace(/\/$/, '')}/login?email=${encodeURIComponent(email)}`;
  const subject = `Te invitaron a ${b.appName}`;
  const who = inviterName ? `${escape(inviterName)} te invitó` : 'Fuiste invitado';
  const html = layout(
    b,
    subject,
    `<p style="margin:0 0 16px">${who} a ${escape(b.appName)}${roleName ? ` con el rol <strong>${escape(roleName)}</strong>` : ''}.</p>
<p style="margin:0 0 24px">Ingresa con tu correo; recibirás un código de acceso.</p>
<p><a href="${escape(url)}" style="background:${b.primaryColor ?? '#2563eb'};color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">Ingresar</a></p>`,
  );
  const text = `${inviterName ? `${inviterName} te invitó` : 'Fuiste invitado'} a ${b.appName}${roleName ? ` con el rol ${roleName}` : ''}.\nIngresa en: ${url}`;
  return { subject, html, text };
}

export function budgetAlertEmail(b: Branding, budgetName: string, threshold: number, spent: string, limit: string) {
  const subject = `Presupuesto IA "${budgetName}" alcanzó ${threshold}%`;
  const html = layout(
    b,
    subject,
    `<p style="margin:0 0 12px">El presupuesto <strong>${escape(budgetName)}</strong> alcanzó el ${threshold}% de su límite.</p>
<p style="margin:0">Consumo: <strong>USD ${escape(spent)}</strong> de USD ${escape(limit)}.</p>
<p style="margin:16px 0 0"><a href="${escape(b.appUrl)}/admin/ai/budgets">Ver presupuestos</a></p>`,
  );
  const text = `El presupuesto ${budgetName} alcanzó el ${threshold}% (USD ${spent} de USD ${limit}).`;
  return { subject, html, text };
}
