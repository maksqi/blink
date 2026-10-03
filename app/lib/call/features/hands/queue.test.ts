import { describe, expect, it } from 'vitest'
import {
  handMessage,
  HandNotifier,
  handQueue,
  handSnapshot,
  newlyRaised,
  queuePosition,
  type QueueParticipant,
} from './queue'

const p = (identity: string, handRaisedAt: number | null, isLocal = false): QueueParticipant => ({
  identity,
  name: identity.toUpperCase(),
  handRaisedAt,
  isLocal,
})

describe('handQueue', () => {
  it('orders raised hands by raise time', () => {
    const queue = handQueue([p('c', 300), p('a', 100), p('x', null), p('b', 200)])
    expect(queue.map((e) => [e.position, e.participant.identity])).toEqual([
      [1, 'a'],
      [2, 'b'],
      [3, 'c'],
    ])
  })

  it('breaks ties by identity', () => {
    expect(handQueue([p('p_b', 5), p('p_a', 5), p('p_c', 4)]).map((e) => e.participant.identity)).toEqual([
      'p_c',
      'p_a',
      'p_b',
    ])
  })

  it('drops lowered hands and moves later people up', () => {
    const before = handQueue([p('a', 1), p('b', 2), p('c', 3)])
    expect(queuePosition(before, 'c')).toBe(3)
    const after = handQueue([p('a', null), p('b', 2), p('c', 3)])
    expect(after.map((e) => e.participant.identity)).toEqual(['b', 'c'])
    expect(queuePosition(after, 'c')).toBe(2)
    expect(queuePosition(after, 'a')).toBeNull()
    expect(queuePosition(after, null)).toBeNull()
  })

  it('puts a re-raised hand at the end (the server sets a new time)', () => {
    const queue = handQueue([p('a', 900), p('b', 2), p('c', 3)])
    expect(queue.map((e) => e.participant.identity)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate its input', () => {
    const input = [p('b', 2), p('a', 1)]
    handQueue(input)
    expect(input.map((x) => x.identity)).toEqual(['b', 'a'])
  })
})

describe('newlyRaised', () => {
  it('reports remote hands that went up since the snapshot', () => {
    const before = handSnapshot([p('a', null), p('b', 2), p('me', null, true)])
    const now = [p('a', 5), p('b', 2), p('c', 7), p('me', 9, true)]
    expect(newlyRaised(before, now).map((x) => x.identity)).toEqual(['a', 'c'])
  })
})

describe('HandNotifier', () => {
  function setup() {
    let clock = 0
    const shown: string[] = []
    const timers: Array<{ at: number; run: () => void }> = []
    const notifier = new HandNotifier({
      now: () => clock,
      schedule: (run, delay) => {
        const timer = { at: clock + delay, run }
        timers.push(timer)
        return timer
      },
      cancel: (handle) => timers.splice(timers.indexOf(handle as (typeof timers)[number]), 1),
      show: (message) => shown.push(message),
    })
    const advance = (ms: number) => {
      clock += ms
      for (const timer of timers.splice(0).filter((t) => t.at <= clock)) timer.run()
    }
    return { notifier, shown, advance, timers }
  }

  it('shows the first raise at once and summarizes raises inside 5 s', () => {
    const { notifier, shown, advance } = setup()
    notifier.raised(['Ana'])
    expect(shown).toEqual(['Ana raised their hand'])
    advance(1_000)
    notifier.raised(['Ben'])
    notifier.raised(['Cleo', 'Dan'])
    expect(shown).toHaveLength(1)
    advance(4_000)
    expect(shown).toEqual(['Ana raised their hand', 'Ben and 2 others raised their hands'])
  })

  it('shows again right away after a quiet interval', () => {
    const { notifier, shown, advance } = setup()
    notifier.raised(['Ana'])
    advance(6_000)
    notifier.raised(['Ben'])
    expect(shown).toEqual(['Ana raised their hand', 'Ben raised their hand'])
  })

  it('drops pending toasts on dispose', () => {
    const { notifier, shown, advance, timers } = setup()
    notifier.raised(['Ana'])
    notifier.raised(['Ben'])
    notifier.dispose()
    expect(timers).toHaveLength(0)
    advance(10_000)
    expect(shown).toEqual(['Ana raised their hand'])
  })

  it('formats messages', () => {
    expect(handMessage([])).toBe('')
    expect(handMessage(['Ana', 'Ben'])).toBe('Ana and Ben raised their hands')
  })
})
