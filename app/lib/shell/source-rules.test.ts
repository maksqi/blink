/**
 * Rules about the app's Vue sources that no type checker sees: checked on the files themselves, so a new page or
 * component cannot quietly break them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8')

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
