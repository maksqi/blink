import { describe, expect, it } from 'vitest'
import { EnvError, parseEnv } from './env'

const valid = {
  NODE_ENV: 'production',
  DOMAIN: 'meet.example.com',
  APP_SECRET: 'a'.repeat(48),
  RECORDING_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  LIVEKIT_API_KEY: 'APIabc123',
  LIVEKIT_API_SECRET: 'b'.repeat(48),
  DATABASE_URL: 'postgres://blinq:x@localhost/blinq?host=/var/run/postgresql',
}

function problems(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source)
    return []
  } catch (error) {
    if (error instanceof EnvError) return error.problems
    throw error
  }
}

describe('parseEnv', () => {
  it('accepts a minimal production configuration and derives public URLs', () => {
    const env = parseEnv(valid)
    expect(env.PUBLIC_URL).toBe('https://meet.example.com')
    expect(env.LIVEKIT_PUBLIC_URL).toBe('wss://meet.example.com')
    expect(env.secureCookies).toBe(true)
    expect(env.RECORDINGS_DIR).toBe('/data/recordings')
    expect(env.smtpEnabled).toBe(false)
  })

  it('names the offending variable in every problem', () => {
    const found = problems({ ...valid, APP_SECRET: 'short', LIVEKIT_API_SECRET: undefined })
    expect(found.some((p) => p.startsWith('APP_SECRET:'))).toBe(true)
    expect(found.some((p) => p.startsWith('LIVEKIT_API_SECRET:'))).toBe(true)
  })

  it('refuses placeholder secrets from .env.example', () => {
    const found = problems({ ...valid, APP_SECRET: 'change-me-to-a-long-random-string-000000' })
    expect(found).toEqual([expect.stringMatching(/^APP_SECRET: .*placeholder/)])
  })

  it('requires a 32-byte base64 recording key', () => {
    expect(problems({ ...valid, RECORDING_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') })).toEqual([
      expect.stringMatching(/^RECORDING_ENCRYPTION_KEY:/),
    ])
  })

  it('requires SMTP_FROM with SMTP_HOST and a domain in production', () => {
    expect(problems({ ...valid, SMTP_HOST: 'smtp.example.com' })).toEqual([expect.stringMatching(/^SMTP_FROM:/)])
    expect(problems({ ...valid, DOMAIN: undefined })).toEqual([expect.stringMatching(/^DOMAIN:/)])
  })

  it('rejects a PUBLIC_URL with a path', () => {
    expect(problems({ ...valid, PUBLIC_URL: 'https://meet.example.com/app' })).toEqual([
      expect.stringMatching(/^PUBLIC_URL:/),
    ])
  })

  it('uses local defaults in development', () => {
    const env = parseEnv({ ...valid, NODE_ENV: 'development', DOMAIN: undefined })
    expect(env.PUBLIC_URL).toBe('http://localhost:3000')
    expect(env.LIVEKIT_PUBLIC_URL).toBe('ws://localhost:7880')
    expect(env.secureCookies).toBe(false)
  })
})
