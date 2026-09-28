<script setup lang="ts">
/**
 * Password field with a show/hide toggle. Attributes (`id`, `name`, `autocomplete`, `aria-*`) go to the input.
 *   <PasswordInput :id="field.name" v-model="value" autocomplete="new-password" @blur="field.handleBlur" />
 */
import { EyeIcon, EyeOffIcon } from '@lucide/vue'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'

defineOptions({ inheritAttrs: false })

const model = defineModel<string>({ default: '' })
const emit = defineEmits<{ blur: [event: FocusEvent] }>()
const visible = ref(false)
</script>

<template>
  <InputGroup class="h-10">
    <InputGroupInput
      v-bind="$attrs"
      :model-value="model"
      :type="visible ? 'text' : 'password'"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      @update:model-value="(value: string | number) => (model = String(value))"
      @blur="(event: FocusEvent) => emit('blur', event)"
    />
    <InputGroupAddon align="inline-end">
      <InputGroupButton
        size="icon-xs"
        :aria-label="visible ? 'Hide password' : 'Show password'"
        :aria-pressed="visible"
        @click="visible = !visible"
      >
        <EyeOffIcon v-if="visible" aria-hidden="true" />
        <EyeIcon v-else aria-hidden="true" />
      </InputGroupButton>
    </InputGroupAddon>
  </InputGroup>
</template>
