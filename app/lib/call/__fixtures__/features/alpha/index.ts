// Registry test fixture: a feature folder discovered by import.meta.glob exactly like app/lib/call/features/*.
import { defineCallFeature } from '../../../../contracts/call'

const Stub = { name: 'AlphaStub', render: () => null }

export default defineCallFeature({
  id: 'alpha',
  controlBar: [
    { id: 'alpha-late', order: 90, placement: 'end', component: Stub },
    { id: 'alpha-early', order: 10, placement: 'center', component: Stub, visible: (ctx) => ctx.phase.value === 'inCall' },
  ],
  panels: [{ id: 'alpha-panel', title: 'Alpha', icon: Stub, order: 20, component: Stub }],
  tileBadges: [{ id: 'alpha-badge', order: 5, component: Stub }],
  phaseScreens: [{ id: 'alpha-ended', phases: ['ended', 'removed'], order: 10, component: Stub }],
  setup: (ctx) => {
    ctx.events.emit('server.hint', { type: 'alpha.setup' })
    return () => ctx.events.emit('server.hint', { type: 'alpha.cleanup' })
  },
})
