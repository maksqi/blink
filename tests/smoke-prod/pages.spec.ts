import { expect, test } from '@playwright/test'
import { watchProblems } from './support'

// The production build renders and hydrates behind Caddy with the production CSP enforced (no bypass here).
test('the login page renders without CSP violations or console errors', async ({ page, context }) => {
  const problems = await watchProblems(context)

  const response = await page.goto('/login')
  expect(response?.status()).toBe(200)
  await expect(page).toHaveTitle(/blinq/)
  // Vue sets __vue_app__ on the root once the client bundle has hydrated it: the nonce-based script chain works.
  await page.waitForFunction(() =>
    Boolean((document.querySelector('#__nuxt') as { __vue_app__?: unknown } | null)?.__vue_app__),
  )
  await page.waitForLoadState('networkidle')

  expect(problems.cspViolations, 'CSP violations').toEqual([])
  expect(problems.errors, 'console errors and uncaught errors').toEqual([])
})
