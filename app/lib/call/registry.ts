/**
 * Call feature registries. A feature is a folder `app/lib/call/features/<feature>/index.ts` whose default export is a
 * `defineCallFeature({...})`; `features.ts` discovers them with `import.meta.glob`, so adding a feature never edits
 * core files. This module is the pure part: sorting, duplicate checks, setup/cleanup and phase-screen lookup.
 */
import type {
  CallContext,
  CallFeature,
  CallPhase,
  ControlBarItem,
  PhaseScreen,
  PreJoinSlot,
  SettingsSection,
  SidePanel,
  TileBadge,
} from '../contracts/call'

export interface CallRegistry {
  features: CallFeature[]
  controlBar: ControlBarItem[]
  panels: SidePanel[]
  tileBadges: TileBadge[]
  preJoin: PreJoinSlot[]
  settings: SettingsSection[]
  phaseScreens: PhaseScreen[]
}

export interface BuildRegistryOptions {
  /** Throw on duplicate ids (dev and tests); otherwise warn and keep the first. */
  strict: boolean
  warn?: (message: string) => void
}

type FeatureModules = Record<string, { default?: CallFeature } | CallFeature | undefined>

function isFeature(value: unknown): value is CallFeature {
  return typeof value === 'object' && value !== null && typeof (value as CallFeature).id === 'string'
}

function featureOf(module: { default?: CallFeature } | CallFeature | undefined): CallFeature | undefined {
  if (!module) return undefined
  if ('default' in module && isFeature(module.default)) return module.default
  return isFeature(module) ? module : undefined
}

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id)

/**
 * Builds the registries from glob modules (`{ './features/x/index.ts': { default: feature } }`) or a feature list.
 * Features are ordered by path so the result does not depend on discovery order.
 */
export function buildRegistry(modules: FeatureModules | CallFeature[], options: BuildRegistryOptions): CallRegistry {
  const warn = options.warn ?? ((message: string) => console.warn(message))
  const fail = (message: string) => {
    if (options.strict) throw new Error(message)
    warn(message)
  }

  const entries: Array<[string, CallFeature | undefined]> = Array.isArray(modules)
    ? modules.map((feature, index) => [String(index).padStart(4, '0'), feature])
    : Object.keys(modules)
        .sort()
        .map((path) => [path, featureOf(modules[path])])

  const features: CallFeature[] = []
  const featureIds = new Set<string>()
  for (const [path, feature] of entries) {
    if (!feature) {
      fail(`Call feature ${path} has no default export from defineCallFeature()`)
      continue
    }
    if (featureIds.has(feature.id)) {
      fail(`Duplicate call feature id "${feature.id}" (${path})`)
      continue
    }
    featureIds.add(feature.id)
    features.push(feature)
  }

  function collect<T extends { id: string; order: number }>(
    kind: string,
    pick: (feature: CallFeature) => T[] | undefined,
  ): T[] {
    const ids = new Set<string>()
    const items: T[] = []
    for (const feature of features) {
      for (const item of pick(feature) ?? []) {
        if (ids.has(item.id)) {
          fail(`Duplicate ${kind} id "${item.id}" in call feature "${feature.id}"`)
          continue
        }
        ids.add(item.id)
        items.push(item)
      }
    }
    return items.sort(byOrder)
  }

  return {
    features,
    controlBar: collect('control bar item', (f) => f.controlBar),
    panels: collect('side panel', (f) => f.panels),
    tileBadges: collect('tile badge', (f) => f.tileBadges),
    preJoin: collect('pre-join slot', (f) => f.preJoin),
    settings: collect('settings section', (f) => f.settings),
    phaseScreens: collect('phase screen', (f) => f.phaseScreens),
  }
}

/**
 * Calls every feature's `setup(ctx)` once and returns one cleanup for all of them (run in reverse order). A failing
 * feature is reported and skipped; it never breaks the call.
 */
export function setupFeatures(
  registry: Pick<CallRegistry, 'features'>,
  ctx: CallContext,
  onError: (error: unknown, featureId: string) => void = (error) => console.error(error),
): () => void {
  const cleanups: Array<{ id: string; run: () => void }> = []
  for (const feature of registry.features) {
    if (!feature.setup) continue
    try {
      const cleanup = feature.setup(ctx)
      if (typeof cleanup === 'function') cleanups.push({ id: feature.id, run: cleanup })
    } catch (error) {
      onError(error, feature.id)
    }
  }
  let done = false
  return () => {
    if (done) return
    done = true
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup.run()
      } catch (error) {
        onError(error, cleanup.id)
      }
    }
  }
}

/** The phase screen for `phase`: the highest order wins. */
export function phaseScreenFor(
  registry: Pick<CallRegistry, 'phaseScreens'>,
  phase: CallPhase,
): PhaseScreen | undefined {
  let best: PhaseScreen | undefined
  for (const screen of registry.phaseScreens) {
    if (screen.phases.includes(phase) && (!best || screen.order >= best.order)) best = screen
  }
  return best
}

/** Items whose `visible(ctx)` passes (a throwing predicate hides the item). */
export function visibleItems<T extends { visible?: (ctx: CallContext) => boolean }>(
  items: readonly T[],
  ctx: CallContext,
): T[] {
  return items.filter((item) => {
    if (!item.visible) return true
    try {
      return item.visible(ctx)
    } catch {
      return false
    }
  })
}
