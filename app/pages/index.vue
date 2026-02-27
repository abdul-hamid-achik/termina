<template>
  <div
    class="flex min-h-[calc(100vh-120px)] flex-col items-center justify-center gap-8 p-8 text-center max-sm:p-4"
  >
    <div class="flex flex-col items-center gap-3">
      <pre class="m-0 text-[0.5rem] leading-[1.15] text-radiant text-glow md:text-[0.7rem]">
████████╗███████╗██████╗ ███╗   ███╗██╗███╗   ██╗ █████╗
╚══██╔══╝██╔════╝██╔══██╗████╗ ████║██║████╗  ██║██╔══██╗
   ██║   █████╗  ██████╔╝██╔████╔██║██║██╔██╗ ██║███████║
   ██║   ██╔══╝  ██╔══██╗██║╚██╔╝██║██║██║╚██╗██║██╔══██║
   ██║   ███████╗██║  ██║██║ ╚═╝ ██║██║██║ ╚████║██║  ██║
   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝</pre
      >

      <p class="text-base tracking-wide text-text-dim">&gt;_ where every command is a kill</p>
    </div>

    <div class="flex max-w-[600px] flex-col gap-2 text-left">
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[01]</span>
        <span class="text-text-dim"
          >Text-based MOBA — command your hero through a terminal interface</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[02]</span>
        <span class="text-text-dim"
          >Tick-based combat — plan, execute, outplay. Every 4 seconds matters.</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[03]</span>
        <span class="text-text-dim"
          >6 unique heroes — carries, supports, assassins, tanks, mages</span
        >
      </div>
      <div class="flex items-baseline gap-3 text-[0.85rem]">
        <span class="shrink-0 text-ability">[04]</span>
        <span class="text-text-dim">Fog of war — use wards and scan to reveal the unseen</span>
      </div>
    </div>

    <div class="flex flex-wrap justify-center gap-3">
      <NuxtLink to="/play" class="no-underline">
        <AsciiButton label="ENTER THE TERMINAL" variant="primary" />
      </NuxtLink>
      <NuxtLink to="/learn" class="no-underline">
        <AsciiButton label="LEARN COMMANDS" variant="ghost" />
      </NuxtLink>
    </div>

    <div class="mt-4 text-[0.85rem]">
      <span class="font-bold text-radiant">&gt;</span>
      <span class="ml-1 text-text-dim">ready_</span>
      <span class="animate-blink">█</span>
    </div>
  </div>
</template>
