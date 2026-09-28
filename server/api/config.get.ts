// GET /api/config (server-core): public client configuration (publicConfigSchema). Settings are cached on the
// server for up to 5 s; the response itself is no-store like every /api response (docs/API.md §1, §2).
import { getPublicConfig } from '../services/settings/public-config'

export default defineEventHandler(() => getPublicConfig())
