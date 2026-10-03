<script setup lang="ts">
/**
 * Settings section "Video and audio effects": background blur and noise suppression. The microphone volume slider
 * lives in core's "Audio" section right above (decision: one slider per setting); its value is remembered per
 * microphone all the same.
 */
import EffectsControls from './EffectsControls.vue'
</script>

<template>
  <div data-testid="settings-effects">
    <EffectsControls id-prefix="settings-effects" />
  </div>
</template>
