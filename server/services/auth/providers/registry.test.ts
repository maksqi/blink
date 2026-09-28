import { describe, expect, it } from 'vitest'
import { authProviders, createProviderRegistry, isAuthProviderId, passwordProvider, type AuthProvider } from './index'

const stub = (id: AuthProvider['id'], userId = 'u-1'): AuthProvider<{ ok: boolean }> => ({
  id,
  authenticate: async (input) => (input.ok ? { userId } : null),
})

describe('auth provider registry', () => {
  it('always has the password provider', () => {
    expect(authProviders.list()).toContain('password')
    expect(authProviders.get('password')).toBe(passwordProvider)
    expect(passwordProvider.id).toBe('password')
  })

  it('registers, resolves and unregisters providers', async () => {
    const registry = createProviderRegistry()
    const off = registry.register(stub('oidc:example'))
    expect(registry.list()).toEqual(['oidc:example'])
    expect(await registry.require('oidc:example').authenticate({ ok: true })).toEqual({ userId: 'u-1' })
    expect(await registry.require('oidc:example').authenticate({ ok: false })).toBeNull()
    off()
    expect(registry.get('oidc:example')).toBeUndefined()
    expect(() => registry.require('oidc:example')).toThrow(/Unknown auth provider/)
  })

  it('refuses duplicates unless replacing, and an old unregister never removes the replacement', () => {
    const registry = createProviderRegistry()
    const offFirst = registry.register(stub('oidc:example', 'first'))
    expect(() => registry.register(stub('oidc:example', 'second'))).toThrow(/already registered/)
    const replacement = stub('oidc:example', 'second')
    registry.register(replacement, { replace: true })
    offFirst()
    expect(registry.get('oidc:example')).toBe(replacement)
  })

  it('accepts only password and oidc:<id> ids', () => {
    expect(isAuthProviderId('password')).toBe(true)
    expect(isAuthProviderId('oidc:google')).toBe(true)
    expect(isAuthProviderId('oidc:')).toBe(false)
    expect(isAuthProviderId('oidc:Bad Id')).toBe(false)
    expect(isAuthProviderId('saml:x')).toBe(false)
    expect(() => createProviderRegistry().register(stub('saml:x' as AuthProvider['id']))).toThrow(
      /Invalid auth provider/,
    )
    expect(createProviderRegistry().get('__proto__')).toBeUndefined()
  })
})
