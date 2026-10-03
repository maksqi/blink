import { describe, expect, it } from 'vitest'
import {
  computeSubscriptions,
  DEFAULT_PIXEL_BUDGET,
  MIN_BUDGET_WIDTH,
  type PolicyInput,
  type PolicyPublication,
  type SubscriptionDecision,
  type TileRequest,
} from './subscription-policy'

function pub(identity: string, source: PolicyPublication['source'], encrypted = true): PolicyPublication {
  const kind = source === 'microphone' || source === 'screen_share_audio' ? 'audio' : 'video'
  return { trackSid: `TR_${identity}_${source}`, identity, kind, source, encrypted }
}

function tile(identity: string, width: number, height: number, extra: Partial<TileRequest> = {}): TileRequest {
  return { identity, source: 'camera', width, height, visible: true, ...extra }
}

function input(overrides: Partial<PolicyInput>): PolicyInput {
  return { publications: [], tiles: [], documentVisible: true, demands: [], localEncrypted: true, ...overrides }
}

function decision(plan: { decisions: SubscriptionDecision[] }, identity: string, source: string) {
  const found = plan.decisions.find((d) => d.identity === identity && d.source === source)
  if (!found) throw new Error(`no decision for ${identity}/${source}`)
  return found
}

describe('computeSubscriptions', () => {
  describe('unencrypted publications', () => {
    it('are never subscribed, whatever tiles or demands ask for', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_mallory', 'camera', false), pub('p_mallory', 'microphone', false)],
          tiles: [tile('p_mallory', 1920, 1080, { priority: true })],
          demands: [{ identity: 'p_mallory', source: 'camera', width: 1280, height: 720 }],
        }),
      )
      for (const source of ['camera', 'microphone']) {
        expect(decision(plan, 'p_mallory', source)).toMatchObject({ subscribed: false, enabled: false, blocked: true })
        expect(decision(plan, 'p_mallory', source).width).toBeUndefined()
      }
      expect(plan.blockedIdentities).toEqual(['p_mallory'])
    })

    it('block only the offending publication and participant', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_alice', 'camera'), pub('p_alice', 'microphone'), pub('p_bob', 'screen_share', false)],
          tiles: [tile('p_alice', 640, 360), tile('p_bob', 1280, 720, { source: 'screen_share', priority: true })],
        }),
      )
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({ subscribed: true, enabled: true, blocked: false })
      expect(decision(plan, 'p_alice', 'microphone')).toMatchObject({ subscribed: true, enabled: true })
      expect(decision(plan, 'p_bob', 'screen_share')).toMatchObject({ subscribed: false, blocked: true })
      expect(plan.blockedIdentities).toEqual(['p_bob'])
    })

    it('never produces a subscribed decision for NONE in any combination of inputs', () => {
      const publications = [
        pub('p_a', 'camera', false),
        pub('p_a', 'screen_share', false),
        pub('p_a', 'microphone', false),
      ]
      for (const documentVisible of [true, false]) {
        for (const localEncrypted of [true, false]) {
          for (const withTiles of [true, false]) {
            const plan = computeSubscriptions(
              input({
                publications,
                documentVisible,
                localEncrypted,
                tiles: withTiles ? [tile('p_a', 800, 450), tile('p_a', 800, 450, { source: 'screen_share' })] : [],
                demands: [{ identity: 'p_a', source: 'screen_share', width: 1920, height: 1080 }],
              }),
            )
            expect(plan.decisions.every((d) => !d.subscribed && !d.enabled && d.blocked)).toBe(true)
          }
        }
      }
    })
  })

  describe('participants with one unencrypted publication (F-015)', () => {
    // livekit-client keeps one decrypt flag per participant: a single NONE publication turns decryption off for the
    // participant's encrypted tracks too, so none of them may stay subscribed.
    const mixed = [pub('p_x', 'camera'), pub('p_x', 'microphone'), pub('p_x', 'screen_share', false)]

    it('block every publication of that participant, encrypted ones included', () => {
      const plan = computeSubscriptions(
        input({
          publications: [...mixed, pub('p_alice', 'camera'), pub('p_alice', 'microphone')],
          tiles: [tile('p_x', 1280, 720, { priority: true }), tile('p_alice', 640, 360)],
          demands: [{ identity: 'p_x', source: 'camera', width: 1280, height: 720 }],
        }),
      )
      for (const source of ['camera', 'microphone', 'screen_share']) {
        expect(decision(plan, 'p_x', source)).toMatchObject({ subscribed: false, enabled: false, blocked: true })
      }
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({ subscribed: true, enabled: true, blocked: false })
      expect(decision(plan, 'p_alice', 'microphone')).toMatchObject({ subscribed: true, blocked: false })
      expect(plan.blockedIdentities).toEqual(['p_x'])
    })

    it('stay blocked once the unencrypted publication is gone (untrusted)', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_x', 'camera'), pub('p_x', 'microphone'), pub('p_alice', 'microphone')],
          tiles: [tile('p_x', 640, 360)],
          untrusted: ['p_x'],
        }),
      )
      expect(decision(plan, 'p_x', 'camera')).toMatchObject({ subscribed: false, blocked: true })
      expect(decision(plan, 'p_x', 'microphone')).toMatchObject({ subscribed: false, blocked: true })
      expect(decision(plan, 'p_alice', 'microphone')).toMatchObject({ subscribed: true, blocked: false })
      expect(plan.blockedIdentities).toEqual(['p_x'])
    })

    it('report an untrusted participant without publications as blocked', () => {
      const plan = computeSubscriptions(input({ publications: [pub('p_alice', 'camera')], untrusted: new Set(['p_x']) }))
      expect(plan.blockedIdentities).toEqual(['p_x'])
      expect(decision(plan, 'p_alice', 'camera').blocked).toBe(false)
    })
  })

  it('subscribes to nothing when this client does not encrypt', () => {
    const plan = computeSubscriptions(
      input({
        localEncrypted: false,
        publications: [pub('p_alice', 'camera'), pub('p_alice', 'microphone')],
        tiles: [tile('p_alice', 640, 360)],
      }),
    )
    expect(plan.decisions.every((d) => !d.subscribed && !d.blocked)).toBe(true)
  })

  it('keeps audio flowing everywhere, including background tabs', () => {
    const plan = computeSubscriptions(
      input({
        documentVisible: false,
        publications: [pub('p_alice', 'microphone'), pub('p_alice', 'screen_share_audio')],
      }),
    )
    expect(decision(plan, 'p_alice', 'microphone')).toMatchObject({ subscribed: true, enabled: true })
    expect(decision(plan, 'p_alice', 'screen_share_audio')).toMatchObject({ subscribed: true, enabled: true })
  })

  describe('video visibility', () => {
    const publications = [pub('p_alice', 'camera'), pub('p_bob', 'camera'), pub('p_carol', 'camera')]

    it('pauses tiles on other pages (not rendered) and tiles outside the viewport', () => {
      const plan = computeSubscriptions(
        input({ publications, tiles: [tile('p_alice', 640, 360), tile('p_bob', 640, 360, { visible: false })] }),
      )
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({
        subscribed: true,
        enabled: true,
        width: 640,
        height: 360,
      })
      expect(decision(plan, 'p_bob', 'camera')).toMatchObject({ subscribed: true, enabled: false })
      expect(decision(plan, 'p_carol', 'camera')).toMatchObject({ subscribed: true, enabled: false })
      expect(decision(plan, 'p_carol', 'camera').width).toBeUndefined()
    })

    it('pauses every video while the document is hidden', () => {
      const plan = computeSubscriptions(
        input({ publications, documentVisible: false, tiles: [tile('p_alice', 640, 360)] }),
      )
      expect(plan.decisions.every((d) => d.subscribed && !d.enabled)).toBe(true)
    })

    it('ignores zero-sized and invalid tiles', () => {
      const plan = computeSubscriptions(
        input({ publications, tiles: [tile('p_alice', 0, 0), tile('p_bob', Number.NaN, 100)] }),
      )
      expect(decision(plan, 'p_alice', 'camera').enabled).toBe(false)
      expect(decision(plan, 'p_bob', 'camera').enabled).toBe(false)
    })
  })

  describe('sizes', () => {
    it('requests the tile size, so small tiles ask for 320 px or less (lowest simulcast layer)', () => {
      const plan = computeSubscriptions(
        input({ publications: [pub('p_alice', 'camera')], tiles: [tile('p_alice', 284, 160)] }),
      )
      const alice = decision(plan, 'p_alice', 'camera')
      expect(alice.width).toBeLessThanOrEqual(320)
      expect(alice).toMatchObject({ width: 284, height: 160 })
    })

    it('uses the largest tile when a participant is rendered twice', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_alice', 'camera')],
          tiles: [tile('p_alice', 200, 112), tile('p_alice', 1200, 675)],
        }),
      )
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({ width: 1200, height: 675 })
    })

    it('matches screen-share tiles to screen-share publications only', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_alice', 'camera'), pub('p_alice', 'screen_share')],
          tiles: [tile('p_alice', 1600, 900, { source: 'screen_share', priority: true }), tile('p_alice', 240, 135)],
        }),
      )
      expect(decision(plan, 'p_alice', 'screen_share')).toMatchObject({ enabled: true, width: 1600, height: 900 })
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({ enabled: true, width: 240, height: 135 })
    })
  })

  describe('priority and budget', () => {
    const many = Array.from({ length: 25 }, (_, i) => `p_${String(i).padStart(2, '0')}`)

    it('scales ordinary tiles into the budget but keeps pinned and screen-share tiles at full size', () => {
      const publications = [...many.map((id) => pub(id, 'camera')), pub('p_presenter', 'screen_share')]
      const tiles = [
        ...many.map((id, i) => tile(id, 1000, 562, { priority: i === 0 })),
        tile('p_presenter', 2400, 1350, { source: 'screen_share', priority: true }),
      ]
      const plan = computeSubscriptions(input({ publications, tiles }))

      expect(decision(plan, 'p_presenter', 'screen_share')).toMatchObject({ width: 2400, height: 1350 })
      expect(decision(plan, many[0]!, 'camera')).toMatchObject({ width: 1000, height: 562 })

      const ordinary = many.slice(1).map((id) => decision(plan, id, 'camera'))
      const pixels = ordinary.reduce((sum, d) => sum + d.width! * d.height!, 0)
      expect(pixels).toBeLessThanOrEqual(DEFAULT_PIXEL_BUDGET * 1.01)
      for (const d of ordinary) {
        expect(d.width).toBeLessThan(1000)
        expect(d.width).toBeGreaterThanOrEqual(MIN_BUDGET_WIDTH)
        expect(Math.abs(d.width! / d.height! - 1000 / 562)).toBeLessThan(0.02)
      }
    })

    it('leaves sizes alone within the budget', () => {
      const plan = computeSubscriptions(
        input({
          publications: many.slice(0, 4).map((id) => pub(id, 'camera')),
          tiles: many.slice(0, 4).map((id) => tile(id, 640, 360)),
        }),
      )
      expect(plan.decisions.every((d) => d.width === 640 && d.height === 360)).toBe(true)
    })

    it('honors a custom budget', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_a', 'camera'), pub('p_b', 'camera')],
          tiles: [tile('p_a', 1280, 720), tile('p_b', 1280, 720)],
          pixelBudget: 640 * 360 * 2,
        }),
      )
      expect(decision(plan, 'p_a', 'camera')).toMatchObject({ width: 640, height: 360 })
    })
  })

  describe('demands', () => {
    it('keep off-page and background video flowing at the demanded size', () => {
      const plan = computeSubscriptions(
        input({
          documentVisible: false,
          publications: [pub('p_alice', 'camera'), pub('p_bob', 'camera')],
          demands: [{ identity: 'p_alice', source: 'camera', width: 384, height: 216 }],
        }),
      )
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({
        subscribed: true,
        enabled: true,
        width: 384,
        height: 216,
      })
      expect(decision(plan, 'p_bob', 'camera').enabled).toBe(false)
    })

    it('combine with tiles by taking the larger size and are not scaled by the budget', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_alice', 'camera'), pub('p_alice', 'screen_share')],
          tiles: [tile('p_alice', 200, 112)],
          demands: [
            { identity: 'p_alice', source: 'camera', width: 384, height: 216 },
            { identity: 'p_alice', source: 'screen_share', width: 1920, height: 1080 },
          ],
          pixelBudget: 1,
        }),
      )
      expect(decision(plan, 'p_alice', 'camera')).toMatchObject({ width: 384, height: 216 })
      expect(decision(plan, 'p_alice', 'screen_share')).toMatchObject({ enabled: true, width: 1920, height: 1080 })
    })

    it('ignore invalid sizes', () => {
      const plan = computeSubscriptions(
        input({
          publications: [pub('p_alice', 'camera')],
          demands: [{ identity: 'p_alice', source: 'camera', width: 0, height: 0 }],
        }),
      )
      expect(decision(plan, 'p_alice', 'camera').enabled).toBe(false)
    })
  })

  it('returns decisions in a stable order', () => {
    const publications = [
      pub('p_b', 'microphone'),
      pub('p_a', 'camera'),
      pub('p_b', 'camera'),
      pub('p_a', 'microphone'),
    ]
    const a = computeSubscriptions(input({ publications }))
    const b = computeSubscriptions(input({ publications: [...publications].reverse() }))
    expect(a.decisions.map((d) => d.trackSid)).toEqual(b.decisions.map((d) => d.trackSid))
  })
})
