/**
 * Typed call event bus (`CallEventBus` from app/lib/contracts/call.ts). Synchronous; a failing handler never stops the
 * others.
 */
import type { CallEventBus, CallEventMap } from '../contracts/call'

type Handler<K extends keyof CallEventMap> = (payload: CallEventMap[K]) => void

export interface DisposableEventBus extends CallEventBus {
  /** Removes every handler (end of the call). */
  clear(): void
}

export function createEventBus(onError: (error: unknown) => void = (error) => console.error(error)): DisposableEventBus {
  const handlers = new Map<keyof CallEventMap, Set<Handler<keyof CallEventMap>>>()

  return {
    on(event, handler) {
      let set = handlers.get(event)
      if (!set) {
        set = new Set()
        handlers.set(event, set)
      }
      set.add(handler as Handler<keyof CallEventMap>)
      return () => {
        set.delete(handler as Handler<keyof CallEventMap>)
      }
    },
    emit(event, payload) {
      const set = handlers.get(event)
      if (!set) return
      for (const handler of [...set]) {
        try {
          handler(payload)
        } catch (error) {
          onError(error)
        }
      }
    },
    clear() {
      handlers.clear()
    },
  }
}
