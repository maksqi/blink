import { z } from 'zod'

/**
 * Environment configuration (infrastructure + secrets). Parsed once, fail-fast, with errors that name the variable.
 * Runtime-tunable behavior belongs in admin settings (shared/schemas/settings.ts), not here.
 * Orchestrator-owned: add variables here and in .env.example together.
 */

const PLACEHOLDER = /^(change-?me|changeme|replace-?me|example|placeholder|secret|password)/i

const secret = (name: string, minLength: number) =>
  z
    .string({ error: `${name} is required` })
    .min(minLength, `must be at least ${minLength} characters`)
    .refine((v) => !PLACEHOLDER.test(v), 'still has a placeholder value — generate one with scripts/init-env.sh')

const bool = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes')

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === '' ? undefined : v.trim()))

const base64Key32 = z
  .string({ error: 'RECORDING_ENCRYPTION_KEY is required' })
  .refine((v) => !PLACEHOLDER.test(v), 'still has a placeholder value — generate one with scripts/init-env.sh')
  .refine((v) => {
    try {
      return Buffer.from(v, 'base64').length === 32
    } catch {
      return false
    }
  }, 'must be the base64 encoding of exactly 32 random bytes (openssl rand -base64 32)')

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

    // --- Public identity -------------------------------------------------------------------------------------
    DOMAIN: optionalString,
    PUBLIC_URL: optionalString,

    // --- Secrets -----------------------------------------------------------------------------------------------
    APP_SECRET: secret('APP_SECRET', 32),
    RECORDING_ENCRYPTION_KEY: base64Key32,
    LIVEKIT_API_KEY: z.string({ error: 'LIVEKIT_API_KEY is required' }).min(3, 'must be at least 3 characters'),
    LIVEKIT_API_SECRET: secret('LIVEKIT_API_SECRET', 32),

    // --- Database ------------------------------------------------------------------------------------------------
    DATABASE_URL: z
      .string({ error: 'DATABASE_URL is required' })
      .refine((v) => /^postgres(ql)?:\/\//.test(v), 'must be a postgres:// URL'),

    // --- LiveKit ---------------------------------------------------------------------------------------------------
    /** Server -> LiveKit (RoomService, loopback). */
    LIVEKIT_URL: z.string().url('must be a URL like http://127.0.0.1:7880').default('http://127.0.0.1:7880'),
    /** Browser -> LiveKit signaling. Defaults to the same origin as PUBLIC_URL (wss://DOMAIN). */
    LIVEKIT_PUBLIC_URL: optionalString,

    // --- Bootstrap (only used while no admin exists) ---------------------------------------------------------
    ADMIN_EMAIL: optionalString,
    ADMIN_PASSWORD: optionalString,

    // --- SMTP (optional) -------------------------------------------------------------------------------------
    SMTP_HOST: optionalString,
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_SECURE: bool.default(false),
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_FROM: optionalString,

    // --- Recording ---------------------------------------------------------------------------------------------
    RECORDINGS_DIR: optionalString,
    RECORDING_WORK_DIR: optionalString,
    FFMPEG_PATH: z.string().default('ffmpeg'),
    FFPROBE_PATH: z.string().default('ffprobe'),
    FFMPEG_THREADS: z.coerce.number().int().min(1).max(32).default(2),
    FFMPEG_TIMEOUT_MINUTES: z.coerce.number().int().min(1).max(24 * 60).default(120),

    // --- Logging ---------------------------------------------------------------------------------------------------
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    LOG_FORMAT: z.enum(['pretty', 'json']).default('pretty'),
  })
  .superRefine((v, ctx) => {
    if (v.SMTP_HOST && !v.SMTP_FROM) {
      ctx.addIssue({ code: 'custom', path: ['SMTP_FROM'], message: 'is required when SMTP_HOST is set' })
    }
    if (v.NODE_ENV === 'production' && !v.PUBLIC_URL && !v.DOMAIN) {
      ctx.addIssue({ code: 'custom', path: ['DOMAIN'], message: 'DOMAIN or PUBLIC_URL is required in production' })
    }
    if (v.PUBLIC_URL) {
      try {
        const url = new URL(v.PUBLIC_URL)
        if (url.pathname !== '/' || url.search || url.hash) {
          ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'must be an origin without path, e.g. https://meet.example.com' })
        }
      } catch {
        ctx.addIssue({ code: 'custom', path: ['PUBLIC_URL'], message: 'must be a valid URL, e.g. https://meet.example.com' })
      }
    }
  })
  .transform((v) => {
    const isDev = v.NODE_ENV !== 'production'
    const publicUrl = (v.PUBLIC_URL ?? (v.DOMAIN ? `https://${v.DOMAIN}` : 'http://localhost:3000')).replace(/\/$/, '')
    const publicOrigin = new URL(publicUrl)
    const livekitPublicUrl = (
      v.LIVEKIT_PUBLIC_URL ??
      (isDev ? 'ws://localhost:7880' : `${publicOrigin.protocol === 'https:' ? 'wss:' : 'ws:'}//${publicOrigin.host}`)
    ).replace(/\/$/, '')
    return {
      ...v,
      isDev,
      PUBLIC_URL: publicUrl,
      publicOrigin: publicOrigin.origin,
      /** Secure cookies and `__Host-` prefix only over HTTPS (browsers reject them on plain http). */
      secureCookies: publicOrigin.protocol === 'https:',
      LIVEKIT_PUBLIC_URL: livekitPublicUrl,
      RECORDINGS_DIR: v.RECORDINGS_DIR ?? (isDev ? '.data/recordings' : '/data/recordings'),
      RECORDING_WORK_DIR: v.RECORDING_WORK_DIR ?? (isDev ? '.data/work' : '/work'),
      smtpEnabled: Boolean(v.SMTP_HOST),
    }
  })

export type Env = z.output<typeof envSchema>

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}\nSee .env.example.`)
    this.name = 'EnvError'
  }
}

/** Pure parser (unit-tested). Every problem names the variable, e.g. "APP_SECRET: must be at least 32 characters". */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = envSchema.safeParse(source)
  if (!result.success) {
    const problems = result.error.issues.map((issue) => {
      const variable = issue.path.length ? String(issue.path[0]) : 'environment'
      return `${variable}: ${issue.message}`
    })
    throw new EnvError(problems)
  }
  return result.data
}

let cached: Env | undefined

/** Validated environment (cached). Throws EnvError with a readable message on the first call if invalid. */
export function env(): Env {
  cached ??= parseEnv(process.env)
  return cached
}

/** Tests only. */
export function resetEnvCache() {
  cached = undefined
}
