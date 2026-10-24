import { z } from 'zod';

/**
 * Exportable project configuration (starter.config.json). It never contains secrets,
 * connection strings or credentials: only references such as `connectionRef: "primary-ai"`.
 */
const ref = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-_.]{0,62}$/i, 'references must be short identifiers, never secrets or URLs');

const forbiddenSecretPattern = /(sk-[a-z0-9]{8,}|postgres(ql)?:\/\/|mysql:\/\/|-----BEGIN|AKIA[0-9A-Z]{12,}|api[_-]?key\s*[:=])/i;

export const starterConfigSchema = z
  .object({
    $schema: z.string().optional(),
    schemaVersion: z.literal(1),
    project: z.object({
      name: z.string().min(1).max(80),
      slug: z
        .string()
        .regex(/^[a-z0-9][a-z0-9-]{0,62}$/)
        .optional(),
      locale: z.string().default('es-CL'),
      timezone: z.string().default('America/Santiago'),
      ownerEmail: z.email().optional(),
    }),
    features: z
      .object({
        organizations: z.boolean().default(false),
        ai: z.boolean().default(true),
        rag: z.boolean().default(false),
      })
      .default({ organizations: false, ai: true, rag: false }),
    auth: z
      .object({
        method: z.literal('email-otp').default('email-otp'),
        registration: z.enum(['open', 'invite-only', 'disabled']).default('invite-only'),
      })
      .default({ method: 'email-otp', registration: 'invite-only' }),
    database: z
      .object({
        mode: z.enum(['docker', 'external']).default('docker'),
      })
      .default({ mode: 'docker' }),
    mail: z
      .object({
        transport: z.enum(['smtp', 'resend', 'log']).default('smtp'),
        from: z.string().optional(),
      })
      .default({ transport: 'smtp' }),
    ai: z
      .object({
        connectionRef: ref.nullable().default(null),
        agent: z
          .object({
            name: z.string().min(1).max(60).default('Asistente'),
            systemPrompt: z.string().max(20_000).default('Ayuda al usuario con las funciones autorizadas de esta aplicación.'),
            modelRef: z.string().nullable().default(null),
            maxOutputTokens: z.number().int().min(16).max(200_000).default(1200),
            media: z
              .object({ images: z.boolean().default(false), documents: z.boolean().default(false) })
              .default({ images: false, documents: false }),
            microphone: z
              .object({
                enabled: z.boolean().default(false),
                connectionRef: ref.nullable().default(null),
                modelRef: z.string().nullable().default(null),
                maxSeconds: z.number().int().min(5).max(600).default(60),
                autoSend: z.boolean().default(false),
              })
              .default({ enabled: false, connectionRef: null, modelRef: null, maxSeconds: 60, autoSend: false }),
          })
          .prefault({}),
        usage: z
          .object({ record: z.literal(true).default(true), dashboard: z.boolean().default(true) })
          .default({ record: true, dashboard: true }),
      })
      .prefault({}),
    rag: z
      .object({
        mode: z.enum(['disabled', 'internal', 'postgres', 'api']).default('disabled'),
        location: z.enum(['same-database', 'same-server', 'other-server']).optional(),
        connectionRef: ref.nullable().default(null),
        embeddingProfileRef: ref.nullable().default(null),
        retrieval: z
          .object({
            strategy: z.enum(['vector', 'text', 'hybrid']).default('hybrid'),
            topK: z.number().int().min(1).max(50).default(6),
          })
          .default({ strategy: 'hybrid', topK: 6 }),
        indexing: z
          .object({
            automatic: z.boolean().default(false),
            concurrency: z.number().int().min(1).max(16).default(2),
          })
          .default({ automatic: false, concurrency: 2 }),
      })
      .prefault({}),
  })
  .superRefine((cfg, ctx) => {
    const serialized = JSON.stringify(cfg);
    if (forbiddenSecretPattern.test(serialized)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Configuration appears to contain a secret or connection string; use references instead',
        path: [],
      });
    }
    if (!cfg.features.rag && cfg.rag.mode !== 'disabled') {
      ctx.addIssue({ code: 'custom', message: 'rag.mode must be "disabled" when features.rag is false', path: ['rag', 'mode'] });
    }
    if (cfg.rag.mode !== 'disabled') {
      if ((cfg.rag.mode === 'postgres' || cfg.rag.mode === 'api') && !cfg.rag.connectionRef) {
        ctx.addIssue({ code: 'custom', message: 'rag.connectionRef is required for external RAG modes', path: ['rag', 'connectionRef'] });
      }
      if (cfg.rag.mode !== 'api' && !cfg.rag.embeddingProfileRef) {
        ctx.addIssue({
          code: 'custom',
          message: 'rag.embeddingProfileRef is required to activate RAG with PostgreSQL',
          path: ['rag', 'embeddingProfileRef'],
        });
      }
    }
    if (cfg.ai.agent.microphone.enabled && (!cfg.ai.agent.microphone.connectionRef || !cfg.ai.agent.microphone.modelRef)) {
      ctx.addIssue({
        code: 'custom',
        message: 'microphone requires a transcription connectionRef and modelRef',
        path: ['ai', 'agent', 'microphone'],
      });
    }
    if (!cfg.features.ai && cfg.ai.connectionRef) {
      ctx.addIssue({ code: 'custom', message: 'ai.connectionRef set while features.ai is false', path: ['ai', 'connectionRef'] });
    }
  });

export type StarterConfig = z.infer<typeof starterConfigSchema>;
export type StarterConfigInput = z.input<typeof starterConfigSchema>;

export function validateStarterConfig(input: unknown):
  | { ok: true; config: StarterConfig }
  | { ok: false; errors: { path: string; message: string }[] } {
  const result = starterConfigSchema.safeParse(input);
  if (result.success) return { ok: true, config: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => ({ path: i.path.join('.') || '(root)', message: i.message })),
  };
}

/** JSON Schema for editors and CI validation. */
export function starterConfigJsonSchema(): unknown {
  return z.toJSONSchema(starterConfigSchema, { io: 'input', unrepresentable: 'any' });
}
