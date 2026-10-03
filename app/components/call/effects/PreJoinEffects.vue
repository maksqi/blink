<script setup lang="ts">
/** Pre-join slot: background blur, noise suppression and microphone volume before joining (they carry into the call). */
import EffectsControls from './EffectsControls.vue'
</script>

<template>
  <section aria-label="Video and audio effects" data-testid="prejoin-effects">
    <EffectsControls id-prefix="prejoin-effects" show-gain compact />
  </section>
</template>
