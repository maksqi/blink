import { z } from 'zod'

/**
 * Admin settings (database table `settings`, one row per key). Changing a value takes effect without restart.
 * Keys are dotted paths; `system.*` keys are internal and never exposed through the admin API.
 */
export const resolutionSchema = z.enum(['720p', '1080p'])
export type Resolution = z.infer<typeof resolutionSchema>

export const registrationModeSchema = z.enum(['invite_only', 'open', 'domain'])
export type RegistrationMode = z.infer<typeof registrationModeSchema>

const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/, 'Enter a domain like company.com')

export const settingsSchema = z.object({
  'registration.mode': registrationModeSchema.default('invite_only'),
  'registration.allowedDomains': z.array(domainSchema).max(50).default([]),
  'guests.allowed': z.boolean().default(true),
  'media.maxCameraResolution': resolutionSchema.default('720p'),
  'media.maxScreenShareResolution': resolutionSchema.default('1080p'),
  'media.maxScreenShareFps': z.union([z.literal(5), z.literal(15), z.literal(30)]).default(15),
  'limits.maxParticipantsPerRoom': z.number().int().min(2).max(25).default(25),
  'limits.maxRoomsPerUser': z.number().int().min(1).max(1000).default(50),
  'recording.enabled': z.boolean().default(true),
  'recording.retentionDays': z.number().int().min(1).max(3650).default(30),
  'recording.maxDurationMinutes': z.number().int().min(1).max(600).default(240),
  'recording.maxResolution': resolutionSchema.default('1080p'),
  /** 0 = unlimited. */
  'recording.userQuotaGb': z.number().min(0).max(100_000).default(20),
  'privacy.ipRetentionDays': z.number().int().min(1).max(365).default(30),
  'audit.retentionDays': z.number().int().min(30).max(3650).default(180),
})

export type Settings = z.infer<typeof settingsSchema>
export type SettingKey = keyof Settings

export const SETTINGS_DEFAULTS: Settings = settingsSchema.parse({})

/** PUT /api/admin/settings accepts a partial update; the server re-validates the merged result. */
export const settingsUpdateSchema = settingsSchema.partial().strict()
export type SettingsUpdate = z.infer<typeof settingsUpdateSchema>

/** GET /api/config — public, cacheable client configuration (no secrets). */
export const publicConfigSchema = z.object({
  appName: z.string(),
  publicUrl: z.string(),
  livekitUrl: z.string(),
  registration: z.object({ mode: registrationModeSchema, allowedDomains: z.array(z.string()) }),
  guestsAllowed: z.boolean(),
  smtpEnabled: z.boolean(),
  media: z.object({
    maxCameraResolution: resolutionSchema,
    maxScreenShareResolution: resolutionSchema,
    maxScreenShareFps: z.number(),
  }),
  limits: z.object({ maxParticipantsPerRoom: z.number() }),
  recording: z.object({ enabled: z.boolean(), maxDurationMinutes: z.number(), maxResolution: resolutionSchema }),
})
export type PublicConfig = z.infer<typeof publicConfigSchema>
