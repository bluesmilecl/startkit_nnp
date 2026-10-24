import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const color = stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (color ? `\u001b[${code}m${s}\u001b[0m` : s);
export const c = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), cyan: paint('36') };

export type Level = 'ok' | 'warn' | 'fail' | 'info';
const ICON: Record<Level, string> = { ok: c.green('✔'), warn: c.yellow('⚠'), fail: c.red('✖'), info: c.cyan('•') };

export function line(level: Level, label: string, detail = ''): void {
  console.log(`  ${ICON[level]} ${label}${detail ? c.dim(` · ${detail}`) : ''}`);
}
export function title(text: string): void {
  console.log(`\n${c.bold(text)}`);
}

export const interactive = () => stdin.isTTY && stdout.isTTY && !process.env.CI;

export async function ask(question: string, fallback = ''): Promise<string> {
  if (!interactive()) return fallback;
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = (await rl.question(`${c.cyan('?')} ${question}${fallback ? c.dim(` (${fallback})`) : ''}: `)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

export async function confirm(question: string, fallback = false): Promise<boolean> {
  if (!interactive()) return fallback;
  const answer = (await ask(`${question} [${fallback ? 'S/n' : 's/N'}]`)).toLowerCase();
  return answer ? ['s', 'si', 'sí', 'y', 'yes'].includes(answer) : fallback;
}

export async function choose<T extends string>(question: string, options: readonly T[], fallback: T): Promise<T> {
  if (!interactive()) return fallback;
  const answer = await ask(`${question} [${options.join('/')}]`, fallback);
  return (options as readonly string[]).includes(answer) ? (answer as T) : fallback;
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode = 1,
  ) {
    super(message);
  }
}
