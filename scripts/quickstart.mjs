#!/usr/bin/env node
/**
 * One-command local installation for people and AI agents (no dependencies: runs before
 * `pnpm install`). Idempotent: re-running skips what is done and never overwrites .env secrets.
 *
 *   node scripts/quickstart.mjs --owner tu@empresa.cl
 *   node scripts/quickstart.mjs --new "Mesa de Ayuda" --owner tu@empresa.cl   # clone → your own project
 *   node scripts/quickstart.mjs --owner tu@empresa.cl --test-ai          # chat without API keys (dev)
 *   RESEND_API_KEY=re_… node scripts/quickstart.mjs --owner tu@empresa.cl --mail-from "App <no-reply@tudominio.cl>"
 *   OPENAI_API_KEY=… node scripts/quickstart.mjs --owner tu@empresa.cl --ai openai --chat-model gpt-4.1-mini
 *   node scripts/quickstart.mjs --owner tu@empresa.cl --db external --database-url postgres://…
 *   node scripts/quickstart.mjs --owner tu@empresa.cl --reset-db          # discard a previous local database
 *
 * Steps: prerequisites → pnpm install → build → .env (starter init) → PostgreSQL + Mailpit in
 * Docker → migrations → optional AI provider → doctor. With --new the clone becomes a project of
 * its own: package name, Docker project (own containers and volumes, free ports), the starter as
 * the `starter` git remote and PROJECT.md (context for agents). Ends with a machine-readable line:
 *   QUICKSTART_RESULT=ok web=http://localhost:3000 … next="pnpm dev"
 * Full output of every step goes to quickstart.log.
 */
import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { parseArgs } from 'node:util';

const root = new URL('..', import.meta.url).pathname;
const LOG = `${root}quickstart.log`;
const { values: o } = parseArgs({
  options: {
    owner: { type: 'string' },
    new: { type: 'string' },
    modules: { type: 'string', default: 'ai,rag' },
    db: { type: 'string', default: 'docker' },
    'database-url': { type: 'string' },
    mail: { type: 'string', default: 'auto' },
    'mail-from': { type: 'string' },
    'test-ai': { type: 'boolean', default: false },
    ai: { type: 'string' },
    'chat-model': { type: 'string' },
    start: { type: 'boolean', default: false },
    'reset-db': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' },
  },
});
if (o.help) {
  const lines = readFileSync(new URL(import.meta.url), 'utf8').split('\n');
  console.log(lines.slice(2, lines.indexOf(' */')).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
  process.exit(0);
}

const slugify = (s) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'mi-app';
const newName = o.new?.trim();
if (o.new !== undefined && !newName) {
  console.log('--new requiere el nombre del proyecto, p. ej. --new "Mesa de Ayuda"');
  process.exit(1);
}

// A project created with --new commits its starter.config.json: clones of it keep the name.
let configured = null;
try {
  const p = JSON.parse(readFileSync(`${root}starter.config.json`, 'utf8')).project;
  if (p?.slug && p.slug !== 'starter-kit') configured = p;
} catch {
  // no project configuration yet
}

const tty = process.stdout.isTTY;
const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), cyan: paint('36') };
writeFileSync(LOG, `quickstart ${new Date().toISOString()}\n`);

function fail(message, hint) {
  console.log(`\n${c.red('✖')} ${message}`);
  if (hint) console.log(`  ${c.yellow('→')} ${hint}`);
  console.log(c.dim(`  Detalle completo: ${LOG}`));
  console.log(`\nQUICKSTART_RESULT=error step=${JSON.stringify(message)}`);
  process.exit(1);
}

function sh(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });
  return r.status === 0 ? (r.stdout ?? '').trim() : null;
}

