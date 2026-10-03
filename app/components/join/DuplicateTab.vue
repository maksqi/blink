<script setup lang="ts">
/**
 * Shown when another tab of this browser is already in the meeting (decision): "Use here" asks that tab to leave the
 * call, then this tab continues to pre-join.
 */
import { AppWindowIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import JoinScreen from './JoinScreen.vue'

defineProps<{ meeting?: string; busy?: boolean }>()
const emit = defineEmits<{ useHere: [] }>()
</script>

<template>
  <JoinScreen
    :icon="AppWindowIcon"
    :meeting="meeting"
    title="You're in this meeting in another tab"
    description="Use this tab instead, and the other tab leaves the meeting."
    data-testid="duplicate-tab"
  >
    <div class="flex flex-wrap justify-center gap-2">
      <Button :disabled="busy" data-testid="duplicate-use-here" @click="emit('useHere')">
        <Spinner v-if="busy" />
        Use here
      </Button>
      <Button variant="secondary" as-child>
        <NuxtLink to="/">Back to home</NuxtLink>
      </Button>
    </div>
  </JoinScreen>
</template>
