<script setup lang="ts">
/** Search box of an admin list. `v-model` gets the trimmed text 300 ms after typing stops (at most 200 characters). */
import { SearchIcon } from '@lucide/vue'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'

const model = defineModel<string>({ required: true })
defineProps<{ label: string; placeholder?: string }>()

const input = ref(model.value)
const apply = useDebounceFn((value: string) => {
  model.value = value.trim().slice(0, 200)
}, 300)
watch(input, (value) => void apply(value))
</script>

<template>
  <InputGroup class="w-full sm:w-72">
    <InputGroupAddon>
      <SearchIcon aria-hidden="true" />
    </InputGroupAddon>
    <InputGroupInput
      v-model="input"
      type="search"
      :placeholder="placeholder"
      :aria-label="label"
      maxlength="200"
      data-testid="admin-search"
    />
  </InputGroup>
</template>
