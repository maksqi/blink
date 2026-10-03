import { describe, expect, it } from 'vitest'
import { linkify, safeHref, stripBidiControls, type ChatSegment } from './linkify'

const links = (segments: ChatSegment[]) => segments.filter((s) => s.kind === 'link')
const joined = (segments: ChatSegment[]) => segments.map((s) => s.text).join('')

describe('linkify', () => {
  it('keeps plain text as one segment', () => {
    expect(linkify('hello world')).toEqual([{ kind: 'text', text: 'hello world' }])
    expect(linkify('')).toEqual([])
  })

  it('links http and https URLs and keeps the surrounding text', () => {
    expect(linkify('see https://example.com/a?b=1#c and http://x.test')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'link', text: 'https://example.com/a?b=1#c', href: 'https://example.com/a?b=1#c' },
      { kind: 'text', text: ' and ' },
      { kind: 'link', text: 'http://x.test', href: 'http://x.test/' },
    ])
  })

  it('accepts mixed-case schemes and normalizes the href', () => {
    const [link] = links(linkify('HtTpS://Example.COM/Path'))
    expect(link).toEqual({ kind: 'link', text: 'HtTpS://Example.COM/Path', href: 'https://example.com/Path' })
  })

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(document.cookie)',
    'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
    'vbscript:msgbox(1)',
    'VBScript:MsgBox(1)',
    'file:///etc/passwd',
    'ftp://example.com',
    '//example.com',
    'www.example.com',
  ])('never links %s', (input) => {
    const segments = linkify(input)
    expect(links(segments)).toEqual([])
    expect(joined(segments)).toBe(input)
  })

  it('does not start a link inside a word', () => {
    expect(links(linkify('xhttps://evil.test'))).toEqual([])
    expect(links(linkify('javascript://https://ok.test')).map((l) => l.href)).toEqual(['https://ok.test/'])
  })

  it('stops at quotes and angle brackets (an HTML payload stays text)', () => {
    const input = 'https://a.b/"><img src=x onerror=alert(1)>'
    const segments = linkify(input)
    expect(links(segments)).toEqual([{ kind: 'link', text: 'https://a.b/', href: 'https://a.b/' }])
    expect(joined(segments)).toBe(input)
    expect(segments.at(-1)).toEqual({ kind: 'text', text: '"><img src=x onerror=alert(1)>' })
  })

  it('renders script tags as text', () => {
    expect(linkify('<script>window.__xss = 1</script>')).toEqual([
      { kind: 'text', text: '<script>window.__xss = 1</script>' },
    ])
  })

  it('trims trailing punctuation', () => {
    for (const tail of ['.', ',', '!', '?', ':', ';', '...', ').', ']']) {
      const segments = linkify(`go to https://example.com/x${tail}`)
      expect(links(segments)).toEqual([{ kind: 'link', text: 'https://example.com/x', href: 'https://example.com/x' }])
      expect(joined(segments)).toBe(`go to https://example.com/x${tail}`)
    }
  })

  it('keeps balanced closing brackets inside the URL', () => {
    expect(links(linkify('(see https://en.wikipedia.org/wiki/Foo_(bar))')).map((l) => l.text)).toEqual([
      'https://en.wikipedia.org/wiki/Foo_(bar)',
    ])
  })

  it('skips candidates the URL parser rejects or that have no host', () => {
    expect(links(linkify('http://'))).toEqual([])
    expect(links(linkify('https://[not-an-ip]/'))).toEqual([])
    expect(safeHref('https:///path')).toBe('https://path/')
    expect(safeHref('mailto:a@b.test')).toBeNull()
  })

  it('removes bidi override and isolate controls', () => {
    const rlo = '\u202E'
    const isolate = '\u2066'
    const input = `invoice ${rlo}fdp.exe and https://a.test/${isolate}x`
    const segments = linkify(input)
    expect(joined(segments)).toBe('invoice fdp.exe and https://a.test/x')
    expect(links(segments).map((l) => l.href)).toEqual(['https://a.test/x'])
    expect(stripBidiControls('\u202A\u202B\u202C\u202D\u202E\u2066\u2067\u2068\u2069ok')).toBe('ok')
    // Other format characters (e.g. the zero-width joiner in emoji) stay.
    expect(stripBidiControls('a\u200Db')).toBe('a\u200Db')
  })

  it('keeps line breaks and spacing for pre-wrap rendering', () => {
    expect(joined(linkify('line 1\n  line 2 https://a.test\nend'))).toBe('line 1\n  line 2 https://a.test\nend')
  })

  it('handles a 2000-character input in linear time', () => {
    const inputs = [
      'h'.repeat(2000),
      'https://'.repeat(250),
      `https://a.b/${')'.repeat(1988)}`,
      `https://a.b/${'('.repeat(994)}${')'.repeat(994)}`,
      `${'https://a.test/x '.repeat(117)}`.slice(0, 2000),
      '.'.repeat(2000),
    ]
    const started = performance.now()
    for (let round = 0; round < 50; round++) for (const input of inputs) linkify(input)
    // 300 runs over 2000 characters; a quadratic implementation takes seconds here.
    expect(performance.now() - started).toBeLessThan(1_000)
    expect(links(linkify(inputs[4]!)).length).toBe(117)
  })
})
