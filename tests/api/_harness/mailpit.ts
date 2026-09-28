/**
 * Mailpit client (dev stack: SMTP 127.0.0.1:1025, API http://127.0.0.1:8025/api/v1). Mailpit is shared by every
 * agent: search by your own unique recipient, never assert on totals, and never delete all messages
 * (`deleteMessages` requires explicit ids).
 *
 *   const mail = await waitForMessage(user.email, { subject: /Reset/ })
 *   const token = extractFragmentToken(mail.Text, '/reset-password')
 */
import { mailpitUrl } from './context'

export interface MailpitAddress {
  Name: string
  Address: string
}

export interface MailpitSummary {
  ID: string
  MessageID: string
  From: MailpitAddress
  To: MailpitAddress[]
  Subject: string
  Created: string
  Snippet: string
}

export interface MailpitMessage extends MailpitSummary {
  Text: string
  HTML: string
  Cc: MailpitAddress[] | null
  Bcc: MailpitAddress[] | null
  ReplyTo: MailpitAddress[] | null
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${mailpitUrl()}/api/v1${path}`, init)
  if (!response.ok) throw new Error(`Mailpit ${init?.method ?? 'GET'} ${path} failed: ${response.status}`)
  const text = await response.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export async function listMessages(limit = 50): Promise<MailpitSummary[]> {
  return (await call<{ messages: MailpitSummary[] }>(`/messages?limit=${limit}`)).messages
}

/** Mailpit search syntax, e.g. `to:"a@example.test" subject:"Reset"`. */
export async function searchMessages(query: string, limit = 50): Promise<MailpitSummary[]> {
  const params = new URLSearchParams({ query, limit: String(limit) })
  return (await call<{ messages: MailpitSummary[] }>(`/search?${params}`)).messages
}

export async function getMessage(id: string): Promise<MailpitMessage> {
  return call<MailpitMessage>(`/message/${encodeURIComponent(id)}`)
}

export async function deleteMessages(ids: string[]): Promise<void> {
  if (!ids.length) throw new Error('deleteMessages needs explicit ids (an empty list would delete every message)')
  await call('/messages', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ IDs: ids }) })
}

/** Polls until a message to `to` (optionally matching `subject`) arrives; returns the full message. */
export async function waitForMessage(
  to: string,
  options: { subject?: string | RegExp; timeoutMs?: number } = {},
): Promise<MailpitMessage> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000)
  while (true) {
    const found = (await searchMessages(`to:"${to}"`)).find((message) =>
      options.subject === undefined
        ? true
        : typeof options.subject === 'string'
          ? message.Subject.includes(options.subject)
          : options.subject.test(message.Subject),
    )
    if (found) return getMessage(found.ID)
    if (Date.now() > deadline) throw new Error(`No email to ${to} arrived in time`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** For "no enumeration" tests: waits `waitMs` and fails if anything was sent to `to`. */
export async function expectNoMessage(to: string, waitMs = 1_500): Promise<void> {
  await new Promise((r) => setTimeout(r, waitMs))
  const found = await searchMessages(`to:"${to}"`)
  if (found.length) throw new Error(`Expected no email to ${to}, found ${found.length}`)
}

/** Token from a link like `https://host/reset-password#<token>` in a message body. */
export function extractFragmentToken(text: string, path: '/invite' | '/verify-email' | '/reset-password' | string): string | null {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = text.match(new RegExp(`${escaped}#([A-Za-z0-9_-]{43})`))
  return match?.[1] ?? null
}
