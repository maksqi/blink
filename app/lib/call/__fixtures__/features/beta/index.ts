// Registry test fixture: a second feature folder (added without touching anything else).
import { defineCallFeature } from '../../../../contracts/call'

const Stub = { name: 'BetaStub', render: () => null }

export default defineCallFeature({
  id: 'beta',
  controlBar: [{ id: 'beta-button', order: 50, placement: 'center', component: Stub }],
  preJoin: [{ id: 'beta-slot', order: 1, component: Stub }],
  settings: [{ id: 'beta-settings', title: 'Beta', order: 30, component: Stub }],
  phaseScreens: [{ id: 'beta-ended', phases: ['ended'], order: 20, component: Stub }],
  overlays: [
    { id: 'beta-overlay-late', order: 20, component: Stub },
    { id: 'beta-overlay-early', order: 10, component: Stub },
  ],
  setup: (ctx) => {
    ctx.events.emit('server.hint', { type: 'beta.setup' })
    return () => ctx.events.emit('server.hint', { type: 'beta.cleanup' })
  },
})
