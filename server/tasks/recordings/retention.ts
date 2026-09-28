// Stub (W0a). Owner: recording-server. Replace the body; keep the task name (scheduled in nuxt.config.ts).
export default defineTask({
  meta: { name: 'recordings:retention', description: 'Delete recordings past their retention date' },
  run() {
    return { result: 'noop' }
  },
})
