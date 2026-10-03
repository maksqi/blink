import { describe, expect, it, vi } from 'vitest'
import { clearKeyVault, clearTabKeys, keysToForget, signOut, type KeyListStorage } from './sign-out'

function listStorage(entries: Record<string, string>): KeyListStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(entries))
  return {
    data,
    get length() {
      return data.size
    },
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => {
      data.delete(key)
    },
  }
}

function deps(logout: () => Promise<unknown>) {
  const calls: string[] = []
  return {
    calls,
    logout: vi.fn(async () => {
      calls.push('logout')
      return logout()
    }),
    clearUser: vi.fn(() => calls.push('clearUser')),
    navigate: vi.fn(() => calls.push('navigate')),
    onError: vi.fn(),
  }
}

describe('signOut', () => {
  it('signs out on the server, clears local state, then leaves', async () => {
    const vault = listStorage({ 'blinq:keys:u1': '{}', 'blinq-color-mode': 'dark' })
    // F-011: a link fragment captured on load but never taken by a page holds a room key too.
    const tabKeys = listStorage({
      'blinq:tabkey:abc-defg-hjk': '{}',
      'blinq:fragment:/m/abc-defg-hjk': '{}',
      'blinq:clientId': 'c1',
    })
    const d = deps(async () => undefined)
    await signOut({ ...d, vault, tabKeys })

    expect(d.calls).toEqual(['logout', 'clearUser', 'navigate'])
    expect(d.onError).not.toHaveBeenCalled()
    expect([...vault.data.keys()]).toEqual(['blinq-color-mode'])
    expect([...tabKeys.data.keys()]).toEqual(['blinq:clientId'])
  })

  it('reports a failed server call and still signs out locally', async () => {
    const error = Object.assign(new Error('Something went wrong on the server.'), { status: 501 })
    const d = deps(async () => {
      throw error
    })
    await signOut(d)

    expect(d.onError).toHaveBeenCalledExactlyOnceWith(error)
    expect(d.calls).toEqual(['logout', 'clearUser', 'navigate'])
  })

  it('treats an already ended session as success', async () => {
    const d = deps(async () => {
      throw Object.assign(new Error('Please sign in.'), { status: 401 })
    })
    await signOut(d)
    expect(d.onError).not.toHaveBeenCalled()
    expect(d.navigate).toHaveBeenCalledOnce()
  })
})

describe('clearKeyVault', () => {
  it('removes every vault entry and nothing else', () => {
    const storage = listStorage({ 'blinq:keys:a': '1', 'blinq:keys:b': '2', other: '3', 'blinq:keysx': '4' })
    clearKeyVault(storage)
    expect([...storage.data.keys()]).toEqual(['other', 'blinq:keysx'])
  })

  it('ignores missing or unusable storage', () => {
    expect(() => clearKeyVault(null)).not.toThrow()
    const broken: KeyListStorage = {
      get length(): number {
        throw new Error('SecurityError')
      },
      key: () => null,
      removeItem: () => {},
    }
    expect(() => clearKeyVault(broken)).not.toThrow()
  })
})

describe('clearTabKeys', () => {
  it('removes every per-tab meeting key and captured link fragment, and nothing else', () => {
    const storage = listStorage({
      'blinq:tabkey:a': '{}',
      'blinq:tabkey:b': '{}',
      'blinq:fragment:/m/abc-defg-hjk': '{"kind":"room","k":"x"}',
      'blinq:fragment:/invite': '{"kind":"token","token":"x"}',
      'blinq:clientId': 'c1',
    })
    clearTabKeys(storage)
    expect([...storage.data.keys()]).toEqual(['blinq:clientId'])
    expect(() => clearTabKeys(null)).not.toThrow()
  })
})

// F-029: the vault is cleared on a 401 or a missing session too, not only when this tab knew the previous user.
describe('keysToForget', () => {
  it('forgets everything when the signed-in user is gone or changed', () => {
    expect(keysToForget('u1', null)).toBe('all')
    expect(keysToForget('u1', 'u2')).toBe('all')
  })

  it('forgets the vault whenever nobody is signed in, so an expired session leaves no keys behind', () => {
    expect(keysToForget(null, null)).toBe('vault')
  })

  it('keeps the keys of a user who stays signed in', () => {
    expect(keysToForget('u1', 'u1')).toBe('none')
    expect(keysToForget(null, 'u1')).toBe('none')
  })
})
