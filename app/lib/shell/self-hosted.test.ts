import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The shadcn-vue CLI (components.json "font": "inter") likes to re-insert a Google Fonts @import. Everything must stay
// self-hosted: CSP allows fonts and styles from 'self' only.
describe('app stylesheet', () => {
  const css = readFileSync(new URL('../../assets/css/tailwind.css', import.meta.url), 'utf8')

  it('loads nothing from another origin', () => {
    expect(css).not.toMatch(/googleapis|gstatic/i)
    expect(css).not.toMatch(/@import\s+url\(\s*['"]?(https?:)?\/\//i)
    expect(css).not.toMatch(/url\(\s*['"]?(https?:)?\/\//i)
  })

  it('uses the self-hosted Inter variable font', () => {
    expect(css).toContain('@import "@fontsource-variable/inter";')
    expect(css).toMatch(/--font-sans:\s*'Inter Variable'/)
  })
})
