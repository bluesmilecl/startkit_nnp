import type { AppSettings, UpdateSettingsInput } from '@starter/contracts';
import { BrandingSettings, LocaleSettings, AuthSettings, RetentionSettings } from '@starter/contracts';
import { eq, and, isNull, settings, type Database, type DbOrTx } from '@starter/db';
import type { z } from 'zod';
import { assertCan, type AccessDeps, type Actor } from './actor.js';
import { recordAudit } from './audit.js';

type Branding = z.infer<typeof BrandingSettings>;
type Locale = z.infer<typeof LocaleSettings>;
type Auth = z.infer<typeof AuthSettings>;
type Retention = z.infer<typeof RetentionSettings>;

export class SettingsService {
  constructor(private readonly deps: AccessDeps) {}

  private defaults() {
    const env = this.deps.env;
    return {
      branding: { appName: env.APP_NAME, logoUrl: null, primaryColor: '#2563eb', supportEmail: null } satisfies Branding,
      locale: { locale: 'es-CL', timezone: 'America/Santiago', currencyDisplay: 'USD' } satisfies Locale,
      auth: { registration: env.REGISTRATION_MODE, sessionExpiresDays: env.SESSION_EXPIRES_DAYS } satisfies Auth,
      retention: {
        conversationsDays: null,
        retrievalQueriesDays: 90,
        audioKeepAfterTranscription: false,
        auditDays: null,
      } satisfies Retention,
    };
  }

  async getRaw<T>(key: string, db: DbOrTx = this.deps.db): Promise<T | undefined> {
    const [row] = await db
      .select({ value: settings.value })
      .from(settings)
      .where(and(eq(settings.key, key), isNull(settings.organizationId)))
      .limit(1);
    return row?.value as T | undefined;
  }

  async setRaw(key: string, value: unknown, updatedBy: string | null, db: DbOrTx = this.deps.db): Promise<void> {
    await db
      .insert(settings)
      .values({ key, value, updatedBy, organizationId: null })
      .onConflictDoUpdate({ target: [settings.organizationId, settings.key], set: { value, updatedBy, updatedAt: new Date() } });
  }

  async branding(): Promise<Branding> {
    return { ...this.defaults().branding, ...((await this.getRaw<Partial<Branding>>('branding')) ?? {}) };
  }

  async authSettings(): Promise<Auth> {
    return { ...this.defaults().auth, ...((await this.getRaw<Partial<Auth>>('auth')) ?? {}) };
  }

  async retention(): Promise<Retention> {
    return { ...this.defaults().retention, ...((await this.getRaw<Partial<Retention>>('retention')) ?? {}) };
  }

  async getAll(): Promise<AppSettings> {
    const d = this.defaults();
    const [branding, locale, auth, retention, onboarding] = await Promise.all([
      this.getRaw<Partial<Branding>>('branding'),
      this.getRaw<Partial<Locale>>('locale'),
      this.getRaw<Partial<Auth>>('auth'),
      this.getRaw<Partial<Retention>>('retention'),
      this.getRaw<{ completedAt: string }>('onboarding'),
    ]);
    const env = this.deps.env;
    return {
      branding: { ...d.branding, ...(branding ?? {}) },
      locale: { ...d.locale, ...(locale ?? {}) },
      auth: { ...d.auth, ...(auth ?? {}) },
      retention: { ...d.retention, ...(retention ?? {}) },
      mail: { transport: env.MAIL_TRANSPORT, from: env.MAIL_FROM, configured: env.MAIL_TRANSPORT !== 'log' },
      onboardingCompletedAt: onboarding?.completedAt ?? null,
    };
  }

  async get(actor: Actor): Promise<AppSettings> {
    assertCan(actor, 'settings.read');
    return this.getAll();
  }

  async update(actor: Actor, input: UpdateSettingsInput): Promise<AppSettings> {
    assertCan(actor, 'settings.update');
    const before = await this.getAll();
    await this.deps.db.transaction(async (tx) => {
      for (const key of ['branding', 'locale', 'auth', 'retention'] as const) {
        const patch = input[key];
        if (!patch) continue;
        const merged = { ...before[key], ...patch };
        await this.setRaw(key, merged, actor.userId, tx);
      }
      const after = await this.getAll();
      await recordAudit(tx, actor, {
        action: 'settings.update',
        resourceType: 'settings',
        resourceId: 'installation',
        outcome: 'success',
        before: pick(before, Object.keys(input)),
        after: pick(after, Object.keys(input)),
        organizationId: null,
      });
    });
    return this.getAll();
  }

  async completeOnboarding(actor: Actor, db: Database = this.deps.db): Promise<void> {
    assertCan(actor, 'settings.update');
    await this.setRaw('onboarding', { completedAt: new Date().toISOString(), by: actor.userId }, actor.userId, db);
    await recordAudit(db, actor, { action: 'onboarding.complete', resourceType: 'settings', resourceId: 'onboarding', outcome: 'success' });
  }
}

function pick<T extends object>(obj: T, keys: string[]): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k))) as Partial<T>;
}
