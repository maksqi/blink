/**
 * Shared email layout (auth). Every template renders a plain-text part and a minimal HTML part with inline styles:
 * no remote images, fonts or scripts, and every dynamic value HTML-escaped. Links come from the caller (built from
 * `PUBLIC_URL`, tokens in the fragment); templates never build URLs themselves.
 */
export interface EmailContent {
  subject: string
  text: string
  html: string
}

export interface EmailLayoutInput {
  subject: string
  heading: string
  /** Plain-text paragraphs (escaped in the HTML part). */
  paragraphs: string[]
  /** Main call to action: a button in HTML, the bare URL in text. */
  action?: { label: string; url: string }
  /** A value to copy, e.g. a temporary password, shown in monospace. */
  code?: { label: string; value: string }
  /** Small print after the action. */
  footer?: string[]
  appName?: string
}

const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!)
}

/** `2026-10-05 12:00 UTC`: unambiguous for every reader, whatever their time zone. */
export function formatUtc(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function greeting(displayName: string | null | undefined): string {
  const name = displayName?.trim()
  return name ? `Hi ${name},` : 'Hi,'
}

export function renderEmail(input: EmailLayoutInput): EmailContent {
  const appName = input.appName ?? 'blinq'
  const text = [
    input.heading,
    ...input.paragraphs,
    ...(input.code ? [`${input.code.label}: ${input.code.value}`] : []),
    ...(input.action ? [`${input.action.label}: ${input.action.url}`] : []),
    ...(input.footer ?? []),
    `-- \n${appName}`,
  ].join('\n\n')

  const paragraph = (value: string) =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#1f2933">${escapeHtml(value)}</p>`
  const code = input.code
    ? `<p style="margin:0 0 6px;font-size:13px;color:#52606d">${escapeHtml(input.code.label)}</p>` +
      `<p style="margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:17px;` +
      `letter-spacing:0.04em;padding:10px 14px;background:#f1f5f9;border-radius:8px;display:inline-block;color:#102a43">` +
      `${escapeHtml(input.code.value)}</p>`
    : ''
  const action = input.action
    ? `<p style="margin:8px 0 24px"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;` +
      `background:#0f766e;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 20px;` +
      `border-radius:8px">${escapeHtml(input.action.label)}</a></p>` +
      `<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#52606d">If the button does not work, copy this ` +
      `link into your browser:<br><span style="word-break:break-all;color:#0f766e">${escapeHtml(input.action.url)}` +
      `</span></p>`
    : ''
  const footer = (input.footer ?? [])
    .map((line) => `<p style="margin:0 0 10px;font-size:13px;line-height:1.5;color:#52606d">${escapeHtml(line)}</p>`)
    .join('')

  const html =
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<title>${escapeHtml(input.subject)}</title></head>` +
    '<body style="margin:0;padding:24px 12px;background:#f5f7fa;font-family:-apple-system,BlinkMacSystemFont,' +
    'Segoe UI,Roboto,Helvetica,Arial,sans-serif">' +
    '<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e4e7eb;border-radius:12px;' +
    'padding:28px 24px">' +
    `<p style="margin:0 0 20px;font-size:14px;font-weight:700;letter-spacing:0.02em;color:#0f766e">${escapeHtml(appName)}</p>` +
    `<h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#102a43">${escapeHtml(input.heading)}</h1>` +
    input.paragraphs.map(paragraph).join('') +
    code +
    action +
    footer +
    '</div></body></html>'

  return { subject: input.subject, text, html }
}
