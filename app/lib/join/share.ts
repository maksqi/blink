/**
 * Client-side sharing of meeting links (docs/SECURITY.md §3.4): copy, `navigator.share` and `mailto:`. The server never
 * emails room links, because the key in the fragment would then pass through the server and SMTP.
 */

/** A `mailto:` URL that opens the person's own mail app with the link in the body (no recipient preset). */
export function mailtoHref(link: string, roomName: string): string {
  const subject = `Join "${roomName}" on blinq`
  const body = [
    `You're invited to "${roomName}".`,
    '',
    `Join with this link: ${link}`,
    '',
    'The link contains the encryption key of the meeting. Share it only with people you invite.',
  ].join('\n')
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function shareTitle(roomName: string): string {
  return `Join "${roomName}" on blinq`
}
