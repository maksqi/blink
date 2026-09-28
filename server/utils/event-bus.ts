/**
 * In-process event bus implementing `EventBus` from server/contracts (server-core).
 *
 * - `eventBus()`: the process-wide instance. `eventBus().publish({ type: 'lobby.changed', roomId })`.
 * - `subscribeTo(type, listener)`: typed subscription to one event type; returns the unsubscribe function.
 * - `createEventBus()`: isolated instances for tests.
 * Delivery is synchronous, in subscription order, over a snapshot of listeners (unsubscribing during delivery is
 * safe). A throwing or rejecting listener is logged and never affects the publisher or other listeners.
 */
import type { BusEvent, EventBus } from '../contracts'
import { logger } from './logger'

export interface InProcessEventBus extends EventBus {
  readonly listenerCount: number
}

export interface EventBusOptions {
  onListenerError?: (error: unknown, event: BusEvent) => void
}

export function createEventBus(options: EventBusOptions = {}): InProcessEventBus {
  const listeners = new Set<(event: BusEvent) => void>()
  const onError =
    options.onListenerError ??
    ((error: unknown, event: BusEvent) => logger.error('event bus listener failed', { type: event.type, err: error }))

  return {
    publish(event) {
      for (const listener of [...listeners]) {
        try {
          const result: unknown = listener(event)
          if (result instanceof Promise) result.catch((error: unknown) => onError(error, event))
        } catch (error) {
          onError(error, event)
        }
      }
    },
    subscribe(listener) {
      // Wrap so the same function can be subscribed twice and unsubscribed independently.
      const entry = (event: BusEvent) => listener(event)
      listeners.add(entry)
      return () => {
        listeners.delete(entry)
      }
    },
    get listenerCount() {
      return listeners.size
    },
  }
}

let shared: InProcessEventBus | undefined

export function eventBus(): InProcessEventBus {
  shared ??= createEventBus()
  return shared
}

export function subscribeTo<T extends BusEvent['type']>(
  type: T,
  listener: (event: Extract<BusEvent, { type: T }>) => void,
  bus: EventBus = eventBus(),
): () => void {
  // Returning the listener's result lets the bus catch rejections of async listeners.
  return bus.subscribe((event) => (event.type === type ? listener(event as Extract<BusEvent, { type: T }>) : undefined))
}
