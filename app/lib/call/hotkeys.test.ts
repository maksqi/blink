import { describe, expect, it } from 'vitest'
import { HotkeyMatcher, isEditableTarget, letterOf, type HotkeyEvent } from './hotkeys'

// Russian (JCUKEN) layout: the physical M key types U+044C, the physical V key types U+043C (which looks like a Latin
// "m" but must toggle the camera). Written with String.fromCodePoint: literal Cyrillic fails check:english.
const CYRILLIC_ON_KEY_M = String.fromCodePoint(0x44c)
const CYRILLIC_ON_KEY_V = String.fromCodePoint(0x43c)
const CYRILLIC_UPPER_ON_KEY_M = String.fromCodePoint(0x42c)

const down = (key: string, code: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  type: 'keydown',
  key,
  code,
  ...extra,
})
const up = (key: string, code: string, extra: Partial<HotkeyEvent> = {}): HotkeyEvent => ({
  type: 'keyup',
  key,
  code,
  ...extra,
})

const muted = { micMuted: true }
const unmuted = { micMuted: false }

describe('letterOf', () => {
  it('uses e.key for Latin letters and e.code for letters of other scripts', () => {
    expect(letterOf({ key: 'm', code: 'KeyM' })).toBe('m')
    expect(letterOf({ key: 'M', code: 'KeyM' })).toBe('m')
    // Dvorak/AZERTY: the Latin key wins over the physical position.
    expect(letterOf({ key: 'v', code: 'Period' })).toBe('v')
    expect(letterOf({ key: CYRILLIC_ON_KEY_M, code: 'KeyM' })).toBe('m')
    expect(letterOf({ key: CYRILLIC_ON_KEY_V, code: 'KeyV' })).toBe('v')
    expect(letterOf({ key: CYRILLIC_UPPER_ON_KEY_M, code: 'KeyM' })).toBe('m')
    // Punctuation on the M position (AZERTY ",") is not a letter.
    expect(letterOf({ key: ',', code: 'KeyM' })).toBeNull()
    expect(letterOf({ key: 'Enter', code: 'Enter' })).toBeNull()
  })
})

