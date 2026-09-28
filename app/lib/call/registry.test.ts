import { shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { defineCallFeature, type CallContext, type CallFeature, type CallPhase } from '../contracts/call'
import { createEventBus } from './event-bus'
import { buildRegistry, phaseScreenFor, setupFeatures, visibleItems } from './registry'

// Discovered the same way features.ts discovers app/lib/call/features/*/index.ts: adding a folder is all it takes.
const fixtureModules = import.meta.glob<{ default: CallFeature }>('./__fixtures__/features/*/index.ts', { eager: true })

const Stub = { render: () => null }

function context(phase: CallPhase = 'inCall') {
  const events = createEventBus()
  const hints: string[] = []
  events.on('server.hint', ({ type }) => hints.push(type))
  const ctx = { phase: shallowRef<CallPhase>(phase), events } as unknown as CallContext
  return { ctx, hints }
}

describe('buildRegistry', () => {
  it('discovers every feature folder through import.meta.glob', () => {
    const registry = buildRegistry(fixtureModules, { strict: true })
    expect(Object.keys(fixtureModules).sort()).toEqual([
      './__fixtures__/features/alpha/index.ts',
      './__fixtures__/features/beta/index.ts',
    ])
    expect(registry.features.map((f) => f.id)).toEqual(['alpha', 'beta'])
  })

  it('merges and sorts every registry by order across features', () => {
    const registry = buildRegistry(fixtureModules, { strict: true })
    expect(registry.controlBar.map((item) => item.id)).toEqual(['alpha-early', 'beta-button', 'alpha-late'])
    expect(registry.panels.map((item) => item.id)).toEqual(['alpha-panel'])
    expect(registry.tileBadges.map((item) => item.id)).toEqual(['alpha-badge'])
    expect(registry.preJoin.map((item) => item.id)).toEqual(['beta-slot'])
    expect(registry.settings.map((item) => item.id)).toEqual(['beta-settings'])
    expect(registry.phaseScreens.map((item) => item.id)).toEqual(['alpha-ended', 'beta-ended'])
  })

  it('breaks order ties by id so the result is stable', () => {
    const registry = buildRegistry(
      [
        defineCallFeature({ id: 'x', controlBar: [{ id: 'b', order: 1, placement: 'center', component: Stub }] }),
        defineCallFeature({ id: 'y', controlBar: [{ id: 'a', order: 1, placement: 'center', component: Stub }] }),
      ],
      { strict: true },
    )
    expect(registry.controlBar.map((item) => item.id)).toEqual(['a', 'b'])
  })

  it('throws on duplicate feature ids and duplicate item ids in dev', () => {
    const one = defineCallFeature({ id: 'dup' })
    expect(() => buildRegistry([one, defineCallFeature({ id: 'dup' })], { strict: true })).toThrow(
      'Duplicate call feature id "dup"',
    )
    const item = { id: 'same', order: 1, placement: 'center' as const, component: Stub }
    expect(() =>
      buildRegistry(
        [defineCallFeature({ id: 'a', controlBar: [item] }), defineCallFeature({ id: 'b', controlBar: [item] })],
        { strict: true },
      ),
    ).toThrow('Duplicate control bar item id "same"')
  })

  it('warns and keeps the first entry in production', () => {
    const warn = vi.fn()
    const registry = buildRegistry(
      [
        defineCallFeature({ id: 'a', panels: [{ id: 'p', title: 'A', icon: Stub, order: 1, component: Stub }] }),
        defineCallFeature({ id: 'b', panels: [{ id: 'p', title: 'B', icon: Stub, order: 1, component: Stub }] }),
        defineCallFeature({ id: 'a' }),
      ],
      { strict: false, warn },
    )
    expect(registry.panels.map((p) => p.title)).toEqual(['A'])
    expect(registry.features.map((f) => f.id)).toEqual(['a', 'b'])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('rejects a feature folder without a default export', () => {
    expect(() => buildRegistry({ './features/broken/index.ts': {} }, { strict: true })).toThrow('has no default export')
  })
})

describe('setupFeatures', () => {
  it('calls setup once per feature and cleans up in reverse order, once', () => {
    const registry = buildRegistry(fixtureModules, { strict: true })
    const { ctx, hints } = context()
    const cleanup = setupFeatures(registry, ctx)
    expect(hints).toEqual(['alpha.setup', 'beta.setup'])
    cleanup()
    cleanup()
    expect(hints).toEqual(['alpha.setup', 'beta.setup', 'beta.cleanup', 'alpha.cleanup'])
  })

  it('isolates a failing feature', () => {
    const onError = vi.fn()
    const { ctx, hints } = context()
    const registry = buildRegistry(
      [
        defineCallFeature({
          id: 'broken',
          setup: () => {
            throw new Error('boom')
          },
        }),
        ...Object.values(fixtureModules).map((m) => m.default),
      ],
      { strict: true },
    )
    setupFeatures(registry, ctx, onError)()
    expect(onError).toHaveBeenCalledWith(expect.any(Error), 'broken')
    expect(hints).toContain('beta.cleanup')
  })
})

describe('phaseScreenFor', () => {
  it('returns the highest-order screen for a phase', () => {
    const registry = buildRegistry(fixtureModules, { strict: true })
    expect(phaseScreenFor(registry, 'ended')?.id).toBe('beta-ended')
    expect(phaseScreenFor(registry, 'removed')?.id).toBe('alpha-ended')
    expect(phaseScreenFor(registry, 'left')).toBeUndefined()
  })
})

describe('visibleItems', () => {
  it('filters by visible(ctx) and hides items whose predicate throws', () => {
    const registry = buildRegistry(fixtureModules, { strict: true })
    expect(visibleItems(registry.controlBar, context('inCall').ctx).map((i) => i.id)).toEqual([
      'alpha-early',
      'beta-button',
      'alpha-late',
    ])
    expect(visibleItems(registry.controlBar, context('prejoin').ctx).map((i) => i.id)).toEqual([
      'beta-button',
      'alpha-late',
    ])
    const throwing = [
      {
        id: 'x',
        visible: () => {
          throw new Error('nope')
        },
      },
    ]
    expect(visibleItems(throwing, context().ctx)).toEqual([])
  })
})
