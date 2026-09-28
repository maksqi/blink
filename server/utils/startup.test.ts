import { describe, expect, it } from 'vitest'
import journal from '../database/migrations/meta/_journal.json'
import { LATEST_MIGRATION_AT, migrationsState } from './readiness'
import { bindAddressProblem, isLoopbackHost, listenErrorMessage, startupSummary } from './startup'

describe('bindAddressProblem', () => {
  it.each(['127.0.0.1', '127.0.0.2', '::1', '[::1]', 'localhost', ' LOCALHOST '])('accepts loopback %s', (host) => {
    expect(isLoopbackHost(host)).toBe(true)
    expect(bindAddressProblem({ host, allowPublicBind: false })).toBeNull()
  })

  it.each([undefined, '', '0.0.0.0', '::', '192.168.1.10', 'example.com'])('refuses %s', (host) => {
    expect(bindAddressProblem({ host, allowPublicBind: false })).toMatch(/NITRO_HOST=127\.0\.0\.1/)
  })

  it('allows an explicit public bind', () => {
    expect(bindAddressProblem({ host: '0.0.0.0', allowPublicBind: true })).toBeNull()
  })
})

describe('listenErrorMessage', () => {
  const listenError = (code: string) => Object.assign(new Error(code), { code, syscall: 'listen', address: '127.0.0.1', port: 3000 })

  it('explains listen failures', () => {
    expect(listenErrorMessage(listenError('EADDRINUSE'))).toBe(
      'Cannot listen on 127.0.0.1:3000: the port is already in use (is another server still running?). Exiting.',
    )
    expect(listenErrorMessage(listenError('EACCES'))).toContain('permission denied')
    expect(listenErrorMessage(listenError('EADDRNOTAVAIL'))).toContain('not available')
    expect(listenErrorMessage(listenError('EOTHER'))).toContain('EOTHER')
  })

  it('ignores every other error', () => {
    expect(listenErrorMessage(new Error('boom'))).toBeNull()
    expect(listenErrorMessage(Object.assign(new Error('x'), { code: 'EADDRINUSE', syscall: 'connect' }))).toBeNull()
    expect(listenErrorMessage(null)).toBeNull()
    expect(listenErrorMessage('text')).toBeNull()
  })
})

describe('startupSummary', () => {
  it('prints one line', () => {
    expect(
      startupSummary({ version: '0.1.0', publicUrl: 'https://meet.example.test', turn: true, smtp: false, registrationMode: 'invite_only' }),
    ).toBe('blinq 0.1.0 · https://meet.example.test · TURN on · SMTP off · registration invite_only')
    expect(startupSummary({ version: '1', publicUrl: 'x', turn: false, smtp: true, registrationMode: null })).toContain(
      'registration unknown',
    )
  })
})

describe('migrationsState', () => {
  it('is ok only when the newest bundled migration is applied', () => {
    expect(LATEST_MIGRATION_AT).toBe(Math.max(...journal.entries.map((e) => e.when)))
    expect(migrationsState(LATEST_MIGRATION_AT)).toBe('ok')
    expect(migrationsState(LATEST_MIGRATION_AT + 1)).toBe('ok')
    expect(migrationsState(LATEST_MIGRATION_AT - 1)).toBe('pending')
    expect(migrationsState(null)).toBe('pending')
  })
})
