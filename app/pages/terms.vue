<script setup lang="ts">
// Static legal page — kept plain + data-driven so the copy is easy to edit.
// Linked from the global footer and surfaced to OAuth providers (GitHub/Discord)
// during app review. Update `lastUpdated` whenever the terms change.
useHead({ title: 'Terms of Service · TERMINA' })

const lastUpdated = 'June 22, 2026'
const contactEmail = 'support@terminamoba.com'

const sections: { title: string; body?: string[]; bullets?: string[] }[] = [
  {
    title: '1. Accounts',
    body: [
      'You can create an account with a username and password, or by signing in with GitHub or Discord. You are responsible for keeping your credentials secure and for all activity under your account.',
      'Accounts are for individual human players. You must be old enough to use the service in your jurisdiction and to meet the minimum age of any identity provider you sign in with.',
    ],
  },
  {
    title: '2. Fair Play & Acceptable Use',
    body: ['Termina is a competitive game. To keep matches fair, you agree NOT to:'],
    bullets: [
      'cheat, automate play, run bots, or use scripts or third-party tools to gain an advantage',
      'deliberately abuse bugs or exploits instead of reporting them',
      'harass, threaten, or abuse other players, or post unlawful or hateful content',
      'attempt to disrupt, overload, reverse-engineer, or gain unauthorized access to the service',
      'share, sell, or buy accounts, or impersonate others',
    ],
  },
  {
    title: '3. Alpha Software & Availability',
    body: [
      'Termina is early-stage ("alpha") software, offered free of charge. Features may change, break, or be removed, and game data — including accounts, stats, and rankings — may be reset at any time without notice.',
      'The service is provided on an "as available" basis. We do not guarantee uptime, and matches or progress may be lost during maintenance, deploys, or outages.',
    ],
  },
  {
    title: '4. Content & Intellectual Property',
    body: [
      'The game, its name, code, art, text, and design are owned by the Termina maintainer. You receive a limited, personal, non-transferable, revocable license to play the game for non-commercial enjoyment.',
      'Your public profile data (username, avatar, and gameplay statistics) is shown to other players as part of normal gameplay, leaderboards, and match history.',
    ],
  },
  {
    title: '5. Disclaimer & Limitation of Liability',
    body: [
      'THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED. To the maximum extent permitted by law, the maintainer is not liable for any indirect, incidental, or consequential damages, or for lost data or progress, arising from your use of the service.',
    ],
  },
  {
    title: '6. Suspension & Termination',
    body: [
      'You may stop using Termina at any time and request that your account be deleted (see the Privacy Policy). We may suspend or terminate accounts that violate these terms or that harm other players or the service.',
    ],
  },
  {
    title: '7. Changes to These Terms',
    body: [
      'We may update these terms as the game evolves. Material changes will be reflected by the "Last updated" date above. Continuing to use the service after a change means you accept the updated terms.',
    ],
  },
  {
    title: '8. Contact',
    body: [
      `Questions about these terms? Email ${contactEmail}, or open an issue on the project repository at github.com/abdul-hamid-achik/termina.`,
    ],
  },
]
</script>

<template>
  <article class="mx-auto mt-4 flex max-w-[850px] flex-col gap-4 pb-8">
    <header class="mb-2 border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-radiant">&gt;_ TERMS OF SERVICE</h1>
      <p class="mt-1 text-[0.75rem] text-text-dim">Last updated: {{ lastUpdated }}</p>
    </header>

    <p class="text-[0.8rem] leading-relaxed text-text-dim">
      Termina is a free, text-based multiplayer game ("the Service"), currently in alpha. By
      creating an account or playing, you agree to these Terms of Service. If you do not agree,
      please do not use the Service.
    </p>

    <section v-for="s in sections" :key="s.title" class="flex flex-col gap-2">
      <h2 class="text-[0.85rem] font-bold text-ability">{{ s.title }}</h2>
      <p v-for="(p, i) in s.body" :key="i" class="text-[0.8rem] leading-relaxed text-text-dim">
        {{ p }}
      </p>
      <ul v-if="s.bullets" class="flex flex-col gap-1 pl-4">
        <li
          v-for="(b, i) in s.bullets"
          :key="i"
          class="text-[0.8rem] leading-relaxed text-text-dim before:mr-1 before:text-dire before:content-['×']"
        >
          {{ b }}
        </li>
      </ul>
    </section>

    <footer class="mt-3 border-t border-border pt-3 text-[0.75rem] text-text-dim">
      See also our
      <NuxtLink to="/privacy" class="text-ability no-underline hover:underline"
        >Privacy Policy</NuxtLink
      >.
    </footer>
  </article>
</template>
