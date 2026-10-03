import { describe, expect, it, vi } from 'vitest'
import { createCallActions, failureMessage, type CallApi } from './actions'

interface Call {
  path: string
  method: string
  body?: unknown
}

class FakeApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code)
  }
}

function setup(respond: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = []
  const callApi = (async (path: string, options?: { method?: string; body?: unknown }) => {
    const call = { path, method: options?.method ?? 'GET', ...(options?.body === undefined ? {} : { body: options.body }) }
    calls.push(call)
    const result = respond(call)
    if (result instanceof Error) throw result
    return result
  }) as CallApi
  const notify = vi.fn<(message: string) => void>()
  const onChanged = vi.fn()
  const onTargetGone = vi.fn()
  const onLobbyStale = vi.fn()
  const actions = createCallActions(callApi, { notify, onChanged, onTargetGone, onLobbyStale })
  return { actions, calls, notify, onChanged, onTargetGone, onLobbyStale }
}

const tara = { identity: 'p_Tara000000000000', name: 'Tara' }

describe('createCallActions', () => {
  it('builds every route and body from the shared schemas', async () => {
    const { actions, calls } = setup((call) => {
      if (call.path === '/participants' || call.path === '/lobby') return { items: [] }
      if (call.path === '/lobby/admit-all') return { admitted: 2 }
      if (call.path === '/settings') return { state: { locked: true } }
      return undefined
    })
    await actions.renameSelf('  New   Name ')
    await actions.setHand(true)
    await actions.participants()
    await actions.lobby()
    await actions.admit('req/1')
    await actions.deny('req-2')
    await actions.admitAll()
    await actions.mute(tara, 'screen_share')
    await actions.setPermissions(tara, { microphone: false })
    await actions.askUnmute(tara)
    await actions.setVolume(tara, 24.6)
    await actions.remove(tara)
    await actions.setRole(tara, 'cohost')
    await actions.rename(tara, 'Tara B.')
    await actions.lowerHand(tara)
    await actions.muteAll(true)
    await actions.updateSettings({ chatEnabled: false })
    await actions.end()
    expect(calls).toEqual([
      { path: '/me/name', method: 'POST', body: { displayName: 'New Name' } },
      { path: '/me/hand', method: 'POST', body: { raised: true } },
      { path: '/participants', method: 'GET' },
      { path: '/lobby', method: 'GET' },
      { path: '/lobby/req%2F1/admit', method: 'POST' },
      { path: '/lobby/req-2/deny', method: 'POST' },
      { path: '/lobby/admit-all', method: 'POST' },
      { path: '/participants/p_Tara000000000000/mute', method: 'POST', body: { source: 'screen_share' } },
      { path: '/participants/p_Tara000000000000/permissions', method: 'POST', body: { microphone: false } },
      { path: '/participants/p_Tara000000000000/ask-unmute', method: 'POST' },
      { path: '/participants/p_Tara000000000000/volume', method: 'POST', body: { level: 25 } },
      { path: '/participants/p_Tara000000000000/remove', method: 'POST' },
      { path: '/participants/p_Tara000000000000/role', method: 'POST', body: { role: 'cohost' } },
      { path: '/participants/p_Tara000000000000/name', method: 'POST', body: { displayName: 'Tara B.' } },
      { path: '/participants/p_Tara000000000000/lower-hand', method: 'POST' },
      { path: '/mute-all', method: 'POST', body: { preventSelfUnmute: true } },
      { path: '/settings', method: 'PATCH', body: { chatEnabled: false } },
      { path: '/end', method: 'POST' },
    ])
  })

  it('returns values and refetches allowances after changes', async () => {
    const { actions, onChanged } = setup((call) => (call.path === '/lobby/admit-all' ? { admitted: 3 } : undefined))
    expect(await actions.mute(tara, 'microphone')).toEqual({ ok: true, value: undefined })
    expect(onChanged).toHaveBeenCalledTimes(1)
    expect(await actions.admitAll()).toEqual({ ok: true, value: { admitted: 3 } })
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('rejects invalid input before any request', async () => {
    const { actions, calls, notify } = setup()
    const result = await actions.setVolume(tara, 150)
    expect(result.ok).toBe(false)
    expect(calls).toEqual([])
    expect(notify).toHaveBeenCalledTimes(1)
    expect((await actions.renameSelf('   ')).ok).toBe(false)
  })

  it('maps error codes to the shared English messages', async () => {
    const { actions, notify } = setup(() => new FakeApiError(403, 'CALL_FORBIDDEN'))
    expect(await actions.remove(tara)).toEqual({ ok: false, code: 'CALL_FORBIDDEN', status: 403 })
    expect(notify).toHaveBeenCalledWith('Only the host or a co-host can do that.')
    expect(failureMessage('NETWORK')).toBe('Network error. Check your connection.')
    expect(failureMessage('SOMETHING_ELSE')).toBe('Something went wrong on the server.')
  })

  it('treats 404 on a target as "they left" and refetches', async () => {
    const { actions, notify, onTargetGone } = setup(() => new FakeApiError(404, 'NOT_FOUND'))
    await actions.lowerHand(tara)
    expect(notify).toHaveBeenCalledWith('Tara already left the meeting.')
    expect(onTargetGone).toHaveBeenCalledTimes(1)
  })

  it('only refetches when another moderator decided a lobby request first', async () => {
    for (const [status, code] of [
      [404, 'NOT_FOUND'],
      [409, 'CONFLICT'],
    ] as const) {
      const { actions, notify, onLobbyStale } = setup(() => new FakeApiError(status, code))
      expect((await actions.admit('r1')).ok).toBe(false)
      expect(notify).not.toHaveBeenCalled()
      expect(onLobbyStale).toHaveBeenCalledTimes(1)
    }
    const { actions, notify } = setup(() => new FakeApiError(409, 'ROOM_FULL'))
    await actions.admit('r1')
    expect(notify).toHaveBeenCalledWith('This meeting is full.')
  })

  it('keeps reads quiet', async () => {
    const { actions, notify } = setup(() => new FakeApiError(403, 'CALL_NOT_PARTICIPANT'))
    expect((await actions.participants()).ok).toBe(false)
    expect((await actions.lobby()).ok).toBe(false)
    expect(notify).not.toHaveBeenCalled()
  })

  it('allows to speak in order: microphone, lower hand, ask to unmute', async () => {
    const { actions, calls, onChanged } = setup()
    expect((await actions.allowToSpeak(tara)).ok).toBe(true)
    expect(calls.map((c) => [c.path, c.body])).toEqual([
      ['/participants/p_Tara000000000000/permissions', { microphone: true }],
      ['/participants/p_Tara000000000000/lower-hand', undefined],
      ['/participants/p_Tara000000000000/ask-unmute', undefined],
    ])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it('stops allowing to speak at the first failure', async () => {
    const { actions, calls } = setup((call) => (call.path.endsWith('/lower-hand') ? new FakeApiError(404, 'NOT_FOUND') : undefined))
    expect((await actions.allowToSpeak(tara)).ok).toBe(false)
    expect(calls).toHaveLength(2)
  })
})
