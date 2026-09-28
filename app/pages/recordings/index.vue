<script setup lang="ts">
/**
 * /recordings (recording-server, Stage 08): the signed-in user's recordings and recordings of rooms they own, with
 * status (including Partial), duration, size and expiry; play, download and delete. Local-only recordings are listed
 * as "Saved on the recorder's device" without playback.
 */
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import RecordingsList from '@/components/recordings/RecordingsList.vue'

useHead({ title: 'Recordings' })
</script>

<template>
  <div>
    <AppPageHeader
      title="Recordings"
      description="Recordings stored on this server are encrypted at rest and deleted automatically when they expire."
    />
    <RecordingsList endpoint="/api/recordings" />
  </div>
</template>
