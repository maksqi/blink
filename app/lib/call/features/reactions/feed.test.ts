import { describe, expect, it } from 'vitest'
import { REACTIONS } from '#shared/schemas/livekit'
import { REACTION_EMOJI, REACTION_LABEL, ReactionFeed } from './feed'

const ana = { identity: 'p_Ana0000000000000', name: 'Ana' }

function feedAt() {
  let clock = 1_000
  const feed = new ReactionFeed({ now: () => clock })
  return { feed, tick: (ms: number) => (clock += ms) }
}

describe('ReactionFeed', () => {
  it('has an emoji and a label for every reaction of the contract', () => {
    for (const reaction of REACTIONS) {
      expect(REACTION_EMOJI[reaction]).toBeTruthy()
      expect(REACTION_LABEL[reaction]).toBeTruthy()
    }
  })

  it('validates bodies', () => {
    const { feed } = feedAt()
    expect(feed.add({ reaction: 'heart' }, ana)?.reaction).toBe('heart')
    expect(feed.add({ reaction: 'poop' }, ana)).toBeNull()
    expect(feed.add('heart', ana)).toBeNull()
    expect(feed.add({ reaction: 'heart', extra: '<img>' }, ana)?.reaction).toBe('heart')
    expect(feed.items).toHaveLength(2)
  })

  it('shows items for 3 s and the latest per sender', () => {
    const { feed, tick } = feedAt()
    feed.add({ reaction: 'clap' }, ana)
    tick(1_000)
    feed.add({ reaction: 'party' }, ana)
    expect(feed.latestOf(ana.identity)?.reaction).toBe('party')
    expect(feed.nextExpiry()).toBe(2_000)
    tick(2_500)
    expect(feed.prune()).toBe(true)
    expect(feed.items.map((i) => i.reaction)).toEqual(['party'])
    tick(1_000)
    expect(feed.latestOf(ana.identity)).toBeNull()
    feed.prune()
    expect(feed.items).toEqual([])
    expect(feed.nextExpiry()).toBeNull()
  })

  it('keeps at most 20 items on screen', () => {
    const { feed } = feedAt()
    for (let i = 0; i < 30; i++) feed.add({ reaction: 'heart' }, { identity: `p_${i}`, name: `N${i}` })
    expect(feed.items).toHaveLength(20)
    expect(feed.items[0]!.name).toBe('N10')
  })

  it('limits each remote sender but not own reactions', () => {
    const { feed } = feedAt()
    const accepted = Array.from({ length: 10 }, () => feed.add({ reaction: 'clap' }, ana) !== null)
    expect(accepted.filter(Boolean)).toHaveLength(6)
    const me = { identity: 'p_Me00000000000000', name: 'Me' }
    expect(Array.from({ length: 10 }, () => feed.add({ reaction: 'clap' }, me, true) !== null).every(Boolean)).toBe(
      true,
    )
  })

  it('spreads consecutive items over different lanes', () => {
    const { feed } = feedAt()
    const lanes = Array.from(
      { length: 5 },
      (_, i) => feed.add({ reaction: 'heart' }, { identity: `p_${i}`, name: 'x' })!.lane,
    )
    expect(new Set(lanes.map((lane) => lane.toFixed(2))).size).toBe(5)
    for (const lane of lanes) expect(lane).toBeGreaterThanOrEqual(0)
  })
})
