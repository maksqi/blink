/**
 * Temporary passwords for admin-created accounts and admin resets (auth, docs/stages/03-admin-panel.md): 16 characters
 * from an alphabet without look-alikes (no 0/O, 1/l/I), about 92 bits. Always passes the password policy; the account
 * must replace it at the next sign-in (`must_change_password`).
 */
import { randomInt } from 'node:crypto'
import { checkPasswordPolicy } from '../../utils/password'

export const TEMP_PASSWORD_LENGTH = 16
export const TEMP_PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function generateTempPassword(random: (max: number) => number = randomInt): string {
  for (;;) {
    let value = ''
    for (let i = 0; i < TEMP_PASSWORD_LENGTH; i++) {
      value += TEMP_PASSWORD_ALPHABET[random(TEMP_PASSWORD_ALPHABET.length)]
    }
    if (checkPasswordPolicy(value).ok) return value
  }
}
