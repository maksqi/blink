import { beforeEach, describe, expect, it } from 'vitest'
import { clearKeyVault } from '../shell/sign-out'
import { encodeRoomKey, generateRoomKey } from './keys'
import {
  createKeyVault,
  createTabKeys,
  KEY_VAULT_PREFIX,
  tabKeyStorageKey,
  vaultStorageKey,
  type KeyStorage,
} from './key-vault'

class MemoryStorage implements KeyStorage {
  readonly data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  key(index: number) {
    return [...this.data.keys()][index] ?? null
  }
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

class ThrowingStorage implements KeyStorage {
  getItem(): string | null {
    throw new DOMException('denied', 'SecurityError')
  }
  setItem(): void {
    throw new DOMException('full', 'QuotaExceededError')
  }
  removeItem(): void {
    throw new DOMException('denied', 'SecurityError')
  }
}

const ALICE = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b'
const BOB = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5c'
const ROOM_A = '0190a1b2-c3d4-7e5f-8a9b-00000000000a'
const ROOM_B = '0190a1b2-c3d4-7e5f-8a9b-00000000000b'
const SLUG_A = 'abc-defg-hjk'
const SLUG_B = 'mnp-qrst-uvw'
const INVITE = 'Zm9vYmFyYmF6cXV4LWludml0ZS10b2tlbi0xMjM0NTY'

describe('key vault', () => {
  let storage: MemoryStorage
  let clock: number
  beforeEach(() => {
    storage = new MemoryStorage()
    clock = 1_000
  })
  const vault = () =>
    createKeyVault(
      () => storage,
      () => clock,
    )

  it('stores keys under blinq:keys:<userId> in the documented shape', () => {
    const key = generateRoomKey()
    expect(vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key, keyVersion: 1 })).toBe(true)

    expect(vaultStorageKey(ALICE)).toBe(`${KEY_VAULT_PREFIX}${ALICE}`)
    expect(KEY_VAULT_PREFIX).toBe('blinq:keys:')
    expect(JSON.parse(storage.getItem(`blinq:keys:${ALICE}`)!)).toEqual({
      [ROOM_A]: { k: encodeRoomKey(key), slug: SLUG_A, keyVersion: 1, savedAt: 1_000 },
    })
    const entry = vault().get(ALICE, ROOM_A)
    expect(entry?.slug).toBe(SLUG_A)
    expect(entry?.keyVersion).toBe(1)
    expect(encodeRoomKey(entry!.key)).toBe(encodeRoomKey(key))
  })

