/**
 * Rules about the app's Vue sources that no type checker sees: checked on the files themselves, so a new page or
 * component cannot quietly break them.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appDir = fileURLToPath(new URL('../../', import.meta.url))
const read = (path: string) => readFileSync(join(appDir, path), 'utf8')

function vueFiles(dir: string): string[] {
  return readdirSync(join(appDir, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.vue'))
    .map((file) => join(dir, file))
}

// F-020: before hydration a form submits natively. A form without a method sends its named fields as a URL query
// (`GET /login?email=…&password=…`, `GET /?link=…%23k%3D<key>`), into the address bar, the history and proxy logs.
describe('forms never put their fields into a URL', () => {
  const sources = [...vueFiles('pages'), ...vueFiles('components'), ...vueFiles('layouts'), 'app.vue', 'error.vue']
    // shadcn primitives render no forms; the call UI lives on the client-only `/m/**` route, so it never runs unhydrated.
    .filter((file) => !file.startsWith(join('components', 'ui')) && !file.startsWith(join('components', 'call')))
    .map((file) => ({ file: relative(appDir, join(appDir, file)), source: read(file) }))

  it('finds the app forms', () => {
    expect(sources.filter(({ source }) => /<form[\s>]/.test(source)).length).toBeGreaterThan(15)
  })

  it('posts every form to its own page and never sets an action', () => {
    for (const { file, source } of sources) {
      for (const [tag] of source.matchAll(/<form(?=[\s>])[^>]*>/g)) {
        expect(tag, file).toMatch(/\smethod="post"/)
        expect(tag, file).not.toMatch(/\saction=|:action=/)
      }
    }
  })

  it('never names the meeting link field, so the room key cannot be part of any submission', () => {
    const landing = read('pages/index.vue')
    const input = landing.match(/<InputGroupInput[^>]*>/)?.[0] ?? ''
    expect(input).toContain('inputmode="url"')
    expect(input).not.toMatch(/\s:?name=/)
  })

  it('keeps the submit buttons of server-rendered sign-in and password forms disabled until hydration', () => {
    for (const file of [
      'pages/index.vue',
      'pages/login.vue',
      'pages/register.vue',
      'pages/forgot-password.vue',
      'pages/reset-password.vue',
      'pages/invite.vue',
      'components/auth/ChangePasswordForm.vue',
      'components/rooms/RoomPasswordForm.vue',
    ]) {
      const source = read(file)
      expect(source, file).toContain('const hydrated = useHydrated()')
      for (const [button] of source.matchAll(/<Button[^>]*type="submit"[^>]*>/g)) {
        expect(button, file).toMatch(/:disabled="[^"]*!hydrated[^"]*"/)
      }
    }
  })
})

// F-045: the room page and the in-call host menu edit the same setting, so they must name its values the same way.
// `hosts` lets hosts and co-hosts share (docs/API.md, canPublishSources).
describe('screen share policy labels', () => {
  it('names the "hosts" policy the same way on the room page and in the call', () => {
    const roomPage = read('components/rooms/RoomSettingsForm.vue')
    const hostMenu = read('components/call/host/HostControlsMenu.vue')
    expect(roomPage).toMatch(/<SelectItem value="hosts">Hosts and co-hosts<\/SelectItem>/)
    expect(hostMenu).toMatch(/<ToggleGroupItem value="hosts"[^>]*>Hosts and co-hosts<\/ToggleGroupItem>/)
    expect(roomPage + hostMenu).not.toMatch(/Hosts only/)
  })
})
