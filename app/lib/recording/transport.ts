/**
 * HTTP transport for the uploader (docs/API.md §8). Chunks go as raw `application/octet-stream` bodies; `useApi()` is
 * JSON-only, so this uses `fetch` directly. Same-origin requests carry the session cookie and the `Origin` header the
 * CSRF check wants.
 */
import type { UploadResponse, UploadTransport } from './uploader'

type FetchLike = (input: string, init: RequestInit) => Promise<Response>

async function toUploadResponse(response: Response): Promise<UploadResponse> {
  let body: unknown
  if (!response.ok) {
    body = await response.json().catch(() => undefined)
  } else {
    await response.body?.cancel().catch(() => undefined)
  }
  return { status: response.status, retryAfter: response.headers.get('retry-after'), body }
}

export function recordingTransport(
  recordingId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): UploadTransport {
  const base = `/api/recordings/${encodeURIComponent(recordingId)}`
  return {
    async putChunk(seq, blob) {
      const response = await fetchImpl(`${base}/chunks/${seq}`, {
        method: 'PUT',
        body: blob,
        credentials: 'same-origin',
        headers: { 'content-type': 'application/octet-stream', accept: 'application/json' },
      })
      return toUploadResponse(response)
    },
    async complete(body) {
      const response = await fetchImpl(`${base}/complete`, {
        method: 'POST',
        body: JSON.stringify(body),
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
      })
      return toUploadResponse(response)
    },
  }
}
