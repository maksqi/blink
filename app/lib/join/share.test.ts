import { describe, expect, it } from 'vitest'
import { mailtoHref, shareTitle } from './share'

describe('mailtoHref', () => {
  it('puts the whole link, fragment included, into the encoded body without a preset recipient', () => {
    const link = 'https://meet.example.com/m/abc-defg-hjk#k=KEY_value-123&t=TOKEN_value'
    const href = mailtoHref(link, 'Team & friends')
    expect(href.startsWith('mailto:?subject=')).toBe(true)
    const url = new URL(href)
    expect(url.pathname).toBe('')
    expect(url.searchParams.get('subject')).toBe('Join "Team & friends" on blinq')
    expect(url.searchParams.get('body')).toContain(link)
    // The fragment of the link is encoded, so the mail app cannot cut it off.
    expect(href).not.toContain('#k=')
  })

  it('titles shared links', () => {
    expect(shareTitle('Standup')).toBe('Join "Standup" on blinq')
  })
})
