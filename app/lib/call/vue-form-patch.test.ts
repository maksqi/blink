/**
 * Guard for `patches/@tanstack__vue-form@1.33.5.patch` (F-037). 1.33.5 mounts the form with `onMounted(formApi.mount)`
 * and drops the cleanup `mount()` returns, so the form-devtools listeners stay registered after unmount and keep the
 * FormApi, its `onSubmit` and the component (with everything it provides, such as the call session) alive. Every
 * RenameDialog in a call leaked that way. pnpm keys the patch by version: after an upgrade this test fails until the
 * new version is checked (and the patch dropped once upstream runs the cleanup).
 */
import { formEventClient, useForm } from '@tanstack/vue-form'
import { createRenderer, defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

/** A renderer without a DOM: enough to run setup, mount and unmount hooks in Node. */
const { createApp } = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  insert: () => undefined,
  remove: () => undefined,
  setText: () => undefined,
  setElementText: () => undefined,
  parentNode: () => null,
  nextSibling: () => null,
  patchProp: () => undefined,
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('@tanstack/vue-form useForm', () => {
  it('removes its devtools listeners when the component unmounts', () => {
    let live = 0
    const on = formEventClient.on.bind(formEventClient)
    vi.spyOn(formEventClient, 'on').mockImplementation(((...args: Parameters<typeof on>) => {
      const off = on(...args)
      live++
      return () => {
        live--
        off()
      }
    }) as typeof on)

    const app = createApp(
      defineComponent({
        setup() {
          useForm({ defaultValues: { name: '' }, onSubmit: () => undefined })
          return () => null
        },
      }),
    )
    app.mount({})
    expect(live).toBeGreaterThan(0)
    app.unmount()
    expect(live).toBe(0)
  })
})
