// Container healthcheck (the slim image has no curl or wget): GET /api/ready on loopback with a 2 s timeout.
// Exit 0 on 200, else 1. The reason is kept in `docker inspect` (State.Health.Log); it never contains secrets.
import process from 'node:process'

const url = `http://127.0.0.1:${process.env.NITRO_PORT || '3000'}/api/ready`

try {
  const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
  if (response.status === 200) {
    await response.body?.cancel()
    process.exit(0)
  }
  const body = (await response.text()).slice(0, 300)
  process.stdout.write(`${url} answered HTTP ${response.status}: ${body}\n`)
} catch (error) {
  process.stdout.write(`${url} failed: ${error instanceof Error ? error.message : String(error)}\n`)
}
process.exit(1)
