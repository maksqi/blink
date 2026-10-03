import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePresenceMessage, presenceChannelName, TabPresence, type ChannelLike } from './tab-presence'

/** An in-memory BroadcastChannel: delivers asynchronously to every other member, like the real one. */
class Bus {
  readonly members = new Set<FakeChannel>()
  open() {
    const channel = new FakeChannel(this)
    this.members.add(channel)
    return channel
  }
}

class FakeChannel implements ChannelLike {
  onmessage: ((event: { data: unknown }) => void) | null = null
  closed = false
  constructor(private readonly bus: Bus) {}
  postMessage(message: unknown) {
    if (this.closed) throw new DOMException('closed', 'InvalidStateError')
    const data = structuredClone(message)
    for (const member of this.bus.members) {
      if (member !== this && !member.closed) queueMicrotask(() => member.onmessage?.({ data }))
    }
  }
  close() {
    this.closed = true
    this.bus.members.delete(this)
  }
}

const tabs: TabPresence[] = []
function tab(bus: Bus, id: string, inCall: () => boolean, onLeaveRequest: () => void = () => {}) {
  const presence = new TabPresence({ channel: bus.open(), id, inCall, onLeaveRequest })
  tabs.push(presence)
  return presence
}

afterEach(() => {
  for (const presence of tabs.splice(0)) presence.close()
  vi.useRealTimers()
})

describe('tab presence', () => {
  it('names the channel after the meeting', () => {
    expect(presenceChannelName('abc-defg-hjk')).toBe('blinq:call:abc-defg-hjk')
  })

  it('finds a tab that is in the call', async () => {
    const bus = new Bus()
    tab(bus, 'old', () => true)
    const fresh = tab(bus, 'new', () => false)
    expect(await fresh.probe(200)).toBe('old')
  })

  it('finds nobody when the other tabs are not in the call or there are none', async () => {
    const bus = new Bus()
    tab(bus, 'idle', () => false)
    const fresh = tab(bus, 'new', () => false)
    expect(await fresh.probe(30)).toBeNull()
    expect(
      await new TabPresence({ channel: null, id: 'x', inCall: () => true, onLeaveRequest: () => {} }).probe(30),
    ).toBeNull()
  })

  it('asks the other tab to leave and waits for its confirmation', async () => {
    const bus = new Bus()
    const order: string[] = []
    tab(
      bus,
      'old',
      () => true,
      async () => {
        await Promise.resolve()
        order.push('old left')
      },
    )
    const fresh = tab(bus, 'new', () => false)
    const other = await fresh.probe(200)
    expect(await fresh.requestLeave(other!, 500)).toBe(true)
    order.push('new continues')
    expect(order).toEqual(['old left', 'new continues'])
  })

  it('only the addressed tab leaves', async () => {
    const bus = new Bus()
    const a = vi.fn()
    const b = vi.fn()
    tab(bus, 'a', () => true, a)
    tab(bus, 'b', () => true, b)
    const fresh = tab(bus, 'new', () => false)
    expect(await fresh.requestLeave('a', 200)).toBe(true)
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).not.toHaveBeenCalled()
  })

  it('gives up when the other tab never confirms', async () => {
    vi.useFakeTimers()
    const bus = new Bus()
    const fresh = tab(bus, 'new', () => false)
    const result = fresh.requestLeave('gone', 1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(await result).toBe(false)
  })

  it('settles pending waits on close and posts nothing afterwards', async () => {
    const bus = new Bus()
    const fresh = tab(bus, 'new', () => false)
    const pending = fresh.probe(10_000)
    fresh.close()
    expect(await pending).toBeNull()
    expect(await fresh.probe(10)).toBeNull()
  })

  it('ignores malformed and foreign messages', async () => {
    const bus = new Bus()
    const leave = vi.fn()
    tab(bus, 'old', () => true, leave)
    const raw = bus.open()
    raw.postMessage({ type: 'leave', from: 'x', to: 'someone-else' })
    raw.postMessage({ type: 'leave', from: '', to: 'old' })
    raw.postMessage('leave')
    raw.postMessage(null)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(leave).not.toHaveBeenCalled()
  })
})

describe('parsePresenceMessage', () => {
  it('accepts the four message types and rejects anything else', () => {
    expect(parsePresenceMessage({ type: 'hello', from: 'a' })).toEqual({ type: 'hello', from: 'a' })
    expect(parsePresenceMessage({ type: 'here', from: 'a', to: 'b' })).toEqual({ type: 'here', from: 'a', to: 'b' })
    expect(parsePresenceMessage({ type: 'leave', from: 'a', to: 'b', extra: 1 })).toEqual({
      type: 'leave',
      from: 'a',
      to: 'b',
    })
    expect(parsePresenceMessage({ type: 'left', from: 'a' })).toBeNull()
    expect(parsePresenceMessage({ type: 'boom', from: 'a', to: 'b' })).toBeNull()
    expect(parsePresenceMessage({ type: 'hello' })).toBeNull()
    expect(parsePresenceMessage(undefined)).toBeNull()
  })
})