/** Runs a step; output goes to quickstart.log (and to the console when `show`). */
function step(label, cmd, { show = false, hint } = {}) {
  const t0 = Date.now();
  process.stdout.write(`${c.cyan('▶')} ${label}… `);
  appendFileSync(LOG, `\n▶ ${label}: ${cmd}\n`);
  return new Promise((resolve) => {
    const child = spawn(cmd, { cwd: root, shell: true, env: { ...process.env, FORCE_COLOR: '0' } });
    let tail = '';
    const onData = (d) => {
      const s = String(d);
      appendFileSync(LOG, s);
      tail = (tail + s).slice(-4000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', (code) => {
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      if (code !== 0) {
        console.log(c.red(`falló (${secs}s)`));
        console.log(c.dim(tail.split('\n').slice(-25).join('\n')));
        fail(label, hint);
      }
      console.log(`${c.green('ok')} ${c.dim(`(${secs}s)`)}`);
      if (show) console.log(tail.trimEnd().replace(/^/gm, '    '));
      resolve(tail);
    });
  });
}

const portFree = (port) =>
  new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });

const version = (v) => v.replace(/^v/, '').split('.').map(Number);
const gte = (a, b) => a[0] !== b[0] ? a[0] > b[0] : a[1] !== b[1] ? a[1] > b[1] : a[2] >= b[2];

// ── 1. prerequisites ────────────────────────────────────────────────────
console.log(c.bold(newName ? `\n«${newName}» · proyecto nuevo desde el Starter Kit\n` : configured ? `\n«${configured.name}» · instalación local\n` : '\nStarter Kit · instalación local\n'));
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const minNode = (pkg.engines?.node ?? '>=24.11.0').replace(/[^0-9.]/g, '');
if (!gte(version(process.version), version(minNode))) fail(`Node ${process.version} es muy antiguo (se requiere ${minNode} o superior)`, 'instala Node 24 LTS (ver .node-version) y repite');
console.log(`${c.green('✔')} Node ${process.version}`);

const wantedPnpm = pkg.packageManager?.split('@')[1];
let pnpm = sh('pnpm', ['--version']);
if (!pnpm) {
  sh('corepack', ['enable', 'pnpm']);
  pnpm = sh('pnpm', ['--version']);
}
if (!pnpm) fail('pnpm no está disponible', `ejecuta "corepack enable pnpm" (o "npm install -g pnpm@${wantedPnpm}") y repite`);
console.log(`${c.green('✔')} pnpm ${pnpm}${wantedPnpm && pnpm !== wantedPnpm ? c.yellow(` (el proyecto fija ${wantedPnpm}; corepack lo usará)`) : ''}`);

const owner = (o.owner ?? '').trim().toLowerCase();
const hasEnv = existsSync(`${root}.env`);
const envFile = () =>
  Object.fromEntries(
    readFileSync(`${root}.env`, 'utf8')
      .split('\n')
      .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^"|"$/g, '')]),
  );
// Docker Compose project: containers and volumes are named after it (".env" wins, as in compose).
const project = (hasEnv && envFile().COMPOSE_PROJECT_NAME) || (newName ? slugify(newName) : (configured?.slug ?? 'starter'));
if (!hasEnv && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner)) fail('Falta --owner <correo>', 'esa persona recibe el primer código de acceso y queda como propietaria (el primer visitante nunca es administrador)');
if (o.db === 'external' && !o['database-url'] && !hasEnv) fail('Con --db external indica --database-url postgres://usuario:clave@host:5432/base', 'PostgreSQL 18 con la extensión pgvector');

