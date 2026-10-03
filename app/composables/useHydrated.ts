import { useMounted } from '@vueuse/core'

/**
 * False until the component is mounted in the browser, that is until a server-rendered page is hydrated (F-020).
 *
 * Before hydration a form has no JavaScript handler: a click on its submit button or Enter in a field submits it
 * natively, which would put the field values (a password, a meeting link with its key) into a request the app never
 * meant to send. Every form therefore has `method="post"` (never a URL query), and the submit buttons of
 * server-rendered forms stay disabled until hydration, which also blocks the implicit submission on Enter.
 *
 *   const hydrated = useHydrated()
 *   <Button type="submit" :disabled="submitting || !hydrated">
 */
export function useHydrated() {
  return useMounted()
}
