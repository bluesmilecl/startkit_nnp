import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { findRoot, loadEnv } from '../lib/project.js';
import { c, CliError, line, title } from '../lib/ui.js';
import { defaultMailFrom, MAIL_ENV, renderEnv, resolveMail } from './create.js';

const EXAMPLES: Record<string, string> = {
  resend: 'export RESEND_API_KEY=re_…',
  smtp: 'export SMTP_HOST=smtp.tudominio.cl SMTP_PORT=587 SMTP_USER=… SMTP_PASSWORD=…',
  postmark: 'export POSTMARK_SERVER_TOKEN=…',
  sendgrid: 'export SENDGRID_API_KEY=SG.…',
  mailgun: 'export MAILGUN_API_KEY=… MAILGUN_DOMAIN=mg.tudominio.cl',
  brevo: 'export BREVO_API_KEY=xkeysib-…',
};

/**
 * `starter mail use <transport> [--mail-from "App <no-reply@dominio>"]`: switches the transport in .env.
 * Keys come from the shell (never from arguments) and stay in .env (600, ignored by git); then the
 * credentials are checked against the provider without sending anything.
 */
export async function mailUse(transportArg: string | undefined, opts: { from?: string; cwd?: string } = {}): Promise<number> {
  if (!transportArg) throw new CliError('Uso: starter mail use <resend|smtp|postmark|sendgrid|mailgun|brevo|log> [--mail-from "App <no-reply@tudominio>"]');
  const transport = resolveMail(transportArg);
  const root = findRoot(opts.cwd);
  const envPath = join(root, '.env');
  if (!existsSync(envPath)) throw new CliError('No existe .env: ejecuta antes "pnpm starter init --owner <correo>" (o el quickstart)');
  const fromShell = Object.fromEntries(MAIL_ENV[transport].filter((k) => process.env[k]).map((k) => [k, process.env[k]!]));
  loadEnv(root);
  const values: Record<string, string> = { MAIL_TRANSPORT: transport, ...fromShell };
  const currentFrom = process.env.MAIL_FROM ?? '';
  if (opts.from) values.MAIL_FROM = opts.from;
  else if (transport === 'resend' && /@localhost>?$/.test(currentFrom)) values.MAIL_FROM = defaultMailFrom(process.env.APP_NAME ?? 'Starter Kit', 'resend');

  title(`Correo: ${transport}`);
  const { parseEnv } = await import('@starter/config');
  let env;
  try {
    env = parseEnv({ ...process.env, ...values });
  } catch (err) {
    const issues = (err as { issues?: { path: string; message: string }[] }).issues ?? [];
    for (const i of issues) line('fail', i.path, i.message);
    if (EXAMPLES[transport]) console.log(`\n  Define las variables en la terminal y repite:\n  ${c.cyan(EXAMPLES[transport]!)}`);
    return 1;
  }
  writeFileSync(envPath, renderEnv(readFileSync(envPath, 'utf8'), values));
  chmodSync(envPath, 0o600); // the mode option only applies when the file is created
  line('ok', '.env actualizado', `MAIL_TRANSPORT=${transport}${Object.keys(fromShell).length ? ` · ${Object.keys(fromShell).join(', ')}` : ''} · remitente ${env.MAIL_FROM}`);
  const { createMailer } = await import('@starter/mail');
  const check = await createMailer(env).verify();
  line(check.ok ? 'ok' : 'warn', check.ok ? 'Credenciales' : 'Credenciales sin confirmar', check.detail ?? '');
  console.log(c.dim(`\n  Prueba un envío real: pnpm starter mail test <correo> · reinicia "pnpm dev" para aplicar el cambio.`));
  return check.ok ? 0 : 1;
}

/** `starter mail test <correo>`: sends one real message with the configured transport. */
export async function mailTest(to: string | undefined, opts: { cwd?: string } = {}): Promise<number> {
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new CliError('Uso: starter mail test <correo>');
  const root = findRoot(opts.cwd);
  if (!loadEnv(root)) throw new CliError('No existe .env');
  const { parseEnv } = await import('@starter/config');
  const env = parseEnv(process.env);
  const { createMailer } = await import('@starter/mail');
  title(`Correo de prueba (${env.MAIL_TRANSPORT})`);
  try {
    const r = await createMailer(env).send({
      to,
      subject: `Prueba de correo · ${env.APP_NAME}`,
      text: `Este es un correo de prueba de ${env.APP_NAME}. Si lo recibiste, los códigos de acceso e invitaciones también llegarán.`,
      html: `<p>Este es un correo de prueba de <strong>${env.APP_NAME.replace(/[<>&]/g, '')}</strong>.</p><p>Si lo recibiste, los códigos de acceso e invitaciones también llegarán.</p>`,
      category: 'test',
    });
    line('ok', `Enviado a ${to}`, `${env.MAIL_FROM}${r.id ? ` · id ${r.id}` : ''}`);
    return 0;
  } catch (err) {
    const e = err as Error & { cause?: unknown };
    line('fail', e.message, e.cause instanceof Error ? e.cause.message.slice(0, 300) : '');
    if (env.MAIL_TRANSPORT === 'resend' && /onboarding@resend\.dev/.test(env.MAIL_FROM)) {
      console.log(c.dim('  Con onboarding@resend.dev solo puedes enviar al correo de tu cuenta de Resend.'));
    }
    return 1;
  }
}
