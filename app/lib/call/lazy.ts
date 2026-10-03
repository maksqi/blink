/**
 * Call-feature components that pre-join does not show (panels, dialogs, menus, tile badges, end screens) are loaded on
 * demand, so the pre-join download stays small (F-043). `preloadCallComponents()` fetches them all at the Join click,
 * so the call view never waits for them.
 */
import { defineAsyncComponent, type Component } from 'vue'

type Loader = () => Promise<{ default: Component }>

const loaders: Loader[] = []

/** A call-view component from a feature registry, loaded on first render (or by `preloadCallComponents`). */
export function lazyCallComponent(loader: Loader): Component {
  loaders.push(loader)
  return defineAsyncComponent(loader)
}

/** Fetches every lazy call component now. Never rejects (a failed chunk fails again where it is rendered). */
export function preloadCallComponents(): Promise<void> {
  return Promise.allSettled(loaders.map((load) => load())).then(() => undefined)
}
