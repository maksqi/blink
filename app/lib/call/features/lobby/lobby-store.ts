/**
 * Waiting-room list (pure). `GET /lobby` is the truth; these helpers merge a fetched list into the shown one without
 * reordering or re-creating unchanged rows (stable keys, no flicker), dedupe by `requestId` and order by request time.
 */
import type { LobbyEntry } from '#shared/schemas/calls'

function requestedMs(entry: LobbyEntry): number {
  const ms = Date.parse(entry.requestedAt)
  return Number.isFinite(ms) ? ms : Number.POSITIVE_INFINITY
}

export function compareEntries(a: LobbyEntry, b: LobbyEntry): number {
  return requestedMs(a) - requestedMs(b) || (a.requestId < b.requestId ? -1 : a.requestId > b.requestId ? 1 : 0)
}

function sameEntry(a: LobbyEntry, b: LobbyEntry): boolean {
  return a.requestId === b.requestId && a.displayName === b.displayName && a.kind === b.kind && a.requestedAt === b.requestedAt
}

/**
 * The new list: exactly the fetched entries (deduped by `requestId`, the first wins), ordered by `requestedAt` then
 * `requestId`. Unchanged entries keep their previous object; returns `current` itself when nothing changed.
 */
export function mergeLobby(current: readonly LobbyEntry[], fetched: readonly LobbyEntry[]): LobbyEntry[] {
  const known = new Map(current.map((entry) => [entry.requestId, entry]))
  const seen = new Set<string>()
  const next: LobbyEntry[] = []
  for (const entry of fetched) {
    if (seen.has(entry.requestId)) continue
    seen.add(entry.requestId)
    const previous = known.get(entry.requestId)
    next.push(previous && sameEntry(previous, entry) ? previous : entry)
  }
  next.sort(compareEntries)
  const unchanged = next.length === current.length && next.every((entry, index) => entry === current[index])
  return unchanged ? (current as LobbyEntry[]) : next
}

/** Entries of `next` that `previous` did not have (new people waiting). */
export function addedEntries(previous: readonly LobbyEntry[], next: readonly LobbyEntry[]): LobbyEntry[] {
  const known = new Set(previous.map((entry) => entry.requestId))
  return next.filter((entry) => !known.has(entry.requestId))
}

/** The list without one request (after this moderator decided it). */
export function withoutEntry(list: readonly LobbyEntry[], requestId: string): LobbyEntry[] {
  return list.filter((entry) => entry.requestId !== requestId)
}

/** How many people one toast may name before new arrivals are stacked into a single summary toast. */
export const LOBBY_TOAST_LIMIT = 3

export type LobbyToastPlan =
  | { kind: 'none' }
  | { kind: 'each'; entries: LobbyEntry[] }
  | { kind: 'summary'; count: number }

/**
 * Toasts for new arrivals: one toast with an "Admit" action per new person while at most three people wait, otherwise
 * one summary toast for the whole waiting room.
 */
export function lobbyToastPlan(added: readonly LobbyEntry[], waiting: number): LobbyToastPlan {
  if (added.length === 0) return { kind: 'none' }
  if (waiting > LOBBY_TOAST_LIMIT) return { kind: 'summary', count: waiting }
  return { kind: 'each', entries: [...added] }
}
