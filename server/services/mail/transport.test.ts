import { describe, expect, it, vi } from 'vitest'
import { createMailer, MailDeliveryError, smtpErrorReason, type MailTransport } from './transport'

const message = { to: 'a@example.test', subject: 'Hello', text: 'Hi', html: '<p>Hi</p>' }

describe('mailer', () => {
  it('sends from the configured address', async () => {
    const sendMail = vi.fn<MailTransport['sendMail']>().mockResolvedValue({ messageId: 'x' })
    await createMailer({ transport: { sendMail }, from: 'blinq <no-reply@example.test>' }).send(message)
    expect(sendMail).toHaveBeenCalledWith({ from: 'blinq <no-reply@example.test>', ...message })
  })

  it('turns transport failures into MailDeliveryError with a one-line reason', async () => {
    const transport: MailTransport = {
      sendMail: () =>
        Promise.reject(new Error('Invalid login: 535 5.7.8 Authentication failed\n    at SMTPConnection')),
    }
    const error = await createMailer({ transport, from: 'x@example.test' })
      .send(message)
      .catch((err: unknown) => err)
    expect(error).toBeInstanceOf(MailDeliveryError)
    expect((error as MailDeliveryError).smtpError).toBe('Invalid login: 535 5.7.8 Authentication failed')
  })

  it('gives up after the timeout', async () => {
    vi.useFakeTimers()
    try {
      const transport: MailTransport = { sendMail: () => new Promise(() => {}) }
      const sending = createMailer({ transport, from: 'x@example.test', timeoutMs: 5_000 }).send(message)
      const result = sending.catch((err: unknown) => err)
      await vi.advanceTimersByTimeAsync(5_001)
      const error = await result
      expect(error).toBeInstanceOf(MailDeliveryError)
      expect((error as MailDeliveryError).smtpError).toMatch(/within 5 s/)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps reasons short', () => {
    expect(smtpErrorReason(new Error('x'.repeat(500)))).toHaveLength(200)
    expect(smtpErrorReason('plain')).toBe('plain')
    expect(smtpErrorReason(new Error(''))).toBe('Unknown SMTP error')
  })
})
