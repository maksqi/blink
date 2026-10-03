<script setup lang="ts">
/**
 * "People" side panel: search, the raised-hand queue, then the host, co-hosts and everyone else by name. Your own row
 * offers "Rename"; other rows offer the moderation menu when you may moderate them.
 */
import { SearchIcon, XIcon } from '@lucide/vue'
import { computed, shallowRef } from 'vue'
import HandQueue from './HandQueue.vue'
import ParticipantRow from './ParticipantRow.vue'
import { Input } from '@/components/ui/input'
import { useCall } from '~/composables/call'
import { filterParticipants, sortParticipants } from '~/lib/call/features/participants/list'
import { useParticipantInfo } from '~/lib/call/features/participants/useParticipantInfo'

const ctx = useCall()
// Refetches the moderators' allowance list when the panel opens.
useParticipantInfo()

const query = shallowRef('')
const filtered = computed(() => filterParticipants(ctx.participants.value, query.value))
const sections = computed(() => sortParticipants(filtered.value))
const groups = computed(() =>
  [
    { id: 'host', title: 'Host', people: sections.value.host },
    { id: 'cohosts', title: 'Co-hosts', people: sections.value.cohosts },
    { id: 'others', title: 'Participants', people: sections.value.others },
  ].filter((group) => group.people.length > 0),
)
</script>

<template>
  <div class="flex flex-col gap-4 p-3" data-testid="participants-panel">
    <div class="relative">
      <SearchIcon
        class="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        v-model="query"
        type="search"
        placeholder="Search people"
        aria-label="Search people"
        class="h-9 pr-8 pl-8"
        data-testid="participants-search"
      />
      <button
        v-if="query"
        type="button"
        class="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
        aria-label="Clear search"
        @click="query = ''"
      >
        <XIcon class="size-3.5" aria-hidden="true" />
      </button>
    </div>

    <HandQueue v-if="sections.hands.length > 0" :entries="sections.hands" />

    <section
      v-for="group in groups"
      :key="group.id"
      :aria-labelledby="`people-${group.id}`"
      class="flex flex-col gap-1"
    >
      <h3 :id="`people-${group.id}`" class="px-2 text-xs font-semibold text-muted-foreground">
        {{ group.title }} ({{ group.people.length }})
      </h3>
      <ul class="flex flex-col" :data-section="group.id">
        <ParticipantRow v-for="person in group.people" :key="person.identity" :participant="person" />
      </ul>
    </section>

    <p
      v-if="query && filtered.length === 0"
      class="px-2 text-sm text-muted-foreground"
      data-testid="participants-empty"
    >
      Nobody matches "{{ query.trim() }}".
    </p>
  </div>
</template>
