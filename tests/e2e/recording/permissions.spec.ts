import { expect, test } from '../fixtures'

// DoD (docs/stages/08-recording.md): guests and participants cannot record: no record button, and their direct API
// calls answer 403 RECORDING_NOT_ALLOWED. A guest promoted to co-host still cannot (recording needs an account).
test.describe.configure({ timeout: 120_000 })

const START = { mode: 'server', mimeType: 'video/webm;codecs=vp8,opus', width: 1280, height: 720 }

test('participants and guests get no record button and a 403 from the API', async ({ recordingCall, rooms }) => {
  const { room, host } = await recordingCall.open()
  const participant = await recordingCall.join(room, host.account, { name: 'Pat Participant' })
  const guest = await recordingCall.join(room, host.account, { name: 'Gus Guest', guest: true })

  // The host's button proves the config is loaded and the control bar is complete.
  await expect(host.page.getByTestId('record-button')).toBeVisible()
  for (const member of [participant, guest]) {
    await expect(member.page.getByTestId('control-bar')).toBeVisible()
    await expect(member.page.getByTestId('record-button')).toHaveCount(0)
  }

  for (const member of [participant.join, guest.join]) {
    const start = await rooms.callApi(member, room, 'POST', '/recording/start', START)
    expect(start.status).toBe(403)
    expect((start.body as { data: { code: string } }).data.code).toBe('RECORDING_NOT_ALLOWED')
    const local = await rooms.callApi(member, room, 'POST', '/recording/start', { mode: 'local' })
    expect(local.status).toBe(403)
    const stop = await rooms.callApi(member, room, 'POST', '/recording/stop')
    expect(stop.status).toBe(403)
    expect((stop.body as { data: { code: string } }).data.code).toBe('RECORDING_NOT_ALLOWED')
  }

  // A guest co-host: moderator in the call, but without an account.
  const promote = await rooms.callApi(host.account, room, 'POST', `/participants/${guest.identity}/role`, {
    role: 'cohost',
  })
  expect(promote.status).toBe(204)
  await expect
    .poll(() =>
      guest.page.evaluate(() => {
        const call = (
          window as unknown as {
            __blinqTest?: { state: { call?: { participants: Array<{ isLocal: boolean; role: string }> } } }
          }
        ).__blinqTest?.state.call
        return call?.participants.find((p) => p.isLocal)?.role
      }),
    )
    .toBe('cohost')
  await expect(guest.page.getByTestId('record-button')).toHaveCount(0)
  const asCohost = await rooms.callApi(guest.join, room, 'POST', '/recording/start', START)
  expect(asCohost.status).toBe(403)
  expect((asCohost.body as { data: { code: string } }).data.code).toBe('RECORDING_NOT_ALLOWED')

  // Nothing was recorded: the host still sees an idle record button and no indicator.
  await expect(host.page.getByTestId('record-button')).toHaveAttribute('data-state', 'idle')
  await expect(host.page.getByTestId('recording-indicator')).toHaveCount(0)
})
