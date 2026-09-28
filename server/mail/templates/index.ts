/**
 * Email templates (auth). Pure functions: input → `{ subject, text, html }`. English, plain text plus minimal inline
 * HTML, no remote images, dynamic values escaped. Links are passed in (built from `PUBLIC_URL`, token in the fragment);
 * no template ever contains a room link.
 */
export { escapeHtml, formatUtc, renderEmail, type EmailContent, type EmailLayoutInput } from './layout'
export { accountExistsTemplate, type AccountExistsInput } from './account-exists'
export { accountInviteTemplate, type AccountInviteInput } from './account-invite'
export { resetPasswordTemplate, type ResetPasswordInput } from './reset-password'
export { tempPasswordTemplate, type TempPasswordInput } from './temp-password'
export { testEmailTemplate, type TestEmailInput } from './test-email'
export { verifyEmailTemplate, type VerifyEmailInput } from './verify-email'
