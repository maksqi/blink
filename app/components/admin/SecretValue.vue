<script setup lang="ts">
/**
 * A value shown exactly once (temporary password, invite link): read-only, selectable, with a copy button. When the
 * browser refuses clipboard access the text stays selected so it can be copied by hand.
 */
import { CheckIcon, CopyIcon } from '@lucide/vue'
import { toast } from 'vue-sonner'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { copyText } from './AdminTime.vue'

const props = defineProps<{ value: string; label: string; testid?: string }>()

const id = useId()
const copied = ref(false)

async function copy() {
  if (await copyText(props.value)) {
    copied.value = true
    toast.success('Copied to the clipboard')
    setTimeout(() => (copied.value = false), 2_000)
  } else {
    const field = document.getElementById(id)
    if (field instanceof HTMLInputElement) field.select()
    toast.error('Copying is blocked in this browser. The text is selected: copy it with the keyboard.')
  }
}
</script>

<template>
  <InputGroup>
    <InputGroupInput
      :id="id"
      :model-value="value"
      readonly
      :aria-label="label"
      class="font-mono text-sm"
      :data-testid="testid"
      @focus="($event.target as HTMLInputElement).select()"
    />
    <InputGroupAddon align="inline-end">
      <InputGroupButton size="icon-xs" :aria-label="`Copy ${label.toLowerCase()}`" @click="copy">
        <CheckIcon v-if="copied" aria-hidden="true" />
        <CopyIcon v-else aria-hidden="true" />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
