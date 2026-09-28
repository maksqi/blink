import { onBeforeUnmount, onMounted, toValue, type MaybeRefOrGetter } from 'vue'
import { HotkeyMatcher, type HotkeyAction, type HotkeyTarget } from '~/lib/call/hotkeys'

export interface CallHotkeyHandlers {
  /** Current mic state (Space talks only while muted). */
  micMuted: () => boolean
  onAction: (action: HotkeyAction) => void
  /** Hotkeys are off while false (e.g. before joining). */
  enabled?: MaybeRefOrGetter<boolean>
}

function describeTarget(target: EventTarget | null): HotkeyTarget | null {
  if (!(target instanceof Element)) return null
  const element = target as HTMLElement
  return {
    tagName: element.tagName,
    isContentEditable: element.isContentEditable,
    role: element.getAttribute('role'),
    inOverlay: Boolean(element.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')),
  }
}

/**
 * Wires the pure hotkey matcher (app/lib/call/hotkeys.ts) to the document: M, V, Space (push to talk while muted), ?.
 * Push to talk is released on window blur and when the page becomes hidden.
 */
export function useCallHotkeys(handlers: CallHotkeyHandlers): void {
  const matcher = new HotkeyMatcher()

  const onKey = (event: KeyboardEvent) => {
    if (handlers.enabled !== undefined && !toValue(handlers.enabled) && !matcher.pushToTalkActive) return
    const result = matcher.handle(
      {
        type: event.type === 'keyup' ? 'keyup' : 'keydown',
        key: event.key,
        code: event.code,
        repeat: event.repeat,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
        isComposing: event.isComposing,
        keyCode: event.keyCode,
        target: describeTarget(event.target),
      },
      { micMuted: handlers.micMuted() },
    )
    if (result.preventDefault) event.preventDefault()
    if (result.action) handlers.onAction(result.action)
  }
  const release = () => {
    const result = matcher.release()
    if (result.action) handlers.onAction(result.action)
  }
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') release()
  }

  onMounted(() => {
    document.addEventListener('keydown', onKey)
    document.addEventListener('keyup', onKey)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', onVisibility)
  })
  onBeforeUnmount(() => {
    release()
    document.removeEventListener('keydown', onKey)
    document.removeEventListener('keyup', onKey)
    window.removeEventListener('blur', release)
    document.removeEventListener('visibilitychange', onVisibility)
  })
}
