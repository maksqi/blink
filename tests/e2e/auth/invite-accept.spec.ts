/**
 * Accepting an account invite from its link: the token is taken from the fragment (never sent in a URL), the bound
 * email is read-only, the account is created and signed in.
 */
import { eq } from 'drizzle-orm'
import { userInvites } from '../../../server/database/schema'
import { expect, test } from '../fixtures'
import { closeE2eDb, createInvite, e2eDb, strongPassword, uniqueEmail } from './support'

test.afterAll(closeE2eDb)

test.describe('account invite', { tag: '@ui' }, () => {
  test('a bound invite creates the account and signs it in', async ({ page, baseURL, secrets }) => {
    const email = uniqueEmail('invited')
    const invite = await createInvite({ email })
    const password = strongPassword('invited')
    secrets.track(invite.token, 'invite token')
    secrets.track(password, 'password')
    const urls: string[] = []
    page.on('request', (request) => urls.push(request.url()))

    await page.goto(`/invite#${invite.token}`)
    await expect(page.getByRole('heading', { name: 'Accept your invite' })).toBeVisible()
    expect(page.url()).toBe(`${baseURL}/invite`)
    const emailField = page.getByLabel('Email')
    await expect(emailField).toHaveValue(email)
    await expect(emailField).toHaveAttribute('readonly', '')

    await page.getByLabel('Your name').fill('Invited Person')
    await page.getByLabel('Password', { exact: true }).fill(password)
    await page.getByRole('button', { name: 'Create account' }).click()

    await expect(page).toHaveURL(/\/dashboard$/)
    await expect(page.getByTestId('user-menu')).toBeVisible()
    const [row] = await e2eDb().select().from(userInvites).where(eq(userInvites.id, invite.id))
    expect(row!.usedAt).not.toBeNull()
    expect(urls.filter((url) => url.includes(invite.token))).toEqual([])
  })
})
