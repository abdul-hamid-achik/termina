export default defineNuxtRouteMiddleware((to) => {
  const { loggedIn } = useUserSession()
  if (!loggedIn.value) {
    // Carry the destination so login can put the player back where they were
    // heading. Without it every logged-out CTA — "play", "settings", a shared
    // /play link — silently landed on the home page after signing in.
    return navigateTo({ path: '/login', query: { redirect: to.fullPath } })
  }
})
