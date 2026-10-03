/**
 * Admin users: an admin creates an account in the UI, the temporary password is shown once, and that person must
 * change it at the first sign-in. The detail sheet refuses to remove the own account.
 */
import { randomUUID } from 'node:crypto'
import { expect, test } from '../fixtures'

test.describe('admin users', { tag: '@ui' }, () => {
  test('creates a user who must change the temporary password', async ({ page, browser, baseURL, rooms, guards, secrets }) => {
    const admin = await rooms.createUser({ role: 'admin', displayName: 'Ada Admin' })
    await rooms.useIdentity(page.context(), admin)
    await page.goto('/admin/users')
    await expect(page.getByRole('heading', { name: 'Users' })).toBeVisible()

    await page.getByTestId('create-user').click()
    const dialog = page.getByTestId('create-user-dialog')
    const email = `e2e-created-${randomUUID()}@example.test`
    await dialog.getByLabel('Email', { exact: true }).fill(email)
    await dialog.getByLabel('Display name').fill('Cora Created')
    await dialog.getByTestId('create-user-submit').click()

    const secret = dialog.getByTestId('temp-password')
    await expect(secret).toBeVisible()
    const password = await secret.inputValue()
    secrets.track(password, 'temporary password')
    expect(password).toMatch(/^\S{16}$/)
    await dialog.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    // The list shows the new account with a pending password change.
    await page.getByLabel('Search users').fill(email)
    const row = page.getByTestId('user-row').filter({ hasText: email })
    await expect(row).toBeVisible()

    // The new person signs in with the temporary password and has to choose a new one first.
    const context = await browser.newContext({ baseURL })
    await guards.watch(context)
    try {
      const person = await context.newPage()
      await person.goto('/login')
      await person.getByLabel('Email').fill(email)
      await person.getByLabel('Password', { exact: true }).fill(password)
      await person.getByRole('button', { name: 'Sign in' }).click()
      await expect(person).toHaveURL(/\/change-password/)
    } finally {
      await context.close()
    }

    // Reopen the account: the admin can see the forced change.
    await row.getByTestId('manage-user').click()
    const sheet = page.getByTestId('user-sheet')
    await expect(sheet).toContainText('Password change pending')
  })

  test('the own account cannot be disabled or deleted', async ({ page, rooms }) => {
    const admin = await rooms.createUser({ role: 'admin', displayName: `Self ${randomUUID().slice(0, 8)}` })
    await rooms.useIdentity(page.context(), admin)
    await page.goto('/admin/users')
    await page.getByLabel('Search users').fill(admin.email)
    await page.getByTestId('user-row').filter({ hasText: admin.email }).getByTestId('manage-user').click()
    const sheet = page.getByTestId('user-sheet')
    await expect(sheet).toContainText('You cannot disable your own account.')
    await expect(sheet.getByTestId('user-disabled')).toBeDisabled()
    await expect(sheet.getByTestId('user-delete')).toBeDisabled()
  })
})
