import { describe, expect, it, vi } from 'vitest'
import { CAPTURE_ERROR_TEXT } from './devices'
import { changeMedia, MEDIA_CHANGE_FAILED, mediaErrorText } from './media-toggles'

const noErrors = { micError: null, cameraError: null }

describe('changeMedia (F-042)', () => {
  it('resolves and notifies with the recorded capture error when the change fails', async () => {
    const notify = vi.fn()
    const failing = () => Promise.reject(new DOMException('denied', 'NotAllowedError'))
    await expect(
      changeMedia('microphone', failing, () => ({ micError: 'denied', cameraError: null }), notify),
    ).resolves.toBeUndefined()
    expect(notify).toHaveBeenCalledWith(CAPTURE_ERROR_TEXT.microphone.denied)
  })

  it('uses a generic text when no capture error was recorded', async () => {
    const notify = vi.fn()
    await changeMedia('camera', () => Promise.reject(new Error('publish failed')), () => noErrors, notify)
    expect(notify).toHaveBeenCalledWith(MEDIA_CHANGE_FAILED.camera)
  })

  it('stays quiet when the change works', async () => {
    const notify = vi.fn()
    await changeMedia('camera', () => Promise.resolve(), () => noErrors, notify)
    expect(notify).not.toHaveBeenCalled()
  })

  it('picks the text of the right device', () => {
    const media = { micError: 'in-use' as const, cameraError: 'not-found' as const }
    expect(mediaErrorText('microphone', media)).toBe(CAPTURE_ERROR_TEXT.microphone['in-use'])
    expect(mediaErrorText('camera', media)).toBe(CAPTURE_ERROR_TEXT.camera['not-found'])
  })
})
