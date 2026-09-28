/**
 * Provider registry (auth). `password` is always registered; OIDC providers register at startup once they exist
 * (a sync Nitro plugin calling `registerAuthProvider(createIdentityProvider('oidc:<id>', verify))`).
 *
 * - `createProviderRegistry()`: an isolated registry (unit tests).
 * - `authProviders`: the process-wide registry; `registerAuthProvider(provider)` returns an unregister function;
 *   `getAuthProvider(id)`, `requireAuthProvider(id)`, `listAuthProviders()`.
 */
import { passwordProvider } from './password'
import { isAuthProviderId, type AuthProvider, type AuthProviderId } from './types'

export * from './types'
export { createIdentityProvider, linkIdentity } from './identity'
export { passwordProvider, touchPasswordIdentity } from './password'

export interface ProviderRegistry {
  register(provider: AuthProvider<never>, options?: { replace?: boolean }): () => void
  get(id: string): AuthProvider<unknown> | undefined
  require(id: string): AuthProvider<unknown>
  list(): AuthProviderId[]
}

export function createProviderRegistry(initial: AuthProvider<never>[] = []): ProviderRegistry {
  const providers = new Map<AuthProviderId, AuthProvider<unknown>>()
  const registry: ProviderRegistry = {
    register(provider, options = {}) {
      if (!isAuthProviderId(provider.id)) throw new TypeError(`Invalid auth provider id "${provider.id}"`)
      if (providers.has(provider.id) && !options.replace) {
        throw new Error(`Auth provider "${provider.id}" is already registered`)
      }
      const entry = provider as AuthProvider<unknown>
      providers.set(provider.id, entry)
      return () => {
        if (providers.get(provider.id) === entry) providers.delete(provider.id)
      }
    },
    get: (id) => (isAuthProviderId(id) ? providers.get(id) : undefined),
    require(id) {
      const provider = registry.get(id)
      if (!provider) throw new Error(`Unknown auth provider "${id}"`)
      return provider
    },
    list: () => [...providers.keys()],
  }
  for (const provider of initial) registry.register(provider)
  return registry
}

export const authProviders = createProviderRegistry([passwordProvider as AuthProvider<never>])

export const registerAuthProvider = (provider: AuthProvider<never>, options?: { replace?: boolean }) =>
  authProviders.register(provider, options)
export const getAuthProvider = (id: string) => authProviders.get(id)
export const requireAuthProvider = (id: string) => authProviders.require(id)
export const listAuthProviders = () => authProviders.list()
