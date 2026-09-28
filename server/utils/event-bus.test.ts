import { describe, expect, it, vi } from 'vitest'
import type { BusEvent } from '../contracts'
import { createEventBus, eventBus, subscribeTo } from './event-bus'

describe('createEventBus', () => {
  it('delivers events to every subscriber in order until unsubscribed', () => {
    const bus = createEventBus()
    const seen: string[] = []
    const offA = bus.subscribe((e) => seen.push(`a:${e.type}`))
    bus.subscribe((e) => seen.push(`b:${e.type}`))
    bus.publish({ type: 'room.state', roomId: 'r1' })
    offA()
    bus.publish({ type: 'user.revoked', userId: 'u1' })
    expect(seen).toEqual(['a:room.state', 'b:room.state', 'b:user.revoked'])
    expect(bus.listenerCount).toBe(1)
  })

  it('isolates failing listeners from the publisher and from each other', async () => {
    const onListenerError = vi.fn()
    const bus = createEventBus({ onListenerError })
    const after = vi.fn()
    bus.subscribe(() => {
      throw new Error('sync failure')
    })
    bus.subscribe(async () => {
      throw new Error('async failure')
    })
    bus.subscribe(after)
    const event: BusEvent = { type: 'lobby.changed', roomId: 'r1' }
    expect(() => bus.publish(event)).not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(after).toHaveBeenCalledWith(event)
    expect(onListenerError).toHaveBeenCalledTimes(2)
  })

  it('tolerates unsubscribing during delivery and duplicate subscriptions', () => {
    const bus = createEventBus()
    const calls: string[] = []
    const listener = () => calls.push('x')
    const off1 = bus.subscribe(listener)
    bus.subscribe(listener)
    const offSelf = bus.subscribe(() => {
      calls.push('self')
      offSelf()
    })
    bus.publish({ type: 'room.state', roomId: 'r' })
    off1()
    bus.publish({ type: 'room.state', roomId: 'r' })
    expect(calls).toEqual(['x', 'x', 'self', 'x'])
  })
})

describe('subscribeTo', () => {
  it('filters by type with a narrowed event', () => {
    const bus = createEventBus()
    const decided: string[] = []
    const off = subscribeTo('lobby.decided', (e) => decided.push(`${e.requestId}:${e.decision}`), bus)
    bus.publish({ type: 'lobby.changed', roomId: 'r1' })
    bus.publish({ type: 'lobby.decided', requestId: 'q1', decision: 'admitted' })
    off()
    bus.publish({ type: 'lobby.decided', requestId: 'q2', decision: 'denied' })
    expect(decided).toEqual(['q1:admitted'])
  })

  it('uses the shared process bus by default', () => {
    expect(eventBus()).toBe(eventBus())
    const seen = vi.fn()
    const off = subscribeTo('user.revoked', seen)
    eventBus().publish({ type: 'user.revoked', userId: 'u9' })
    off()
    expect(seen).toHaveBeenCalledWith({ type: 'user.revoked', userId: 'u9' })
  })
})
