// Stub (W0a). Owner: server-core. Replace the body; keep the task name (scheduled in nuxt.config.ts).
export default defineTask({
  meta: { name: 'maintenance:cleanup', description: 'Expired sessions, invites, guest sessions, email tokens and throttle rows' },
  run() {
    return { result: 'noop' }
  },
})
