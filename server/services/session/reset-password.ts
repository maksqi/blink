/** Implemented by server-core (Stage 01, W0b). Reads the new password from stdin, never argv. */
export async function runResetPassword(_email: string): Promise<number> {
  throw new Error('reset-password is not implemented yet (Stage 01, server-core)')
}
