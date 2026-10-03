// @vitest-environment happy-dom
import { nextTick, shallowRef } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { returnFocusTarget, useReturnFocus } from './useReturnFocus'

afterEach(() => {
  document.body.replaceChildren()
})

function element(tag: string, attributes: Record<string, string>, parent: HTMLElement = document.body): HTMLElement {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value)
  parent.append(el)
  return el
}

/** A "More options" trigger and its menus, as reka-ui renders them: each menu is labelled by its trigger. */
function menuWithItem() {
  const trigger = element('button', { id: 'more-trigger', 'aria-label': 'More options' })
  const menu = element('div', { role: 'menu', 'aria-labelledby': 'more-trigger' })
  const item = element('div', { role: 'menuitem', tabindex: '-1', id: 'settings-item' }, menu)
  element('div', { role: 'menuitem', tabindex: '-1', id: 'sub-trigger' }, menu)
  const submenu = element('div', { role: 'menu', 'aria-labelledby': 'sub-trigger' })
  const nested = element('div', { role: 'menuitem', tabindex: '-1', id: 'nested-item' }, submenu)
  return { trigger, menu, item, nested }
}

describe('returnFocusTarget (F-056)', () => {
  it('returns the trigger of the menu a focused item sits in, through nested menus', () => {
    const { trigger, item, nested } = menuWithItem()
    expect(returnFocusTarget(item)).toBe(trigger)
    expect(returnFocusTarget(nested)).toBe(trigger)
  })

  it('returns a focused element outside menus itself, and nothing for <body>', () => {
    const { trigger } = menuWithItem()
    expect(returnFocusTarget(trigger)).toBe(trigger)
    expect(returnFocusTarget(document.body)).toBeNull()
    expect(returnFocusTarget(null)).toBeNull()
  })
})

describe('useReturnFocus', () => {
  it('focuses the menu trigger when the dialog closes, after the menu item is gone', async () => {
    const { trigger, menu, item } = menuWithItem()
    const open = shallowRef(false)
    const onCloseAutoFocus = useReturnFocus(open)
    item.focus()
    open.value = true
    // The menu closes and its items unmount while the dialog is open.
    menu.remove()
    open.value = false
    await nextTick()
    const event = new Event('focus.autoFocusOnUnmount', { cancelable: true })
    onCloseAutoFocus(event)
    expect(event.defaultPrevented).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('leaves the default alone when the target is gone', () => {
    const { item } = menuWithItem()
    const open = shallowRef(false)
    const onCloseAutoFocus = useReturnFocus(open)
    item.focus()
    open.value = true
    document.body.replaceChildren()
    open.value = false
    const event = new Event('focus.autoFocusOnUnmount', { cancelable: true })
    onCloseAutoFocus(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
