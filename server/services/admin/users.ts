/**
 * Account deletion for admins (Stage 03, `DELETE /api/admin/users/:id`). The users service checks `self` and
 * `last_admin` (409 `CONFLICT`) and 404 first, then runs `beforeDelete`, then deletes the row (rooms, recordings and
 * sessions cascade) and writes `admin.user_deleted`.
 *
 * `cleanupBeforeUserDelete(userId, steps)` runs, in this order:
 * 1. `endMeetingsOfOwner`: live meetings in the user's rooms end (LiveKit `DeleteRoom`, waiting requests `ended`);
 * 2. `removeUserFromLiveCalls`: the user leaves other people's live calls. This must happen before the row goes: the
 *    `user.revoked` event published after the delete finds no rows any more (`call_participants.user_id` is set to
 *    null by the cascade) (decision);
 * 3. `deleteRecordingsForUser`: recording files the user made or that belong to their rooms. The database would
 *    cascade the rows but not the files.
 * A failing step stops the deletion (the error propagates and the account stays).
 */
import { removeUserFromLiveCalls } from '../calls/revocation'
import { endMeetingsOfOwner } from '../meetings/meetings'
import { deleteRecordingsForUser } from '../recordings/api'
import { deleteUser } from '../users/admin'
import type { AdminActor } from './common'

export interface UserCleanupSteps {
  endMeetingsOfOwner(userId: string): Promise<unknown>
  removeUserFromLiveCalls(userId: string): Promise<unknown>
  deleteRecordingsForUser(userId: string): Promise<unknown>
}

const DEFAULT_STEPS: UserCleanupSteps = {
  endMeetingsOfOwner: (userId) => endMeetingsOfOwner(userId),
  removeUserFromLiveCalls: (userId) => removeUserFromLiveCalls(userId),
  deleteRecordingsForUser: (userId) => deleteRecordingsForUser(userId),
}

export async function cleanupBeforeUserDelete(userId: string, steps: UserCleanupSteps = DEFAULT_STEPS): Promise<void> {
  await steps.endMeetingsOfOwner(userId)
  await steps.removeUserFromLiveCalls(userId)
  await steps.deleteRecordingsForUser(userId)
}

export async function deleteUserByAdmin(
  id: string,
  actor: AdminActor,
  steps: UserCleanupSteps = DEFAULT_STEPS,
): Promise<void> {
  await deleteUser(id, actor, { beforeDelete: (user) => cleanupBeforeUserDelete(user.id, steps) })
}
