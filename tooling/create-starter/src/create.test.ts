import { describe, expect, it } from 'vitest';
import { renderEnv } from './commands/create.js';

describe('create: .env rendering', () => {
  it('fills known keys in place, quotes values with spaces and appends missing keys', () => {
    const out = renderEnv('# comment\nAPP_NAME="Starter Kit"\nBETTER_AUTH_SECRET=change-me\nOWNER_EMAIL=\n', { APP_NAME: 'Mesa de Ayuda', BETTER_AUTH_SECRET: 'abc123', OWNER_EMAIL: 'a@b.cl', EXTRA: 'x' });
    expect(out).toBe('# comment\nAPP_NAME="Mesa de Ayuda"\nBETTER_AUTH_SECRET=abc123\nOWNER_EMAIL=a@b.cl\n\nEXTRA=x');
  });
});
