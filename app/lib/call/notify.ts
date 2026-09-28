/**
 * Toasts during a call show at the top center, clear of the control bar (the app's Toaster sits bottom right).
 * Features can use it for the same placement.
 */
import { toast } from 'vue-sonner'

const options = { position: 'top-center' } as const

export const callToast = {
  error: (message: string) => toast.error(message, options),
  success: (message: string) => toast.success(message, options),
  info: (message: string) => toast.info(message, options),
}
