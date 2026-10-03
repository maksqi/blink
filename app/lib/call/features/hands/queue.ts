/**
 * Raised-hand queue (pure). The order comes from the server-set `hand` attribute (epoch ms of the first raise; raising
 * again keeps it), ties broken by identity, so every client shows the same queue.
 */
import type { ParticipantView } from '../../../contracts/call'

export type QueueParticipant = Pick<ParticipantView, 'identity' | 'name' | 'handRaisedAt' | 'isLocal'>

export interface QueueEntry<T extends QueueParticipant = QueueParticipant> {
  /** 1-based position in the queue. */
  position: number
  participant: T
}

export function handQueue<T extends QueueParticipant>(participants: readonly T[]): QueueEntry<T>[] {
  return participants
    .filter((p) => p.handRaisedAt !== null)
    .sort(
      (a, b) =>
        (a.handRaisedAt as number) - (b.handRaisedAt as number) ||
        (a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0),
    )
    .map((participant, index) => ({ position: index + 1, participant }))
}

/** 1-based position of `identity`, or null when their hand is down. */
export function queuePosition(queue: readonly QueueEntry[], identity: string | null | undefined): number | null {
  if (!identity) return null
  return queue.find((entry) => entry.participant.identity === identity)?.position ?? null
}

/** Remote participants whose hand went up (or was raised again) since `previous`. */
export function newlyRaised<T extends QueueParticipant>(
  previous: ReadonlyMap<string, number | null>,
  participants: readonly T[],
): T[] {
  return participants.filter(
    (p) => !p.isLocal && p.handRaisedAt !== null && previous.get(p.identity) !== p.handRaisedAt,
  )
}

export function handSnapshot(participants: readonly QueueParticipant[]): Map<string, number | null> {
  return new Map(participants.map((p) => [p.identity, p.handRaisedAt]))
}

export interface HandNotifierOptions {
  /** Minimum gap between two toasts (ms). */
  intervalMs?: number
  now?: () => number
  schedule?: (run: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
  show: (message: string) => void
}

/** "Ana raised their hand", "Ana and Ben raised their hands", "Ana and 2 others raised their hands". */
export function handMessage(names: readonly string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return `${names[0]} raised their hand`
  if (names.length === 2) return `${names[0]} and ${names[1]} raised their hands`
  return `${names[0]} and ${names.length - 1} others raised their hands`
}

/**
 * Moderator toasts for raised hands: at most one toast per interval (5 s). Raises inside the interval are collected and
 * shown as one summary when it ends.
 */
export class HandNotifier {
  private readonly intervalMs: number
  private readonly now: () => number
  private readonly schedule: (run: () => void, delayMs: number) => unknown
  private readonly cancel: (handle: unknown) => void
  private lastShownAt = Number.NEGATIVE_INFINITY
  private pending: string[] = []
  private timer: unknown = null

  constructor(private readonly options: HandNotifierOptions) {
    this.intervalMs = options.intervalMs ?? 5_000
    this.now = options.now ?? Date.now
    this.schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay))
    this.cancel = options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  raised(names: readonly string[]): void {
    if (names.length === 0) return
    for (const name of names) if (!this.pending.includes(name)) this.pending.push(name)
    if (this.timer !== null) return
    const wait = this.lastShownAt + this.intervalMs - this.now()
    if (wait <= 0) this.flush()
    else this.timer = this.schedule(() => this.flush(), wait)
  }

  dispose(): void {
    if (this.timer !== null) this.cancel(this.timer)
    this.timer = null
    this.pending = []
  }

  private flush(): void {
    this.timer = null
    if (this.pending.length === 0) return
    const names = this.pending
    this.pending = []
    this.lastShownAt = this.now()
    this.options.show(handMessage(names))
  }
}
