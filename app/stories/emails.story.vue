<script setup lang="ts">
// Histoire preview for the transactional email templates. The builders are pure
// (shared/emailTemplates.ts) so the story renders each email's REAL HTML in an
// isolated <iframe srcdoc> — the email's own inline styles apply exactly as an
// inbox would render them, independent of the app's CSS.
import {
  verifyEmailTemplate,
  passwordResetTemplate,
  passwordChangedTemplate,
  welcomeTemplate,
} from '~~/shared/emailTemplates'

const emails = [
  {
    id: 'verify',
    label: 'Email verification',
    tpl: verifyEmailTemplate('https://terminamoba.com/verify-email?token=demo-token'),
  },
  {
    id: 'reset',
    label: 'Password reset',
    tpl: passwordResetTemplate('https://terminamoba.com/reset-password?token=demo-token'),
  },
  { id: 'changed', label: 'Password changed', tpl: passwordChangedTemplate() },
  { id: 'welcome', label: 'Welcome', tpl: welcomeTemplate('neo_radiant') },
]
</script>

<template>
  <Story title="Emails/Transactional" :layout="{ type: 'single' }">
    <Variant v-for="e in emails" :key="e.id" :title="e.label">
      <div class="flex flex-col gap-2 p-3">
        <div class="font-mono text-xs text-text-dim">
          <span class="text-radiant">subject:</span> {{ e.tpl.subject }}
        </div>
        <iframe
          :srcdoc="e.tpl.html"
          title="email preview"
          class="h-[600px] w-full max-w-[540px] border border-border"
        />
        <details class="font-mono text-xs text-text-dim">
          <summary class="cursor-pointer hover:text-ability">plain-text version</summary>
          <pre class="mt-2 whitespace-pre-wrap">{{ e.tpl.text }}</pre>
        </details>
      </div>
    </Variant>
  </Story>
</template>
