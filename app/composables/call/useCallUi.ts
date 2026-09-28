import { inject, provide, shallowRef, type InjectionKey, type ShallowRef } from 'vue'

/** UI state shared by the call view and its controls (dialogs, the open side panel). Provided by `<CallView>`. */
export interface CallUi {
  settingsOpen: ShallowRef<boolean>
  hotkeysOpen: ShallowRef<boolean>
  safetyCodeOpen: ShallowRef<boolean>
  /** Id of the open side panel, or null. */
  panel: ShallowRef<string | null>
  /** Set by the host page when it can rejoin (terminal phase screens offer "Rejoin"). */
  rejoin: ShallowRef<(() => void) | null>
}

const CALL_UI_KEY: InjectionKey<CallUi> = Symbol('blinq:call-ui')

export function provideCallUi(): CallUi {
  const ui: CallUi = {
    settingsOpen: shallowRef(false),
    hotkeysOpen: shallowRef(false),
    safetyCodeOpen: shallowRef(false),
    panel: shallowRef(null),
    rejoin: shallowRef(null),
  }
  provide(CALL_UI_KEY, ui)
  return ui
}

/** Dialog and panel state of the surrounding `<CallView>` (a detached default outside it). */
export function useCallUi(): CallUi {
  return (
    inject(CALL_UI_KEY, null) ?? {
      settingsOpen: shallowRef(false),
      hotkeysOpen: shallowRef(false),
      safetyCodeOpen: shallowRef(false),
      panel: shallowRef(null),
      rejoin: shallowRef(null),
    }
  )
}
