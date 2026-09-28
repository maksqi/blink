/**
 * Users service (auth). Single import point for the Stage 03 admin handlers:
 *
 *   import { createUserByAdmin, updateUserByAdmin, deleteUser, createAccountInvite } from '../../services/users'
 *   const admin = await requireAdmin(event)
 *   const body = await readValidatedBody(event, adminCreateUserSchema.parse)
 *   setResponseStatus(event, 201)
 *   return createUserByAdmin(body, { user: admin, event })
 *
 * Contracts, errors and audit actions are documented in `admin.ts` (users), `invites.ts` (account invites) and
 * `users.ts` (low-level account helpers). Services write their own audit entries.
 */
export type { AdminActor } from './actor'
export {
  changeUserRole,
  createUserByAdmin,
  deleteUser,
  getAdminUser,
  listUsers,
  renameUser,
  resetPasswordByAdmin,
  revokeUserSessions,
  setUserDisabled,
  toAdminUser,
  updateUserByAdmin,
  type AdminCreateUserInput,
  type AdminUpdateUserInput,
  type AdminUsersQuery,
} from './admin'
export {
  createAccountInvite,
  INVITE_TTL_MS,
  inviteLink,
  inviteState,
  listAccountInvites,
  revokeAccountInvite,
  toAdminInvite,
  type AdminCreateInviteInput,
  type InviteRow,
  type InviteState,
} from './invites'
export { assertKeepsAnAdmin, lockEnabledAdmins, wouldRemoveLastAdmin } from './last-admin'
export { generateTempPassword, TEMP_PASSWORD_LENGTH } from './temp-password'
export {
  createUser,
  emailDomain,
  findUserByEmail,
  findUserById,
  normalizeEmail,
  setPassword,
  toAuthUser,
  type CreateUserInput,
  type UserRow,
} from './users'
