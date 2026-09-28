import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { RoomFragment } from '../e2ee/fragment'
import { encodeRoomKey, generateRoomKey } from '../e2ee/keys'
import {
  captureFragment,
  createFragmentStore,
  createResilientStorage,
  fragmentKind,
  fragmentStorageKey,
  type KeyValueStore,
} from './fragment-store'

class MemoryStorage implements KeyValueStore {
  readonly data = new Map<string, string>()
  getItem(key: string) {
    return this.data.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.data.set(key, value)
  }
  removeItem(key: string) {
    this.data.delete(key)
  }
}

function fakeHistory(state: unknown = { position: 3 }) {
  return { state, replaceState: vi.fn() }
}

function at(url: string) {
  const { pathname, search, hash } = new URL(url, 'https://meet.example.com')
  return { pathname, search, hash }
}

const TOKEN = 'abcdefghijklmnopqrstuv_-0123'
const INVITE = 'invite-token-abcdefgh'

describe('fragment kinds', () => {
  it('knows which pages take secrets', () => {
    expect(fragmentKind('/m/abc-defg-hjk')).toBe('room')
    expect(fragmentKind('/m/abc-defg-hjk/')).toBe('room')
    expect(fragmentKind('/invite')).toBe('token')
    expect(fragmentKind('/verify-email/')).toBe('token')
    expect(fragmentKind('/reset-password')).toBe('token')
    expect(fragmentKind('/m/')).toBeNull()
    expect(fragmentKind('/m/a/b')).toBeNull()
    expect(fragmentKind('/dashboard')).toBeNull()
    expect(fragmentKind('/invite/extra')).toBeNull()
    expect(fragmentStorageKey('/invite/')).toBe('blinq:fragment:/invite')
  })
})

describe('captureFragment', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    storage = new MemoryStorage()
  })

  it('stores the room key and invite token and strips the hash, keeping path, query and history state', () => {
    const key = generateRoomKey()
    const encoded = encodeRoomKey(key)
    const history = fakeHistory()
    const result = captureFragment({ location: at(`/m/abc-defg-hjk?lang=en#k=${encoded}&t=${INVITE}`), history, storage })

    expect(result).toEqual({ pathname: '/m/abc-defg-hjk', kind: 'room', stored: true })
    expect(history.replaceState).toHaveBeenCalledExactlyOnceWith(history.state, '', '/m/abc-defg-hjk?lang=en')
    expect(JSON.parse(storage.getItem('blinq:fragment:/m/abc-defg-hjk')!)).toEqual({
      kind: 'room',
      k: encoded,
      t: INVITE,
      invalidKey: false,
    })

    const store = createFragmentStore(storage)
    const taken = store.take('/m/abc-defg-hjk')
    expect(taken).toEqual({ key, inviteToken: INVITE, invalidKey: false })
    expect(store.take('/m/abc-defg-hjk')).toBeNull()
  })

  it('records a truncated key so the page can explain the broken link', () => {
    const history = fakeHistory()
    const truncated = encodeRoomKey(generateRoomKey()).slice(0, 20)
    captureFragment({ location: at(`/m/abc-defg-hjk#k=${truncated}`), history, storage })

    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', '/m/abc-defg-hjk')
    expect(createFragmentStore(storage).take('/m/abc-defg-hjk')).toEqual({ invalidKey: true })
  })

  it.each(['/invite', '/verify-email', '/reset-password'] as const)('keeps the bare token of %s', (path) => {
    const history = fakeHistory(null)
    captureFragment({ location: at(`${path}#${TOKEN}`), history, storage })

    expect(history.replaceState).toHaveBeenCalledWith(null, '', path)
    const store = createFragmentStore(storage)
    expect(store.peek(path)).toBe(TOKEN)
    expect(store.take(path)).toBe(TOKEN)
    expect(store.peek(path)).toBeNull()
  })

  it('strips unusable fragments and drops an older capture for the same page', () => {
    storage.setItem('blinq:fragment:/invite', JSON.stringify({ kind: 'token', token: TOKEN }))
    const history = fakeHistory()
    const result = captureFragment({ location: at('/invite#not a token'), history, storage })

    expect(result).toEqual({ pathname: '/invite', kind: 'token', stored: false })
    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', '/invite')
    expect(storage.data.size).toBe(0)
  })

  it('normalizes a trailing slash', () => {
    captureFragment({ location: at(`/invite/#${TOKEN}`), history: fakeHistory(), storage })
    const store = createFragmentStore(storage)
    expect(store.take('/invite/')).toBe(TOKEN)
  })

  it('leaves other pages and URLs without a fragment alone', () => {
    storage.setItem('blinq:fragment:/m/abc-defg-hjk', JSON.stringify({ kind: 'room', t: INVITE, invalidKey: false }))
    const history = fakeHistory()

    expect(captureFragment({ location: at('/dashboard#section'), history, storage })).toBeNull()
    expect(captureFragment({ location: at('/m/abc-defg-hjk'), history, storage })).toBeNull()
    expect(history.replaceState).not.toHaveBeenCalled()
    // A reload without a fragment keeps a capture that no page has taken yet.
    expect(createFragmentStore(storage).peek('/m/abc-defg-hjk')).toEqual({ inviteToken: INVITE, invalidKey: false })
  })

  it('still strips the hash when storage throws', () => {
    const history = fakeHistory()
    const broken: KeyValueStore = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }
    const result = captureFragment({ location: at(`/invite#${TOKEN}`), history, storage: broken })
    expect(result).toEqual({ pathname: '/invite', kind: 'token', stored: false })
    expect(history.replaceState).toHaveBeenCalledWith(history.state, '', '/invite')
  })
})

