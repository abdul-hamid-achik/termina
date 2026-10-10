<script setup lang="ts">
import { canonicalUrl } from '~~/shared/constants/site'

// One canonical URL per page on the www host (no query string), mirrored to
// og:url, so crawlers and link unfurlers agree on a single address.
const route = useRoute()
const canonical = computed(() => canonicalUrl(route.path))
useHead({ link: [{ rel: 'canonical', href: canonical }] })
useSeoMeta({ ogUrl: canonical })
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
