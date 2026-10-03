import { describe, expect, it } from 'vitest'
import { CHAT_MAX_LENGTH } from '#shared/schemas/livekit'
import { ChatLog, clampTimestamp, validateDraft } from './chat-store'

const ana = { identity: 'p_Ana0000000000000', name: 'Ana' }
const ben = { identity: 'p_Ben0000000000000', name: 'Ben' }
const open = { chatEnabled: true, panelOpen: true }
const closed = { chatEnabled: true, panelOpen: false }

function logAt(start = 1_000_000) {
  let clock = start
  const log = new ChatLog({ now: () => clock })
  return { log, tick: (ms: number) => (clock += ms), now: () => clock }
}

describe('ChatLog.receive', () => {
  it('accepts valid messages in arrival order', () => {
    const { log, now } = logAt()
    log.receive({ text: 'first' }, ana, now(), open)
    log.receive({ text: 'second' }, ben, now() - 1_000, open)
    expect(log.messages.map((m) => [m.name, m.text, m.own])).toEqual([
      ['Ana', 'first', false],
      ['Ben', 'second', false],
    ])
  })

  it.each([
    ['a missing body', undefined],
    ['a string body', 'hello'],
    ['an empty text', { text: '' }],
    ['a number', { text: 42 }],
    ['too long', { text: 'x'.repeat(CHAT_MAX_LENGTH + 1) }],
  ])('drops %s', (_label, body) => {
    const { log, now } = logAt()
    expect(log.receive(body, ana, now(), open)).toEqual({ accepted: false, reason: 'invalid' })
    expect(log.messages).toHaveLength(0)
  })

  it('accepts exactly 2000 characters', () => {
    const { log, now } = logAt()
    expect(log.receive({ text: 'x'.repeat(CHAT_MAX_LENGTH) }, ana, now(), open).accepted).toBe(true)
  })

  it('caps each sender at 20 messages per 10 s', () => {
    const { log, tick, now } = logAt()
    for (let i = 0; i < 20; i++) expect(log.receive({ text: `m${i}` }, ana, now(), open).accepted).toBe(true)
    expect(log.receive({ text: 'flood' }, ana, now(), open)).toEqual({ accepted: false, reason: 'rate-limited' })
    // Other senders are unaffected.
    expect(log.receive({ text: 'hi' }, ben, now(), open).accepted).toBe(true)
    tick(10_001)
    expect(log.receive({ text: 'later' }, ana, now(), open).accepted).toBe(true)
  })

  it('keeps at most 500 messages', () => {
    const { log, tick, now } = logAt()
    for (let i = 0; i < 520; i++) {
      log.receive({ text: `m${i}` }, { identity: `p_${i}`, name: `N${i}` }, now(), open)
      tick(1)
    }
    expect(log.messages).toHaveLength(500)
    expect(log.messages[0]!.text).toBe('m20')
    expect(log.messages.at(-1)!.text).toBe('m519')
  })

  it('counts unread messages only while the panel is closed', () => {
    const { log, now } = logAt()
    log.receive({ text: 'a' }, ana, now(), closed)
    log.receive({ text: 'b' }, ana, now(), closed)
    log.receive({ text: 'c' }, ana, now(), open)
    expect(log.unread).toBe(2)
    log.markRead()
    expect(log.unread).toBe(0)
    log.addOwn('mine', ben)
    expect(log.unread).toBe(0)
  })

  it('drops incoming chat while the host turned chat off', () => {
    const { log, now } = logAt()
    expect(log.receive({ text: 'a' }, ana, now(), { chatEnabled: false, panelOpen: false })).toEqual({
      accepted: false,
      reason: 'disabled',
    })
    expect(log.messages).toHaveLength(0)
    expect(log.unread).toBe(0)
  })

  it('clamps the sender clock to the receive time plus or minus 5 minutes', () => {
    const { log, now } = logAt()
    const future = log.receive({ text: 'a' }, ana, now() + 3_600_000, open)
    const past = log.receive({ text: 'b' }, ana, now() - 3_600_000, open)
    const fine = log.receive({ text: 'c' }, ana, now() - 30_000, open)
    expect(future.accepted && future.message.ts).toBe(now() + 300_000)
    expect(past.accepted && past.message.ts).toBe(now() - 300_000)
    expect(fine.accepted && fine.message.ts).toBe(now() - 30_000)
    expect(clampTimestamp(Number.NaN, 5)).toBe(5)
  })
})

describe('own messages', () => {
  it('appends sent and failed messages and removes one for a retry', () => {
    const { log } = logAt()
    const sent = log.addOwn('hello', ana)
    const failed = log.addOwn('lost', ana, 'failed')
    expect(log.messages.map((m) => [m.text, m.own, m.status])).toEqual([
      ['hello', true, 'sent'],
      ['lost', true, 'failed'],
    ])
    expect(log.remove(failed.id)?.text).toBe('lost')
    expect(log.remove('nope')).toBeUndefined()
    expect(log.messages).toEqual([sent])
  })

  it('gives every message a unique id', () => {
    const { log, now } = logAt()
    log.addOwn('a', ana)
    log.receive({ text: 'b' }, ben, now(), open)
    log.addOwn('c', ana)
    expect(new Set(log.messages.map((m) => m.id)).size).toBe(3)
  })
})

describe('validateDraft', () => {
  it('trims and accepts up to 2000 characters', () => {
    expect(validateDraft('  hi there \n')).toEqual({ ok: true, text: 'hi there' })
    expect(validateDraft('x'.repeat(CHAT_MAX_LENGTH))).toEqual({ ok: true, text: 'x'.repeat(CHAT_MAX_LENGTH) })
  })

  it('rejects blank and too long drafts', () => {
    expect(validateDraft('   \n ')).toMatchObject({ ok: false })
    expect(validateDraft('x'.repeat(CHAT_MAX_LENGTH + 1))).toEqual({
      ok: false,
      error: 'Messages can have up to 2000 characters.',
    })
  })
})
