/**
 * Recording (Stage 08, recording-client): the REC indicator for everyone, the recorder's upload status and the record
 * button for hosts and co-hosts with an account. `setup` creates the per-call controller (app/lib/recording/).
 */
import { defineCallFeature } from '../../../contracts/call'
import { attachRecording, canRecord, recordingFor } from './state'
import RecordButton from '~/components/call/recording/RecordButton.vue'
import RecordingIndicator from '~/components/call/recording/RecordingIndicator.vue'
import RecordingStatus from '~/components/call/recording/RecordingStatus.vue'

export default defineCallFeature({
  id: 'recording',
  controlBar: [
    // Always mounted: it holds the aria-live region and renders the badge only while a recording runs.
    { id: 'recording.indicator', order: 20, placement: 'start', component: RecordingIndicator },
    {
      id: 'recording.status',
      order: 21,
      placement: 'start',
      component: RecordingStatus,
      visible: (ctx) => recordingFor(ctx)?.busy ?? false,
    },
    {
      id: 'recording.record',
      order: 60,
      placement: 'center',
      component: RecordButton,
      // A recorder who loses the right mid-recording (demoted) still needs the stop button.
      visible: (ctx) => canRecord(ctx) || (recordingFor(ctx)?.busy ?? false),
    },
  ],
  setup: (ctx) => attachRecording(ctx),
})
