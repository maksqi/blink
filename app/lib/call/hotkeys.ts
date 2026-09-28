/**
 * Call hotkeys (pure matcher; `app/composables/call/useCallHotkeys.ts` wires it to the document).
 *
 *   M      toggle microphone        V      toggle camera
 *   Space  push to talk while muted (hold)    ?      keyboard shortcuts
 *
 * - Letters match `event.key` when it is a Latin letter. When the key produces a letter of another script (a Cyrillic
 *   layout types U+044C on the M key), the physical `event.code` (`KeyM`, `KeyV`) is used instead.
 * - Space matches `event.code === 'Space'` only. Repeats are swallowed (preventDefault) while talking, and the release
 *   always ends push to talk, wherever focus went in the meantime. Blur and a hidden page release it too.
 * - Nothing fires in text fields, textareas, selects, contenteditable, open dialogs or menus, during IME composition
 *   or with Ctrl, Alt or Meta (Shift is ignored for letters as well). Space is also left alone on focused controls
 *   that Space activates (buttons, checkboxes, switches, menu items), so keyboard users can still press them.
 */

export type HotkeyAction = 'toggle-mic' | 'toggle-camera' | 'ptt-start' | 'ptt-end' | 'help'

export interface HotkeyTarget {
  /** Upper-case tag name, e.g. `INPUT`. */
  tagName?: string
  isContentEditable?: boolean
  /** ARIA role of the target, if any. */
  role?: string | null
  /** Inside an open dialog, alert dialog or menu. */
  inOverlay?: boolean
}

export interface HotkeyEvent {
  type: 'keydown' | 'keyup'
  key: string
  code: string
  repeat?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  isComposing?: boolean
  keyCode?: number
  target?: HotkeyTarget | null
}

export interface HotkeyResult {
  action: HotkeyAction | null
  preventDefault: boolean
}

const NONE: HotkeyResult = { action: null, preventDefault: false }

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const SPACE_ACTIVATED_TAGS = new Set(['BUTTON', 'A', 'SUMMARY'])
const SPACE_ACTIVATED_ROLES = new Set([
  'button',
  'checkbox',
  'switch',
  'radio',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'tab',
  'slider',
  'combobox',
  'listbox',
  'link',
  'textbox',
  'searchbox',
])

export function isEditableTarget(target: HotkeyTarget | null | undefined): boolean {
  if (!target) return false
  if (target.isContentEditable) return true
  if (target.tagName && EDITABLE_TAGS.has(target.tagName)) return true
  return target.role === 'textbox' || target.role === 'searchbox' || target.role === 'combobox'
}

function spaceActivates(target: HotkeyTarget | null | undefined): boolean {
  if (!target) return false
  if (target.tagName && SPACE_ACTIVATED_TAGS.has(target.tagName)) return true
  return Boolean(target.role && SPACE_ACTIVATED_ROLES.has(target.role))
}

const LATIN_LETTER = /^[a-z]$/i
const ANY_LETTER = /^\p{L}$/u
const KEY_CODE = /^Key([A-Z])$/

/** The Latin letter a key event stands for, or null (see the layout rule above). */
export function letterOf(event: Pick<HotkeyEvent, 'key' | 'code'>): string | null {
  if (LATIN_LETTER.test(event.key)) return event.key.toLowerCase()
  if (ANY_LETTER.test(event.key)) {
    const match = event.code.match(KEY_CODE)
    return match ? match[1]!.toLowerCase() : null
  }
  return null
}

export interface HotkeyContext {
  /** The microphone is currently muted (Space only talks while muted). */
  micMuted: boolean
}

export class HotkeyMatcher {
  private talking = false

  get pushToTalkActive(): boolean {
    return this.talking
  }

  handle(event: HotkeyEvent, context: HotkeyContext): HotkeyResult {
    const isSpace = event.code === 'Space'

    // The release always ends push to talk, even if focus moved into a text field while holding Space.
    if (event.type === 'keyup') {
      if (isSpace && this.talking) {
        this.talking = false
        return { action: 'ptt-end', preventDefault: true }
      }
      return NONE
    }

    if (isSpace && this.talking) return { action: null, preventDefault: true } // auto-repeat while talking
    if (event.isComposing || event.keyCode === 229) return NONE
    if (event.ctrlKey || event.metaKey || event.altKey) return NONE
    if (event.target?.inOverlay || isEditableTarget(event.target)) return NONE

    if (isSpace) {
      if (spaceActivates(event.target) || event.repeat || !context.micMuted) return NONE
      this.talking = true
      return { action: 'ptt-start', preventDefault: true }
    }

    if (event.key === '?' || (event.code === 'Slash' && event.shiftKey)) {
      return event.repeat ? { action: null, preventDefault: true } : { action: 'help', preventDefault: true }
    }

    if (event.shiftKey) return NONE
    const letter = letterOf(event)
    if (letter !== 'm' && letter !== 'v') return NONE
    if (event.repeat) return { action: null, preventDefault: true }
    return { action: letter === 'm' ? 'toggle-mic' : 'toggle-camera', preventDefault: true }
  }

  /** Window blur or a hidden page: stop talking. */
  release(): HotkeyResult {
    if (!this.talking) return NONE
    this.talking = false
    return { action: 'ptt-end', preventDefault: false }
  }
}
