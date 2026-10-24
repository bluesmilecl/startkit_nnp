import { BASE_MAIL_VARIABLES, renderMailTemplate, sampleMailData, templateVariables } from '@starter/contracts';
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAIL_TEMPLATES } from './defaults.js';

describe('default mail templates', () => {
  it.each(DEFAULT_MAIL_TEMPLATES.map((t) => [t.key, t] as const))('%s renders completely with its sample values', (_key, t) => {
    const used = templateVariables(t.subject, t.html, t.text);
    const known = new Set([...BASE_MAIL_VARIABLES, ...t.variables].map((v) => v.name));
    expect(used.filter((n) => !known.has(n))).toEqual([]);
    for (const v of t.variables.filter((x) => x.required)) expect(used).toContain(v.name);
    const r = renderMailTemplate(t, sampleMailData(t.variables));
    expect(r.missing).toEqual([]);
    expect(r.html).not.toMatch(/\{\{|\}\}/);
    expect(r.text.length).toBeGreaterThan(20);
  });

  it('the access code e-mail shows the code in subject, HTML and text', () => {
    const otp = DEFAULT_MAIL_TEMPLATES.find((t) => t.key === 'auth.otp')!;
    const r = renderMailTemplate(otp, sampleMailData(otp.variables, { code: '123456', appName: 'Mesa' }));
    expect(r.subject).toBe('123456 es tu código de acceso a Mesa');
    expect(r.html).toContain('123456');
    expect(r.text).toContain('123456');
  });
});