describe('createFragmentStore', () => {
  it('drops corrupt or mismatched entries instead of returning them', () => {
    const storage = new MemoryStorage()
    storage.setItem('blinq:fragment:/invite', '{not json')
    storage.setItem('blinq:fragment:/verify-email', JSON.stringify({ kind: 'room', invalidKey: true }))
    storage.setItem('blinq:fragment:/reset-password', JSON.stringify({ kind: 'token', token: 'short' }))
    storage.setItem('blinq:fragment:/m/abc-defg-hjk', JSON.stringify({ kind: 'room', k: 'AAAA', invalidKey: false }))
    const store = createFragmentStore(storage)

    expect(store.take('/invite')).toBeNull()
    expect(store.take('/verify-email')).toBeNull()
    expect(store.take('/reset-password')).toBeNull()
    // A tampered key is reported as invalid, never passed on.
    expect(store.take('/m/abc-defg-hjk')).toEqual({ invalidKey: true })
    expect(storage.data.size).toBe(0)
  })

  it('returns null for pages that never take secrets', () => {
    const storage = new MemoryStorage()
    storage.setItem('blinq:fragment:/dashboard', JSON.stringify({ kind: 'token', token: TOKEN }))
    expect(createFragmentStore(storage).take('/dashboard')).toBeNull()
  })

  it('types each value by the page it belongs to', () => {
    const store = createFragmentStore(new MemoryStorage())
    const slug: string = 'abc-defg-hjk'
    expectTypeOf(store.take(`/m/${slug}`)).toEqualTypeOf<RoomFragment | null>()
    expectTypeOf(store.peek('/m/abc-defg-hjk')).toEqualTypeOf<RoomFragment | null>()
    expectTypeOf(store.take('/invite')).toEqualTypeOf<string | null>()
    expectTypeOf(store.peek('/reset-password')).toEqualTypeOf<string | null>()
    const path: string = '/verify-email'
    expectTypeOf(store.take(path)).toEqualTypeOf<RoomFragment | string | null>()
  })
})

describe('createResilientStorage', () => {
  it('uses the primary storage when it works', () => {
    const primary = new MemoryStorage()
    const storage = createResilientStorage(() => primary)
    storage.setItem('a', '1')
    expect(primary.getItem('a')).toBe('1')
    expect(storage.getItem('a')).toBe('1')
    storage.removeItem('a')
    expect(primary.getItem('a')).toBeNull()
  })

  it('falls back to memory when the primary storage is unavailable or throws', () => {
    const unavailable = createResilientStorage(() => {
      throw new Error('SecurityError')
    })
    unavailable.setItem('a', '1')
    expect(unavailable.getItem('a')).toBe('1')
    unavailable.removeItem('a')
    expect(unavailable.getItem('a')).toBeNull()

    const full = createResilientStorage(() => ({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
      removeItem: () => {},
    }))
    full.setItem('b', '2')
    expect(full.getItem('b')).toBe('2')
  })
})
