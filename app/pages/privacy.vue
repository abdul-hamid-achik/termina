<script setup lang="ts">
// Static legal page — see terms.vue for the rationale. The "What we collect"
// and "Processors" lists mirror server/db/schema.ts and the actual auth +
// hosting setup; keep them in sync if the data model or providers change.
useHead({ title: 'Privacy Policy · TERMINA' })

const lastUpdated = 'June 22, 2026'
const contactEmail = 'support@terminamoba.com'

const sections: { title: string; body?: string[]; bullets?: string[] }[] = [
  {
    title: '1. Information We Collect',
    body: ['We collect only what is needed to run the game and your account:'],
    bullets: [
      'Account: your username, an optional email address, and (for password accounts) a securely hashed password — we never store your password in plain text.',
      'Profile: your avatar image URL and chosen in-game avatar.',
      'Sign-in identity: if you use GitHub or Discord, the provider gives us your provider account ID, username, avatar, and email address. We never receive your GitHub or Discord password.',
      'Gameplay: your skill rating (MMR), games played, wins, and per-match statistics (hero, kills/deaths/assists, gold, damage, healing, items, level) used for matchmaking, your profile, and leaderboards.',
      'Technical: a single session cookie that keeps you signed in.',
      'Security: your IP address is processed transiently to rate-limit abuse and brute-force attempts. It is not stored in our database or shared.',
    ],
  },
  {
    title: '2. How We Use Your Information',
    body: ['We use your information to:'],
    bullets: [
      'create and secure your account and keep you signed in',
      'run matches, matchmaking, leaderboards, replays, and your public profile',
      'send essential account email — address verification, password resets, and security alerts (we do not send marketing email)',
      'maintain and improve the game and investigate abuse or cheating',
    ],
  },
  {
    title: '3. Signing In With GitHub or Discord',
    body: [
      'When you choose "Continue with GitHub" or "Continue with Discord", you are redirected to that provider to authorize Termina. We request your basic profile (account ID, username, avatar) and email. We do not receive your password and cannot act on your behalf beyond reading that profile.',
      'Your use of those providers is governed by their own policies — see the GitHub Privacy Statement and the Discord Privacy Policy.',
    ],
  },
  {
    title: '4. Cookies',
    body: [
      'Termina uses a single, essential cookie: an encrypted session cookie that keeps you logged in. We do not use third-party advertising or analytics tracking cookies.',
    ],
  },
  {
    title: '5. Where Your Data Is Stored',
    body: [
      'Termina runs on third-party infrastructure that processes data on our behalf. These providers store data in the United States:',
    ],
    bullets: [
      'Neon — PostgreSQL database (accounts, matches, statistics)',
      'Upstash — Redis (live game state and matchmaking, transient)',
      'DigitalOcean — the game/API server',
      'Vercel — frontend hosting and content delivery',
      'Resend — delivery of transactional email (verification, password reset, security alerts)',
    ],
  },
  {
    title: '6. How We Share Information',
    body: [
      'We do not sell your personal information or share it with advertisers. Some information is public by design: your username, avatar, and gameplay statistics are visible to other players via profiles, match history, and leaderboards. We may disclose information if required by law or to protect the service and its players.',
    ],
  },
  {
    title: '7. Data Retention & Your Choices',
    body: [
      'We keep your account and gameplay data while your account exists. You can request access to, correction of, or deletion of your personal data at any time by contacting us (below). Deleting your account removes your personal account data; anonymized or aggregate statistics may be retained.',
    ],
  },
  {
    title: '8. Children',
    body: [
      'Termina is not directed to children under 13 (or the minimum age required in your country, or by GitHub/Discord). We do not knowingly collect data from children under that age; if you believe a child has provided us data, contact us and we will remove it.',
    ],
  },
  {
    title: '9. Changes & Contact',
    body: [
      'We may update this policy as the game evolves; material changes are reflected in the "Last updated" date above.',
      `For any privacy request or question, email ${contactEmail}, or open an issue at github.com/abdul-hamid-achik/termina.`,
    ],
  },
]
</script>

<template>
  <article class="mx-auto mt-4 flex max-w-[850px] flex-col gap-4 pb-8">
    <header class="mb-2 border-b border-border pb-2">
      <h1 class="text-lg font-bold tracking-widest text-radiant">&gt;_ PRIVACY POLICY</h1>
      <p class="mt-1 text-[0.75rem] text-text-dim">Last updated: {{ lastUpdated }}</p>
    </header>

    <p class="text-[0.8rem] leading-relaxed text-text-dim">
      This policy explains what Termina ("we") collects, why, and your choices. Termina is a free,
      text-based multiplayer game in alpha. We aim to collect as little as possible — just enough to
      run your account and the game.
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
          class="text-[0.8rem] leading-relaxed text-text-dim before:mr-1 before:text-radiant before:content-['+']"
        >
          {{ b }}
        </li>
      </ul>
    </section>

    <footer class="mt-3 border-t border-border pt-3 text-[0.75rem] text-text-dim">
      See also our
      <NuxtLink to="/terms" class="text-ability no-underline hover:underline"
        >Terms of Service</NuxtLink
      >.
    </footer>
  </article>
</template>