describe('HotkeyMatcher', () => {
  it('toggles mic and camera with Latin M and V', () => {
    const matcher = new HotkeyMatcher()
    expect(matcher.handle(down('m', 'KeyM'), unmuted)).toEqual({ action: 'toggle-mic', preventDefault: true })
    expect(matcher.handle(down('M', 'KeyM', { shiftKey: true }), unmuted).action).toBeNull() // Shift+M is not a shortcut
    expect(matcher.handle(down('M', 'KeyM'), unmuted).action).toBe('toggle-mic') // Caps Lock
    expect(matcher.handle(down('v', 'KeyV'), unmuted)).toEqual({ action: 'toggle-camera', preventDefault: true })
    expect(matcher.handle(up('m', 'KeyM'), unmuted)).toEqual({ action: null, preventDefault: false })
  })

  it('works on a Cyrillic layout through e.code', () => {
    const matcher = new HotkeyMatcher()
    expect(matcher.handle(down(CYRILLIC_ON_KEY_M, 'KeyM'), unmuted).action).toBe('toggle-mic')
    expect(matcher.handle(down(CYRILLIC_ON_KEY_V, 'KeyV'), unmuted).action).toBe('toggle-camera')
  })

  it('swallows auto-repeat of letters without toggling again', () => {
    const matcher = new HotkeyMatcher()
    expect(matcher.handle(down('m', 'KeyM', { repeat: true }), unmuted)).toEqual({ action: null, preventDefault: true })
  })

  it('opens help with ?', () => {
    const matcher = new HotkeyMatcher()
    expect(matcher.handle(down('?', 'Slash', { shiftKey: true }), unmuted)).toEqual({ action: 'help', preventDefault: true })
    // A layout where Shift+Slash is not "?" still opens help.
    expect(matcher.handle(down(',', 'Slash', { shiftKey: true }), unmuted).action).toBe('help')
  })

  it('ignores Ctrl, Alt and Meta combinations', () => {
    const matcher = new HotkeyMatcher()
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey'] as const) {
      expect(matcher.handle(down('m', 'KeyM', { [modifier]: true }), unmuted).action).toBeNull()
      expect(matcher.handle(down(' ', 'Space', { [modifier]: true }), muted).action).toBeNull()
    }
    expect(matcher.pushToTalkActive).toBe(false)
  })

  it('ignores text fields, contenteditable, dialogs and menus', () => {
    const matcher = new HotkeyMatcher()
    for (const target of [
      { tagName: 'INPUT' },
      { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' },
      { tagName: 'DIV', isContentEditable: true },
      { tagName: 'DIV', role: 'textbox' },
      { tagName: 'BUTTON', inOverlay: true },
    ]) {
      expect(matcher.handle(down('m', 'KeyM', { target }), unmuted).action).toBeNull()
      expect(matcher.handle(down('?', 'Slash', { shiftKey: true, target }), unmuted).action).toBeNull()
      expect(matcher.handle(down(' ', 'Space', { target }), muted)).toEqual({ action: null, preventDefault: false })
    }
    expect(isEditableTarget({ tagName: 'BODY' })).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })

  it('ignores IME composition', () => {
    const matcher = new HotkeyMatcher()
    expect(matcher.handle(down('m', 'KeyM', { isComposing: true }), unmuted).action).toBeNull()
    expect(matcher.handle(down('Process', 'KeyM', { keyCode: 229 }), unmuted).action).toBeNull()
    expect(matcher.handle(down(' ', 'Space', { isComposing: true }), muted).action).toBeNull()
  })

  describe('push to talk', () => {
    it('talks while Space is held and the mic is muted', () => {
      const matcher = new HotkeyMatcher()
      expect(matcher.handle(down(' ', 'Space'), muted)).toEqual({ action: 'ptt-start', preventDefault: true })
      expect(matcher.pushToTalkActive).toBe(true)
      // Repeats are swallowed; the mic is live (unmuted) in between.
      for (let i = 0; i < 5; i++) {
        expect(matcher.handle(down(' ', 'Space', { repeat: true }), unmuted)).toEqual({ action: null, preventDefault: true })
      }
      expect(matcher.handle(up(' ', 'Space'), unmuted)).toEqual({ action: 'ptt-end', preventDefault: true })
      expect(matcher.pushToTalkActive).toBe(false)
    })

    it('matches the physical Space key, whatever character it types', () => {
      const matcher = new HotkeyMatcher()
      expect(matcher.handle(down('\u3000', 'Space'), muted).action).toBe('ptt-start')
      expect(matcher.handle(down(' ', 'Numpad0'), muted).action).toBeNull()
    })

    it('does nothing while the mic is already on', () => {
      const matcher = new HotkeyMatcher()
      expect(matcher.handle(down(' ', 'Space'), unmuted)).toEqual({ action: null, preventDefault: false })
      expect(matcher.handle(up(' ', 'Space'), unmuted)).toEqual({ action: null, preventDefault: false })
    })

    it('does not start from a repeat event', () => {
      const matcher = new HotkeyMatcher()
      expect(matcher.handle(down(' ', 'Space', { repeat: true }), muted).action).toBeNull()
    })

    it('leaves Space to focused buttons and switches', () => {
      const matcher = new HotkeyMatcher()
      expect(matcher.handle(down(' ', 'Space', { target: { tagName: 'BUTTON' } }), muted).action).toBeNull()
      expect(matcher.handle(down(' ', 'Space', { target: { tagName: 'DIV', role: 'switch' } }), muted).action).toBeNull()
      // Letters still work on a focused button.
      expect(matcher.handle(down('m', 'KeyM', { target: { tagName: 'BUTTON' } }), muted).action).toBe('toggle-mic')
    })

    it('ends on release even when focus moved into a text field', () => {
      const matcher = new HotkeyMatcher()
      matcher.handle(down(' ', 'Space'), muted)
      expect(matcher.handle(up(' ', 'Space', { target: { tagName: 'INPUT' } }), unmuted).action).toBe('ptt-end')
    })

    it('ends on blur or when the page is hidden', () => {
      const matcher = new HotkeyMatcher()
      matcher.handle(down(' ', 'Space'), muted)
      expect(matcher.release()).toEqual({ action: 'ptt-end', preventDefault: false })
      expect(matcher.pushToTalkActive).toBe(false)
      expect(matcher.release()).toEqual({ action: null, preventDefault: false })
      // The late keyup after a blur does nothing.
      expect(matcher.handle(up(' ', 'Space'), muted).action).toBeNull()
    })
  })
})
