/**
 * Startup checks and the startup summary line (server-core, docs/SECURITY.md §7, docs/ARCHITECTURE.md §9).
 *
 * - `bindAddressProblem({ host, allowPublicBind })`: built servers must listen on loopback (`NITRO_HOST` or `HOST`
 *   = 127.0.0.1, ::1 or localhost) because Caddy is the only public entry. `ALLOW_PUBLIC_BIND=1` overrides it
 *   (e.g. an E2E proxy on a Docker bridge). Returns an error message or null.
 * - `startupSummary(...)`: `blinq 0.1.0 · https://meet.example.com · TURN on · SMTP off · registration invite_only`.
 */
export function isLoopbackHost(host: string): boolean {
  const value = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  return value === 'localhost' || value === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
}

export function bindAddressProblem(input: { host: string | undefined; allowPublicBind: boolean }): string | null {
  if (input.allowPublicBind) return null
  const host = input.host?.trim()
  if (host && isLoopbackHost(host)) return null
  return (
    `Refusing to listen on ${host ? `"${host}"` : 'all interfaces'}: set NITRO_HOST=127.0.0.1 ` +
    '(Caddy is the only public entry point). Set ALLOW_PUBLIC_BIND=1 only for test setups behind another proxy.'
  )
}

export function startupSummary(input: {
  version: string
  publicUrl: string
  turn: boolean
  smtp: boolean
  registrationMode: string | null
}): string {
  return [
    `blinq ${input.version}`,
    input.publicUrl,
    `TURN ${input.turn ? 'on' : 'off'}`,
    `SMTP ${input.smtp ? 'on' : 'off'}`,
    `registration ${input.registrationMode ?? 'unknown (database unreachable)'}`,
  ].join(' · ')
}
