/**
 * Copy for the error page. It depends only on the status code: raw server messages, `statusMessage` and stack
 * traces are never shown (docs/SECURITY.md §5).
 */
export type ErrorKind = 'not-found' | 'forbidden' | 'unauthenticated' | 'client' | 'unavailable' | 'server'

export interface ErrorCopy {
  status: number
  kind: ErrorKind
  title: string
  description: string
}

function normalizeStatus(statusCode: unknown): number {
  const status = typeof statusCode === 'number' ? statusCode : Number(statusCode)
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
}

export function errorCopy(statusCode: unknown): ErrorCopy {
  const status = normalizeStatus(statusCode)
  switch (status) {
    case 404:
      return {
        status,
        kind: 'not-found',
        title: 'Page not found',
        description: 'This page does not exist or has moved. Check the address, or head back home.',
      }
    case 403:
      return {
        status,
        kind: 'forbidden',
        title: 'You do not have access',
        description: 'Your account cannot open this page. Ask an administrator if you think you should.',
      }
    case 401:
      return {
        status,
        kind: 'unauthenticated',
        title: 'Sign in to continue',
        description: 'This page is only available when you are signed in.',
      }
    case 503:
      return {
        status,
        kind: 'unavailable',
        title: 'blinq is unavailable right now',
        description: 'The server is starting up or under maintenance. Try again in a moment.',
      }
  }
  if (status < 500) {
    return {
      status,
      kind: 'client',
      title: 'This request did not work',
      description: 'Check the address and try again.',
    }
  }
  return {
    status,
    kind: 'server',
    title: 'Something went wrong',
    description: 'An unexpected error happened on the server. Try again in a moment.',
  }
}
