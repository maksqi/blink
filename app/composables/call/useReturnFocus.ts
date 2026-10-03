import { watch, type Ref } from 'vue'

/**
 * Where focus goes back to when a dialog closes. A dialog opened from a menu item would hand focus back to that item,
 * which is gone by then, so focus fell to <body> (F-056): the menu's trigger is used instead (through every nested
 * menu, by `aria-labelledby`), else the element focused when the dialog opened.
 */
export function returnFocusTarget(active: Element | null, doc: Document = document): HTMLElement | null {
  let element: Element | null = active
  for (let depth = 0; element && depth < 5; depth++) {
    const menu = element.closest('[role="menu"]')
    if (!menu) break
    const triggerId = menu.getAttribute('aria-labelledby')
    element = triggerId ? doc.getElementById(triggerId) : null
  }
  if (!element || element === doc.body || !('focus' in element)) return null
  return element as HTMLElement
}

/**
 * For a dialog bound to `open`: remembers the return target when it opens and returns the handler for the dialog
 * content's `@close-auto-focus`, which focuses that target instead of letting the dialog drop focus on <body>.
 */
export function useReturnFocus(open: Readonly<Ref<boolean>>): (event: Event) => void {
  let target: HTMLElement | null = null
  watch(
    open,
    (value) => {
      if (value && typeof document !== 'undefined') target = returnFocusTarget(document.activeElement)
    },
    // Synchronously, from the menu item's select handler, while that item still has focus.
    { flush: 'sync' },
  )
  return (event: Event) => {
    const element = target
    target = null
    if (!element?.isConnected) return
    event.preventDefault()
    element.focus()
  }
}
