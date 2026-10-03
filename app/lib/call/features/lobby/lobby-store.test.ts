import { describe, expect, it } from 'vitest'
import type { LobbyEntry } from '#shared/schemas/calls'
import { addedEntries, lobbyToastPlan, mergeLobby, withoutEntry } from './lobby-store'

const entry = (requestId: string, seconds: number, displayName = `Guest ${requestId}`): LobbyEntry => ({
  requestId,
  displayName,
  kind: 'guest',
  requestedAt: new Date(Date.UTC(2026, 9, 3, 12, 0, seconds)).toISOString(),
})

describe('mergeLobby', () => {
  it('orders by request time, then request id', () => {
    const merged = mergeLobby([], [entry('c', 3), entry('b', 1), entry('a', 1)])
    expect(merged.map((e) => e.requestId)).toEqual(['a', 'b', 'c'])
  })

  it('dedupes by request id', () => {
    const merged = mergeLobby([], [entry('a', 1), entry('a', 1), entry('b', 2)])
    expect(merged.map((e) => e.requestId)).toEqual(['a', 'b'])
  })

  it('keeps unchanged rows as the same objects and returns the same list when nothing changed', () => {
    const a = entry('a', 1)
    const b = entry('b', 2)
    const current = [a, b]
    const same = mergeLobby(current, [entry('b', 2), entry('a', 1)])
    expect(same).toBe(current)
    const next = mergeLobby(current, [entry('b', 2), entry('c', 3), entry('a', 1)])
    expect(next[0]).toBe(a)
    expect(next[1]).toBe(b)
    expect(next.map((e) => e.requestId)).toEqual(['a', 'b', 'c'])
  })

  it('follows the server: decided requests leave, renamed ones update', () => {
    const current = [entry('a', 1), entry('b', 2)]
    const next = mergeLobby(current, [entry('b', 2, 'Renamed')])
    expect(next).toEqual([entry('b', 2, 'Renamed')])
  })

  it('puts entries with an unreadable time last', () => {
    const odd = { ...entry('z', 0), requestedAt: 'not a date' }
    expect(mergeLobby([], [odd, entry('a', 5)]).map((e) => e.requestId)).toEqual(['a', 'z'])
  })
})

describe('addedEntries and withoutEntry', () => {
  it('finds new arrivals', () => {
    expect(addedEntries([entry('a', 1)], [entry('a', 1), entry('b', 2)]).map((e) => e.requestId)).toEqual(['b'])
    expect(addedEntries([entry('a', 1)], [])).toEqual([])
  })

  it('removes one request', () => {
    expect(withoutEntry([entry('a', 1), entry('b', 2)], 'a').map((e) => e.requestId)).toEqual(['b'])
  })
})

describe('lobbyToastPlan', () => {
  it('names each new person up to three waiting', () => {
    expect(lobbyToastPlan([], 2)).toEqual({ kind: 'none' })
    expect(lobbyToastPlan([entry('a', 1)], 1)).toEqual({ kind: 'each', entries: [entry('a', 1)] })
    expect(lobbyToastPlan([entry('b', 1), entry('c', 2)], 3)).toMatchObject({ kind: 'each' })
  })

  it('stacks into one summary above three people', () => {
    expect(lobbyToastPlan([entry('d', 4)], 4)).toEqual({ kind: 'summary', count: 4 })
  })
})
