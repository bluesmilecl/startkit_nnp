import { describe, expect, it } from 'vitest';
import { htmlToText, MailAutomationInput, MailProviderInput, renderMailTemplate, sampleMailData, templateVariables } from './mail.js';

describe('mail template renderer', () => {
  it('replaces dot paths, escapes values in HTML (never raw) and keeps the subject plain', () => {
    const r = renderMailTemplate(
      { subject: 'Hola {{recipient.name}} <{{appName}}>', html: '<p>{{recipient.name}} · {{note}}</p>' },
      { appName: 'Mesa', recipient: { name: 'Ana & Luis' }, note: '<script>alert(1)</script>' },
    );
    expect(r.subject).toBe('Hola Ana & Luis <Mesa>');
    expect(r.html).toBe('<p>Ana &amp; Luis · &lt;script&gt;alert(1)&lt;/script&gt;</p>');
    expect(r.missing).toEqual([]);
  });

  it('sections show content only with (or, inverted, without) a value; unknown variables are reported', () => {
    const tpl = { subject: 's', html: '{{#inviter}}{{inviter}} te invitó{{/inviter}}{{^inviter}}Te invitaron{{/inviter}} {{missing}}' };
    expect(renderMailTemplate(tpl, { inviter: 'Camila' }).html).toBe('Camila te invitó ');
    const r = renderMailTemplate(tpl, { inviter: '' });
    expect(r.html).toBe('Te invitaron ');
    expect(r.missing).toEqual(['missing']);
  });

  it('derives plain text from HTML when the template has none', () => {
    const r = renderMailTemplate({ subject: 's', html: '<head><style>p{}</style></head><h1>Hola</h1><p>Entra en <a href="https://app.cl">la app</a>.</p><p>Fin&nbsp;&amp;&nbsp;gracias</p>' }, {});
    expect(r.text).toBe('Hola\nEntra en la app (https://app.cl).\nFin & gracias');
    expect(htmlToText('<a href="https://x.cl">https://x.cl</a>')).toBe('https://x.cl');
  });

  it('lists the variables a template uses and builds nested sample data', () => {
    expect(templateVariables('{{a}} {{#b.c}}x{{/b.c}}', null, '{{ d }}')).toEqual(['a', 'b.c', 'd']);
    const data = sampleMailData([{ name: 'recipient.name', description: '', sample: 'Ana', required: false }], { appName: 'Mi App' });
    expect(data).toMatchObject({ appName: 'Mi App', recipient: { name: 'Ana' } });
  });
});

describe('mail contracts', () => {
  it('provider input requires what each transport needs', () => {
    expect(MailProviderInput.safeParse({ transport: 'smtp', from: 'App <a@b.cl>' }).success).toBe(false);
    expect(MailProviderInput.safeParse({ transport: 'smtp', from: 'App <a@b.cl>', smtpHost: 'smtp.b.cl' }).success).toBe(true);
    expect(MailProviderInput.safeParse({ transport: 'mailgun', from: 'a@b.cl' }).success).toBe(false);
    expect(MailProviderInput.safeParse({ transport: 'resend', from: 'no es correo' }).success).toBe(false);
  });

  it('automations: the recipient must make sense for the trigger', () => {
    const base = { name: 'Aviso', templateId: '00000000-0000-4000-8000-000000000001' };
    expect(MailAutomationInput.safeParse({ ...base, trigger: 'users.register', recipientKind: 'subject' }).success).toBe(true);
    expect(MailAutomationInput.safeParse({ ...base, trigger: 'projects.create', recipientKind: 'subject' }).success).toBe(false);
    expect(MailAutomationInput.safeParse({ ...base, trigger: 'schedule', recipientKind: 'role', recipientRoleKey: 'admin' }).success).toBe(false);
    expect(MailAutomationInput.safeParse({ ...base, trigger: 'schedule', cron: '0 12 * * 1', recipientKind: 'actor' }).success).toBe(false);
    expect(MailAutomationInput.safeParse({ ...base, trigger: 'schedule', cron: '0 12 * * 1', recipientKind: 'emails', recipientEmails: ['a@b.cl'] }).success).toBe(true);
  });
});
