import { expect, findLeaks, test, watchContext } from '../fixtures/base'

// Self-tests of the global guards in fixtures/base.ts. They record into their own collectors, so the deliberate
// violations and errors below never fail the surrounding test.
test.describe('E2E guards', { tag: '@ui' }, () => {
  test('secret scanning flags secret shapes and tracked values, never redacted ones', () => {
    // Built at runtime, so the repository never contains a JWT literal (gitleaks would report it).
    const jwt = [{ alg: 'HS256' }, { sub: 'e2e-self-test' }, 'signature-self-test']
      .map((part) => Buffer.from(JSON.stringify(part)).toString('base64url'))
      .join('.')
    const kinds = (text: string, tracked?: Map<string, string>) => findLeaks(text, tracked).map((leak) => leak.kind)

    expect(kinds(`"uri":"/rtc/v1?access_token=${jwt}"`)).toEqual([
      'JWT (LiveKit, webhook or other token)',
      'access_token parameter',
    ])
    expect(kinds('join link /m/abcdefghijkl#k=q1w2e3r4t5y6u7i8o9p0')).toEqual(['room key fragment (#k=)'])
    expect(kinds('"url":"/dev/call#url=ws\\u0026k=q1w2e3r4t5y6u7i8o9p0"')).toEqual(['room key fragment (#k=)'])
    expect(kinds('mail link http://localhost:8080/invite#q1w2e3r4t5y6u7i8o9p0')).toEqual(['link token fragment'])
    expect(kinds('cookie: blinq_session=abc123def456')).toEqual(['session or guest cookie'])
    expect(kinds('cookie: __Host-blinq_g_abcdefghij=abc123def456')).toEqual(['session or guest cookie'])
    expect(kinds('authorization: Bearer abcdefghijklmnop.qrstuv')).toEqual(['bearer token'])
    expect(kinds('{"email":"a@example.test","password":"hunter2hunter2"}')).toEqual(['password field'])

    // Redacted forms are fine.
    expect(kinds('"uri":"/rtc/v1?access_token=REDACTED\\u0026auto_subscribe=0"')).toEqual([])
    expect(kinds('"Cookie":["REDACTED"],"Set-Cookie":["REDACTED"]')).toEqual([])
    expect(kinds('{"password":"[redacted]","newPassword":"***"}')).toEqual([])
    expect(kinds('GET /m/abcdefghijkl 200 sdk=js&version=2.22.3')).toEqual([])

    // Tracked values are found raw, URL-encoded and JSON-escaped.
    const password = 'correct "horse" battery&staple'
    const tracked = new Map([[password, 'password']])
    expect(kinds(`raw ${password}`, tracked)).toEqual(['tracked password'])
    expect(kinds(`body=${encodeURIComponent(password)}`, tracked)).toEqual(['tracked password'])
    expect(kinds(`{"note":${JSON.stringify(password)}}`, tracked)).toEqual(['tracked password'])

    // Reports never repeat the secret, in any of its forms.
    const logged = `token=${jwt} raw=${password} form=${encodeURIComponent(password)} json=${JSON.stringify(password)}`
    const leaks = findLeaks(logged, tracked)
    expect(leaks.length).toBeGreaterThan(0)
    for (const { excerpt } of leaks) {
      expect(excerpt).toBe('token=<masked> raw=<masked> form=<masked> json="<masked>"')
    }
  })

  test('CSP violations, console errors and uncaught errors are recorded', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL })
    try {
      const recorder = await watchContext(context)
      const page = await context.newPage()
      await page.goto('/')
      await page.evaluate(() => {
        // An inline event handler, as an XSS payload would use: blocked by script-src-attr 'none'.
        const target = document.createElement('button')
        target.setAttribute('onclick', 'window.name = "should not run"')
        document.body.append(target)
        target.click()
        // A cross-origin image: blocked by img-src before any request is made.
        const image = document.createElement('img')
        image.src = 'https://blocked.example.invalid/pixel.png'
        document.body.append(image)
        console.error('guard self-test: console error')
        setTimeout(() => {
          throw new Error('guard self-test: uncaught error')
        })
      })
      const directives = () => recorder.cspViolations.map((violation) => violation.effectiveDirective)
      await expect.poll(directives).toContain('img-src')
      expect(directives().some((directive) => directive.startsWith('script-src'))).toBe(true)
      expect(await page.evaluate(() => window.name)).not.toBe('should not run')
      await expect
        .poll(() => recorder.problems.map((p) => `${p.kind}: ${p.text}`).join('\n'))
        .toContain('console: guard self-test: console error')
      await expect
        .poll(() => recorder.problems.map((p) => p.text).join('\n'))
        .toContain('guard self-test: uncaught error')
    } finally {
      await context.close()
    }
  })
})
