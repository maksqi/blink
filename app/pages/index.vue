<script setup lang="ts">
/**
 * Landing page for signed-out visitors: what blinq is, "Sign in", and "Join with a link". Signed-in users go
 * straight to the dashboard. A pasted link is opened with a full navigation, so the fragment plugin captures the key
 * on load; the link itself is never sent to the server.
 */
import { ArrowRightIcon, KeyRoundIcon, LinkIcon, ServerIcon, UsersRoundIcon } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import AppHeader from '@/components/app/AppHeader.vue'
import AppLogo from '@/components/app/AppLogo.vue'
import MeetingPreview from '@/components/app/MeetingPreview.vue'
import SkipLink from '@/components/app/SkipLink.vue'
import { MEETING_LINK_ERRORS, parseMeetingLink } from '~/lib/shell/meeting-link'

definePageMeta({
  // The landing composes the header itself to get a full-bleed hero.
  layout: false,
  middleware: [
    () => {
      if (useAuthState().value) return navigateTo('/dashboard', { replace: true })
    },
  ],
})

useHead({ title: 'Private video meetings' })

const user = useAuthState()
watch(user, (value) => {
  if (value) navigateTo('/dashboard', { replace: true })
})

// One field with one check on submit: a plain ref keeps the form library off the landing page (initial JS budget).
const link = ref('')
const linkError = ref<string | null>(null)
// Submit only once hydrated: a native submission would send the fields to the page URL (F-020).
const hydrated = useHydrated()

function editLink(value: string | number) {
  link.value = String(value)
  linkError.value = null
}

function openLink() {
  const result = parseMeetingLink(link.value, window.location.origin)
  if (!result.ok) {
    linkError.value = MEETING_LINK_ERRORS[result.error]
    return
  }
  // Full navigation on purpose: the fragment plugin must see the key on page load.
  window.location.assign(result.href)
}

const features = [
  {
    icon: KeyRoundIcon,
    title: 'The key stays in the link',
    text: 'Room keys travel in the link fragment, which browsers never send to a server. Media and chat are encrypted before they leave your device.',
  },
  {
    icon: ServerIcon,
    title: 'Runs on your server',
    text: 'One Docker Compose file. Accounts, rooms and recordings stay on hardware you control.',
  },
  {
    icon: UsersRoundIcon,
    title: 'Made for real meetings',
    text: 'Up to 25 people, screen sharing, a waiting room, host controls and recording in the browser.',
  },
]
</script>

<template>
  <div class="relative isolate flex min-h-svh flex-col overflow-x-clip">
    <SkipLink />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[46rem] bg-[radial-gradient(60%_55%_at_70%_0%,color-mix(in_oklch,var(--primary)_15%,transparent),transparent_75%)]"
    />
    <div
      aria-hidden="true"
      class="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[46rem] bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] mask-[radial-gradient(ellipse_70%_55%_at_60%_0%,#000_20%,transparent_75%)] bg-size-[3.5rem_3.5rem] opacity-70"
    />
    <AppHeader />

    <main id="main" tabindex="-1" class="flex-1 outline-none">
      <section
        class="mx-auto grid w-full max-w-6xl items-center gap-x-16 gap-y-16 px-4 pt-12 pb-20 sm:px-6 sm:pt-16 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:px-8 lg:pt-24 lg:pb-28"
      >
        <div class="min-w-0">
          <p
            class="inline-flex items-center gap-2 rounded-full border bg-background/70 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur motion-safe:animate-rise"
          >
            <span class="relative flex size-2">
              <span class="absolute inline-flex size-full rounded-full bg-primary/60 motion-safe:animate-ping" />
              <span class="relative inline-flex size-2 rounded-full bg-primary" />
            </span>
            End-to-end encrypted
          </p>
          <h1
            class="mt-5 text-4xl leading-[1.05] font-semibold tracking-[-0.035em] text-balance sm:text-5xl lg:text-[3.6rem] motion-safe:animate-rise motion-safe:[animation-delay:80ms]"
          >
            Private meetings on <span class="text-primary">your own server</span>
          </h1>
          <p
            class="mt-5 max-w-xl text-lg text-pretty text-muted-foreground motion-safe:animate-rise motion-safe:[animation-delay:160ms]"
          >
            blinq encrypts audio, video and chat end to end. The key lives in your meeting link and never reaches the
            server.
          </p>
          <div class="mt-8 flex flex-wrap items-center gap-3 motion-safe:animate-rise motion-safe:[animation-delay:240ms]">
            <Button as-child size="lg" class="h-11 px-5 text-[0.9375rem]">
              <NuxtLink to="/login" prefetch-on="interaction">
                Sign in
                <ArrowRightIcon data-icon="inline-end" aria-hidden="true" />
              </NuxtLink>
            </Button>
          </div>

          <form
            method="post"
            class="mt-10 max-w-xl rounded-2xl border bg-card/85 p-4 shadow-sm backdrop-blur sm:p-5 motion-safe:animate-rise motion-safe:[animation-delay:320ms]"
            novalidate
            data-testid="join-link-form"
            @submit.prevent.stop="openLink"
          >
            <Field :data-invalid="linkError ? true : undefined" class="gap-2.5">
              <FieldLabel for="link" class="text-sm font-semibold">Join with a link</FieldLabel>
              <FieldDescription id="link-description">
                Paste the meeting link you received. It opens here, and the key never leaves your browser.
              </FieldDescription>
              <div class="flex flex-col gap-2 sm:flex-row">
                <InputGroup class="h-11 flex-1 bg-background">
                  <InputGroupAddon>
                    <LinkIcon aria-hidden="true" />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="link"
                    :model-value="link"
                    type="text"
                    inputmode="url"
                    autocomplete="off"
                    autocapitalize="off"
                    spellcheck="false"
                    enterkeyhint="go"
                    placeholder="https://.../m/abc-defg-hjk#k=..."
                    :aria-invalid="linkError ? true : undefined"
                    :aria-describedby="linkError ? 'link-description link-error' : 'link-description'"
                    @update:model-value="editLink"
                  />
                </InputGroup>
                <Button type="submit" size="lg" variant="secondary" class="h-11 px-5" :disabled="!hydrated">Join</Button>
              </div>
              <FieldError id="link-error" :errors="linkError ? [linkError] : []" />
            </Field>
          </form>
        </div>

        <MeetingPreview class="justify-self-center motion-safe:animate-rise motion-safe:[animation-delay:200ms] lg:justify-self-end" />
      </section>

      <section aria-labelledby="features-title" class="border-t bg-muted/40">
        <h2 id="features-title" class="sr-only">Why blinq</h2>
        <ul class="mx-auto grid w-full max-w-6xl gap-8 px-4 py-14 sm:px-6 md:grid-cols-3 lg:px-8 lg:py-16">
          <li v-for="feature in features" :key="feature.title" class="flex gap-4 md:flex-col md:gap-3">
            <span
              class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground ring-1 ring-primary/15"
            >
              <component :is="feature.icon" class="size-5" aria-hidden="true" />
            </span>
            <div>
              <h3 class="font-semibold tracking-tight">{{ feature.title }}</h3>
              <p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{{ feature.text }}</p>
            </div>
          </li>
        </ul>
      </section>
    </main>

    <footer class="border-t">
      <div
        class="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted-foreground sm:px-6 lg:px-8"
      >
        <AppLogo :to="false" class="opacity-90" />
        <p>Self-hosted video meetings. Your server, your keys.</p>
      </div>
    </footer>
  </div>
</template>
