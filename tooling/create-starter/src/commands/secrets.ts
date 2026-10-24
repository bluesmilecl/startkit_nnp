import { projectContext } from '../lib/project.js';
import { CliError, confirm, interactive, line, title } from '../lib/ui.js';

/**
 * `starter secrets reencrypt`: after rotating APP_ENCRYPTION_KEY (old key moved to
 * APP_ENCRYPTION_PREVIOUS_KEYS), re-encrypts every stored credential with the current key so the
 * previous key can be retired. Values are decrypted and re-encrypted in memory only.
 */
export async function secretsReencrypt(opts: { yes?: boolean; dryRun?: boolean }): Promise<number> {
  const ctx = await projectContext();
  try {
    const { providerConnections, ragConnections, eq, isNotNull } = await import('@starter/db');
    const box = ctx.deps.secrets;
    const tables = [
      { name: 'Conexiones de IA', table: providerConnections },
      { name: 'Conexiones de conocimiento', table: ragConnections },
    ] as const;
    const pending: { name: string; table: (typeof tables)[number]['table']; id: string; value: string }[] = [];
    let unreadable = 0;
    for (const t of tables) {
      const rows = await ctx.handle.db.select({ id: t.table.id, c: t.table.credentialCiphertext }).from(t.table).where(isNotNull(t.table.credentialCiphertext));
      for (const r of rows) {
        if (!r.c || !box.needsRotation(r.c)) continue;
        try {
          pending.push({ name: t.name, table: t.table, id: r.id, value: box.decrypt(r.c) });
        } catch {
          unreadable++;
        }
      }
    }
    title('Credenciales cifradas con claves anteriores');
    line(pending.length ? 'warn' : 'ok', `${pending.length} por re-cifrar`);
    if (unreadable) line('fail', `${unreadable} no se pueden descifrar`, 'falta la clave anterior en APP_ENCRYPTION_PREVIOUS_KEYS');
    if (!pending.length || opts.dryRun) return unreadable ? 1 : 0;
    if (!opts.yes) {
      if (!interactive()) throw new CliError('Confirma con --yes');
      if (!(await confirm(`¿Re-cifrar ${pending.length} credencial(es) con la clave actual?`))) return 0;
    }
    await ctx.handle.db.transaction(async (tx) => {
      for (const p of pending) await tx.update(p.table).set({ credentialCiphertext: box.encrypt(p.value) }).where(eq(p.table.id, p.id));
    });
    line('ok', `${pending.length} credencial(es) re-cifradas`, 'ya puedes retirar la clave anterior de APP_ENCRYPTION_PREVIOUS_KEYS');
    return unreadable ? 1 : 0;
  } finally {
    await ctx.close();
  }
}
