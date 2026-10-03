import { beforeEach, describe, expect, it } from 'vitest'
import type { KeyStorage } from '../e2ee/key-vault'
import { CLIENT_ID_KEY, isClientId, newClientId, resetClientIdMemory, tabClientId } from './client-id'

class MemoryStorage implements KeyStorage {
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

describe('tab client id', () => {
  beforeEach(() => resetClientIdMemory())

  it('creates a schema-valid id once per tab', () => {
    const storage = new MemoryStorage()
    const id = tabClientId(() => storage)
    expect(isClientId(id)).toBe(true)
    expect(storage.getItem(CLIENT_ID_KEY)).toBe(id)
    expect(tabClientId(() => storage)).toBe(id)
    // Another tab has its own sessionStorage, so its own id.
    expect(tabClientId(() => new MemoryStorage())).not.toBe(id)
  })

  it('replaces a malformed stored id', () => {
    const storage = new MemoryStorage()
    storage.setItem(CLIENT_ID_KEY, 'short')
    const id = tabClientId(() => storage)
    expect(id).not.toBe('short')
    expect(isClientId(id)).toBe(true)
  })

  it('falls back to an id that is stable for the page when storage is unusable', () => {
    const broken = () => {
      throw new DOMException('denied', 'SecurityError')
    }
    const id = tabClientId(broken)
    expect(isClientId(id)).toBe(true)
    expect(tabClientId(broken)).toBe(id)
    expect(tabClientId(() => null)).toBe(id)
  })

  it('generates 22-character base64url ids', () => {
    expect(newClientId()).toMatch(/^[A-Za-z0-9_-]{22}$/)
    expect(isClientId('a'.repeat(15))).toBe(false)
    expect(isClientId('a'.repeat(65))).toBe(false)
    expect(isClientId(42)).toBe(false)
  })
})
