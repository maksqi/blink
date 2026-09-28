/**
 * One-line startup summary (server-core, docs/ARCHITECTURE.md §9): version, PUBLIC_URL, TURN on/off (`TURN_DOMAIN`),
 * SMTP on/off and the registration mode. The mode needs a database read; Nitro v2 does not await async plugins, so
 * the line is written when that read finishes (fire and forget, errors logged).
 */
import { version } from '../../package.json'
import { getSettings } from '../services/settings/settings'
import { env, type Env } from '../utils/env'
import { logger } from '../utils/logger'
import { startupSummary } from '../utils/startup'

export default defineNitroPlugin(() => {
  let config: Env
  try {
    config = env()
  } catch {
    return // 00.startup-checks reports configuration errors.
  }
  const base = {
    version,
    publicUrl: config.PUBLIC_URL,
    turn: Boolean(process.env.TURN_DOMAIN?.trim()),
    smtp: config.smtpEnabled,
  }
  getSettings()
    .then((settings) => logger.info(startupSummary({ ...base, registrationMode: settings['registration.mode'] })))
    .catch((error: unknown) => {
      logger.info(startupSummary({ ...base, registrationMode: null }))
      logger.warn('could not read settings at startup', { err: error })
    })
})
