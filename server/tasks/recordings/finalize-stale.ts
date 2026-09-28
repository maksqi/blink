// Stub (W0a). Owner: recording-server. Replace the body; keep the task name (scheduled in nuxt.config.ts).
export default defineTask({
  meta: { name: 'recordings:finalize-stale', description: 'Finalize recordings whose uploader disconnected or stopped sending chunks' },
  run() {
    return { result: 'noop' }
  },
})
