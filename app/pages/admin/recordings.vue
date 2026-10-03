<script setup lang="ts">
/**
 * /admin/recordings (recording-server, Stage 08): every recording on the server, searchable by room name, recorder
 * name or email; admins can delete in any state. Admin playback and downloads are written to the audit log.
 */
import { SearchIcon } from '@lucide/vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import AppPageHeader from '@/components/app/AppPageHeader.vue'
import RecordingsList from '@/components/recordings/RecordingsList.vue'

definePageMeta({ layout: 'admin', middleware: 'admin' })
useHead({ title: 'Recordings · Admin' })

const input = ref('')
const search = ref('')
const applySearch = useDebounceFn((value: string) => {
  search.value = value.trim().slice(0, 200)
}, 300)
watch(input, (value) => applySearch(value))
</script>

<template>
  <div>
    <AppPageHeader
      title="Recordings"
      description="Every recording on this server. Admin playback is recorded in the audit log."
    >
      <template #actions>
        <InputGroup class="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            v-model="input"
            type="search"
            placeholder="Room, name or email"
            aria-label="Search recordings"
            maxlength="200"
            data-testid="admin-recordings-search"
          />
        </InputGroup>
      </template>
    </AppPageHeader>
    <RecordingsList endpoint="/api/admin/recordings" admin :search="search" />
  </div>
</template>
