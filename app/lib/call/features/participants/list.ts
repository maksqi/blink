/**
 * Participants panel list (pure): sections and search.
 *
 * Sections: raised hands (the queue, ordered by raise time), then the host, co-hosts and everyone else by name. People
 * with a raised hand also stay in their role section, so nobody disappears from the list while waiting to speak.
 */
import type { ParticipantView } from '../../../contracts/call'
import { handQueue, type QueueEntry } from '../hands/queue'

export type SectionId = 'hands' | 'host' | 'cohosts' | 'others'

export type ListParticipant = Pick<ParticipantView, 'identity' | 'name' | 'role' | 'isLocal' | 'handRaisedAt'>

export interface ParticipantSections<T extends ListParticipant = ListParticipant> {
  hands: QueueEntry<T>[]
  host: T[]
  cohosts: T[]
  others: T[]
}

/** Search form of a text: NFKC, trimmed, case-folded. */
export function searchKey(text: string): string {
  return text.normalize('NFKC').trim().toLocaleLowerCase()
}

/** People whose name contains the query (case-insensitive, NFKC-normalized, trimmed); everyone for an empty query. */
export function filterParticipants<T extends ListParticipant>(participants: readonly T[], query: string): T[] {
  const needle = searchKey(query)
  if (!needle) return [...participants]
  return participants.filter((p) => searchKey(p.name).includes(needle))
}

export function compareByName(a: ListParticipant, b: ListParticipant): number {
  return (
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
    a.name.localeCompare(b.name) ||
    (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0)
  )
}

export function sortParticipants<T extends ListParticipant>(participants: readonly T[]): ParticipantSections<T> {
  const byName = [...participants].sort(compareByName)
  return {
    hands: handQueue(participants),
    host: byName.filter((p) => p.role === 'host'),
    cohosts: byName.filter((p) => p.role === 'cohost'),
    others: byName.filter((p) => p.role === 'participant'),
  }
}