let pgPort;
let mailpitPorts;
if (o.db === 'docker') {
  if (!sh('docker', ['info', '--format', '{{.ServerVersion}}'])) fail('Docker no responde', 'inicia Docker Desktop o el servicio docker; o usa --db external --database-url …');
  const compose = sh('docker', ['compose', 'version', '--short']);
  if (!compose) fail('Docker Compose v2 no está disponible', 'instala el plugin "docker compose"');
  console.log(`${c.green('✔')} Docker Compose ${compose}`);
  // Our own containers (this compose project) may already hold the ports: that is fine.
  const running = sh('docker', ['ps', '--filter', `label=com.docker.compose.project=${project}`, '--format', '{{.Label "com.docker.compose.service"}}'])?.split('\n') ?? [];
  if (!running.includes('postgres') && !hasEnv && !(await portFree(5432))) {
    for (let p = 5433; p < 5450 && !pgPort; p++) if (await portFree(p)) pgPort = p;
    console.log(`${c.yellow('!')} El puerto 5432 está ocupado: PostgreSQL usará ${pgPort}`);
  }
  // New secrets cannot open a database volume created by an earlier installation with the same project name.
  if (!hasEnv && (sh('docker', ['volume', 'ls', '--format', '{{.Name}}'])?.split('\n') ?? []).includes(`${project}_pgdata`)) {
    if (!o['reset-db']) {
      fail(
        `Ya existe una base local de una instalación anterior (volumen Docker ${project}_pgdata) y este clon no tiene su .env`,
        `copia aquí el .env de esa instalación, usa otro nombre con --new "…", o repite con --reset-db para borrar esa base (se pierden sus datos)`,
      );
    }
    const ids = sh('docker', ['ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`])?.split('\n').filter(Boolean) ?? [];
    if (ids.length) sh('docker', ['rm', '-f', ...ids]);
    for (const v of [`${project}_pgdata`, `${project}_ragpgdata`]) sh('docker', ['volume', 'rm', v]);
    running.length = 0;
    console.log(`${c.yellow('!')} Base local anterior eliminada (--reset-db)`);
  }
  if (!running.includes('mailpit')) {
    const env = hasEnv ? envFile() : {};
    const wanted = [Number(env.MAILPIT_PORT) || 8025, Number(env.MAILPIT_SMTP_PORT) || 1025];
    const busy = [];
    for (const p of wanted) if (!(await portFree(p))) busy.push(p);
    if (busy.length && hasEnv) fail(`El puerto ${busy[0]} (Mailpit) está ocupado`, 'libéralo o cambia MAILPIT_PORT / MAILPIT_SMTP_PORT (y SMTP_URL) en .env');
    if (busy.length) {
      // Usually another installation of the starter: give this one its own ports.
      const free = async (from) => {
        for (let p = from; p < from + 40; p++) if (await portFree(p)) return p;
        fail(`No hay puertos libres para Mailpit desde ${from}`, 'libera 8025 y 1025');
      };
      mailpitPorts = [await free(8026), await free(1026)];
      console.log(`${c.yellow('!')} Los puertos de Mailpit (8025/1025) están ocupados: usará ${mailpitPorts.join('/')}`);
    }
  }
}
for (const p of [3000, 3001]) if (!(await portFree(p))) console.log(`${c.yellow('!')} El puerto ${p} está ocupado: "pnpm dev" lo necesita libre`);

// ── 2. install, build, configure, infrastructure, migrate ───────────────
console.log('');
await step('Dependencias (pnpm install)', 'pnpm install --frozen-lockfile', { hint: 'revisa tu conexión a internet o el proxy de npm' });
await step('Compilación TypeScript', 'pnpm build:ts');
const initArgs = [
  owner && `--owner ${owner}`,
  `--modules ${o.modules}`,
  `--db ${o.db}`,
  o['database-url'] && `--database-url '${o['database-url']}'`,
  `--mail ${o.mail}`,
  o['mail-from'] && `--mail-from ${JSON.stringify(o['mail-from'])}`,
  pgPort && `--pg-port ${pgPort}`,
  mailpitPorts && `--mailpit-port ${mailpitPorts[0]} --mailpit-smtp-port ${mailpitPorts[1]}`,
  newName && `--new ${JSON.stringify(newName)}`,
  o['test-ai'] && '--test-ai',
].filter(Boolean);
await step('Configuración (.env con secretos únicos)', `pnpm starter init ${initArgs.join(' ')}`, { show: true });
if (o.db === 'docker') await step('PostgreSQL 18 + pgvector y Mailpit (Docker)', 'pnpm infra:up', { hint: 'mira "docker compose logs" en quickstart.log; ¿puertos ocupados?' });
await step('Migraciones y datos base', 'pnpm db:migrate', { hint: 'revisa DATABASE_URL en .env y que PostgreSQL esté arriba' });

// ── 3. real mail check (providers only; Mailpit needs none) ─────────────
const envNow = envFile;
const mailTransport = envNow().MAIL_TRANSPORT;
if (mailTransport && mailTransport !== 'log' && !(mailTransport === 'smtp' && !envNow().SMTP_HOST && /localhost|127\.0\.0\.1/.test(envNow().SMTP_URL ?? 'localhost'))) {
  await step(`Correo de prueba (${mailTransport}) a ${envNow().OWNER_EMAIL || owner}`, `pnpm starter mail test ${envNow().OWNER_EMAIL || owner}`, {
    show: true,
    hint: 'revisa la clave y el remitente (MAIL_FROM); con onboarding@resend.dev solo llega al correo de tu cuenta de Resend. Corrige con "pnpm starter mail use …" y repite',
  });
}

// ── 4. optional AI provider ─────────────────────────────────────────────
const aiProvider = o['test-ai'] && !o.ai ? 'test' : o.ai;
if (aiProvider) {
  const model = o['chat-model'] ?? (aiProvider === 'test' ? 'test-chat' : undefined);
  await step(`Proveedor de IA (${aiProvider})`, `pnpm starter ai connect --provider ${aiProvider}${model ? ` --chat-model ${model}` : ''}`, {
    show: true,
    hint: aiProvider === 'test' ? undefined : 'define la clave en la variable de entorno del proveedor (p. ej. OPENAI_API_KEY) y repite',
  });
}

// Last, so the diagnosis includes the AI provider.
await step('Diagnóstico (pnpm starter doctor)', 'pnpm starter doctor', { show: true, hint: 'corrige lo marcado con ✖ y repite el comando' });

// ── 5. summary ──────────────────────────────────────────────────────────
const env = envNow();
const web = env.APP_URL || 'http://localhost:3000';
const mailpit = `http://localhost:${env.MAILPIT_PORT || 8025}`;
console.log(`\n${c.green(c.bold('Instalación lista.'))}`);
console.log(`  1. ${c.cyan('pnpm dev')}                         API :${env.API_PORT || 3001}, worker y web`);
console.log(`  2. Abre ${web} e ingresa con ${c.bold(env.OWNER_EMAIL || owner)}`);
const localMail = env.MAIL_TRANSPORT === 'smtp' && !env.SMTP_HOST && /localhost|127\.0\.0\.1/.test(env.SMTP_URL ?? 'localhost');
console.log(`  3. El código de 6 dígitos llega a ${localMail ? `Mailpit: ${mailpit}` : env.MAIL_TRANSPORT === 'log' ? 'los logs de la API' : `tu correo (${env.MAIL_TRANSPORT})`}`);
if (localMail) console.log(`  ${c.dim('Correo real: RESEND_API_KEY=re_… pnpm starter mail use resend --mail-from "App <no-reply@tudominio>"')}`);
if (!aiProvider) console.log(`  4. IA: ${c.cyan('OPENAI_API_KEY=… pnpm starter ai connect --provider openai --chat-model gpt-4.1-mini')} (o /admin/ai/connections)`);
const hasProject = existsSync(`${root}PROJECT.md`);
if (hasProject) {
  console.log(`  ${c.bold('PROJECT.md')}: contexto del proyecto para personas y agentes (CLAUDE.md y GEMINI.md lo importan); complétalo con qué hace tu aplicación.`);
  if (sh('git', ['remote', 'get-url', 'starter']) && !sh('git', ['remote', 'get-url', 'origin'])) console.log(`  ${c.dim('Tu repositorio: git remote add origin <url> && git add -A && git commit -m "Proyecto inicial" && git push -u origin HEAD')}`);
}
console.log(`\nQUICKSTART_RESULT=ok web=${web} mail=${localMail ? `mailpit:${mailpit}` : env.MAIL_TRANSPORT} owner=${env.OWNER_EMAIL || owner} ai=${aiProvider ?? 'none'}${hasProject ? ` project=${env.COMPOSE_PROJECT_NAME || project} context=PROJECT.md` : ''} next="pnpm dev"`);

if (o.start) {
  console.log(c.dim('\nIniciando pnpm dev (Ctrl+C para detener)…\n'));
  spawn('pnpm', ['dev'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' }).on('close', (code) => process.exit(code ?? 0));
}