  it('finds a room by slug and replaces a rotated key', () => {
    const first = generateRoomKey()
    const second = generateRoomKey()
    vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: first, keyVersion: 1 })
    vault().save(ALICE, { roomId: ROOM_B, slug: SLUG_B, key: generateRoomKey(), keyVersion: 1 })
    clock = 2_000
    vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: second, keyVersion: 2 })

    const found = vault().findBySlug(ALICE, SLUG_A)
    expect(found?.roomId).toBe(ROOM_A)
    expect(found?.keyVersion).toBe(2)
    expect(found?.savedAt).toBe(2_000)
    expect(encodeRoomKey(found!.key)).toBe(encodeRoomKey(second))
    expect(vault().entries(ALICE).size).toBe(2)
    expect(vault().findBySlug(ALICE, 'zzz-zzzz-zzz')).toBeNull()
  })

  it('is namespaced: entries of another user id are ignored', () => {
    vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: generateRoomKey(), keyVersion: 1 })

    expect(vault().get(BOB, ROOM_A)).toBeNull()
    expect(vault().findBySlug(BOB, SLUG_A)).toBeNull()
    expect(vault().entries(BOB).size).toBe(0)
    expect(vault().entries('').size).toBe(0)

    vault().save(BOB, { roomId: ROOM_B, slug: SLUG_B, key: generateRoomKey(), keyVersion: 3 })
    expect([...vault().entries(ALICE).keys()]).toEqual([ROOM_A])
    expect([...vault().entries(BOB).keys()]).toEqual([ROOM_B])
  })

  it('removes entries and drops the storage key when the last one goes', () => {
    vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: generateRoomKey(), keyVersion: 1 })
    vault().save(ALICE, { roomId: ROOM_B, slug: SLUG_B, key: generateRoomKey(), keyVersion: 1 })
    vault().remove(ALICE, ROOM_A)
    expect([...vault().entries(ALICE).keys()]).toEqual([ROOM_B])
    vault().remove(ALICE, ROOM_B)
    expect(storage.getItem(vaultStorageKey(ALICE))).toBeNull()
    vault().remove(ALICE, ROOM_B) // removing twice is harmless
  })

  it('ignores malformed entries instead of half-using them', () => {
    const good = encodeRoomKey(generateRoomKey())
    storage.setItem(
      vaultStorageKey(ALICE),
      JSON.stringify({
        [ROOM_A]: { k: good, slug: SLUG_A, keyVersion: 1, savedAt: 5 },
        [ROOM_B]: { k: good.slice(0, 20), slug: SLUG_B, keyVersion: 1, savedAt: 5 }, // truncated key
        'not-a-room-id': { k: good, slug: SLUG_A, keyVersion: 1, savedAt: 5 },
        '0190a1b2-c3d4-7e5f-8a9b-00000000000c': { k: good, slug: 'bad', keyVersion: 1, savedAt: 5 },
        '0190a1b2-c3d4-7e5f-8a9b-00000000000d': { k: good, slug: SLUG_B, keyVersion: 0, savedAt: 5 },
        '0190a1b2-c3d4-7e5f-8a9b-00000000000e': 'nope',
      }),
    )
    expect([...vault().entries(ALICE).keys()]).toEqual([ROOM_A])

    storage.setItem(vaultStorageKey(BOB), '{not json')
    expect(vault().entries(BOB).size).toBe(0)
    storage.setItem(vaultStorageKey(BOB), '[1,2]')
    expect(vault().entries(BOB).size).toBe(0)
  })

  it('refuses invalid entries on save', () => {
    const key = generateRoomKey()
    expect(vault().save('', { roomId: ROOM_A, slug: SLUG_A, key, keyVersion: 1 })).toBe(false)
    expect(vault().save(ALICE, { roomId: 'x', slug: SLUG_A, key, keyVersion: 1 })).toBe(false)
    expect(vault().save(ALICE, { roomId: ROOM_A, slug: 'nope', key, keyVersion: 1 })).toBe(false)
    expect(vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: key.slice(0, 16), keyVersion: 1 })).toBe(false)
    expect(storage.data.size).toBe(0)
  })

  it('survives storage that throws or does not exist', () => {
    for (const getter of [
      () => new ThrowingStorage(),
      () => null,
      () => {
        throw new DOMException('denied', 'SecurityError')
      },
    ]) {
      const broken = createKeyVault(getter)
      expect(broken.save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: generateRoomKey(), keyVersion: 1 })).toBe(false)
      expect(broken.get(ALICE, ROOM_A)).toBeNull()
      expect(broken.findBySlug(ALICE, SLUG_A)).toBeNull()
      expect(() => broken.remove(ALICE, ROOM_A)).not.toThrow()
    }
  })

  it('is cleared by the sign-out helper, which knows the same prefix', () => {
    vault().save(ALICE, { roomId: ROOM_A, slug: SLUG_A, key: generateRoomKey(), keyVersion: 1 })
    vault().save(BOB, { roomId: ROOM_B, slug: SLUG_B, key: generateRoomKey(), keyVersion: 1 })
    storage.setItem('blinq-color-mode', 'dark')
    clearKeyVault(storage)
    expect([...storage.data.keys()]).toEqual(['blinq-color-mode'])
  })
})

describe('tab keys', () => {
  let storage: MemoryStorage
  beforeEach(() => {
    storage = new MemoryStorage()
  })
  const tab = () => createTabKeys(() => storage)

  it('keeps the key and invite token of this tab under blinq:tabkey:<slug>', () => {
    const key = generateRoomKey()
    expect(tab().save(SLUG_A, { key, inviteToken: INVITE })).toBe(true)
    expect(JSON.parse(storage.getItem(`blinq:tabkey:${SLUG_A}`)!)).toEqual({ k: encodeRoomKey(key), t: INVITE })
    const read = tab().get(SLUG_A)
    expect(encodeRoomKey(read!.key)).toBe(encodeRoomKey(key))
    expect(read?.inviteToken).toBe(INVITE)

    tab().save(SLUG_A, { key })
    expect(tab().get(SLUG_A)?.inviteToken).toBeUndefined()
    tab().remove(SLUG_A)
    expect(tab().get(SLUG_A)).toBeNull()
  })

  it('rejects bad slugs, drops corrupt keys and ignores bad invite tokens', () => {
    expect(tab().save('Not-A-Slug', { key: generateRoomKey() })).toBe(false)
    expect(tab().get('Not-A-Slug')).toBeNull()

    storage.setItem(tabKeyStorageKey(SLUG_A), JSON.stringify({ k: 'short' }))
    expect(tab().get(SLUG_A)).toBeNull()
    expect(storage.getItem(tabKeyStorageKey(SLUG_A))).toBeNull()

    const key = encodeRoomKey(generateRoomKey())
    storage.setItem(tabKeyStorageKey(SLUG_B), JSON.stringify({ k: key, t: 'has spaces in it!' }))
    expect(tab().get(SLUG_B)?.inviteToken).toBeUndefined()
    storage.setItem(tabKeyStorageKey(SLUG_B), 'not json')
    expect(tab().get(SLUG_B)).toBeNull()
  })

  it('survives storage that throws', () => {
    const broken = createTabKeys(() => new ThrowingStorage())
    expect(broken.save(SLUG_A, { key: generateRoomKey() })).toBe(false)
    expect(broken.get(SLUG_A)).toBeNull()
    expect(() => broken.remove(SLUG_A)).not.toThrow()
  })
})
