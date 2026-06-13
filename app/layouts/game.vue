<template>
  <!-- scanline-overlay + crt-vignette give the gameplay surface the CRT terminal
       atmosphere the marketing layout already ships (both are fixed,
       pointer-events:none overlays, so they don't affect layout or hit-testing). -->
  <div class="scanline-overlay crt-vignette h-screen h-dvh w-full overflow-hidden bg-bg-primary">
    <slot />
  </div>
</template>
