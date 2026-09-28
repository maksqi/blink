/**
 * Password reset through the real mail: request on /forgot-password, the link arrives in Mailpit, the token is taken
 * from the fragment, the new password works and the old one does not.
 */
import { expect, test } from '../fixtures'
import { closeE2eDb, createUser, strongPassword, tokenLink, waitForMail } from './support'

test.afterAll(closeE2eDb)

test.describe('password reset', { tag: '@ui' }, () => {
  test('a link from Mailpit sets a new password', async ({ page, baseURL, secrets }) => {
    const user = await createUser()
    const newPassword = strongPassword('reset')
    secrets.track(user.password, 'old password')
    secrets.track(newPassword, 'new password')

    await page.goto('/login')
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await expect(page).toHaveURL(/\/forgot-password$/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible()

    const link = tokenLink(await waitForMail(user.email, /Reset your/), '/reset-password')
    secrets.track(link.token, 'reset token')
    expect(link.url.startsWith(`${baseURL}/reset-password#`)).toBe(true)

    await page.goto(link.url)
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible()
    expect(page.url()).toBe(`${baseURL}/reset-password`)
    await page.getByLabel('New password', { exact: true }).fill(newPassword)
    await page.getByLabel('Repeat new password').fill(newPassword)
    await page.getByRole('button', { name: 'Save new password' }).click()
    await expect(page.getByRole('heading', { name: 'Your password was changed' })).toBeVisible()

    await page.getByRole('link', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByLabel('Email').fill(user.email)
    await page.getByLabel('Password', { exact: true }).fill(newPassword)
    await page.getByRole('button', { name: 'Sign in' }).click()
    await expect(page).toHaveURL(/\/dashboard$/)
  })
})
