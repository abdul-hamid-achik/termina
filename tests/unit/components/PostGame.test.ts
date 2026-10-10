import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import PostGame from '~~/app/components/lobby/PostGame.vue'
import { makePlayerEndStats, SAMPLE_HEROES, SAMPLE_ITEMS } from '~~/app/stories/fixtures'
import type { TeamId } from '~~/shared/types/game'
import type { PlayerEndStats } from '~~/shared/types/protocol'

// PostGame renders end-of-game stats. It auto-imports TerminalPanel /
// AsciiButton / NuxtLink in the live app; the components vitest project has no
// Nuxt auto-import, so we stub them. AsciiButton is stubbed with a real <button>
// that mirrors its `label` + `@click` contract so the emit assertions are real.
const AsciiButtonStub = {
  name: 'AsciiButton',
  props: ['label', 'variant', 'disabled'],
  emits: ['click'],
  template: `<button :data-variant="variant" @click="$emit('click', $event)">{{ label }}</button>`,
}

const TerminalPanelStub = {
  name: 'TerminalPanel',
  props: ['title', 'variant'],
  template: `<section><h3 v-if="title">{{ title }}</h3><slot /></section>`,
}

const NuxtLinkStub = {
  name: 'NuxtLink',
  props: ['to'],
  template: `<a :href="to"><slot /></a>`,
}

/** A 4-player, 2v2 roster (drawn from the shared fixture) keyed for stats. */
function smallRoster() {
  return [
    { id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'chaff' as TeamId },
    { id: 'p2', name: 'kernel_main', heroId: SAMPLE_HEROES.kernel, team: 'chaff' as TeamId },
    { id: 'e1', name: 'daemon_carry', heroId: SAMPLE_HEROES.daemon, team: 'audit' as TeamId },
    { id: 'e2', name: 'regex_mid', heroId: SAMPLE_HEROES.regex, team: 'audit' as TeamId },
  ]
}

function smallStats(): Record<string, PlayerEndStats> {
  return {
    p1: makePlayerEndStats({ kills: 9, deaths: 2, assists: 7, scrip: 8400, heroDamage: 31_200 }),
    p2: makePlayerEndStats({ kills: 3, deaths: 5, assists: 14, scrip: 4100, heroDamage: 9800 }),
    e1: makePlayerEndStats({ kills: 6, deaths: 6, assists: 4, scrip: 6900, heroDamage: 21_000 }),
    e2: makePlayerEndStats({ kills: 2, deaths: 8, assists: 5, scrip: 3200, heroDamage: 7400 }),
  }
}

function mountPostGame(props: Partial<Parameters<typeof PostGame>[0]> = {}) {
  return mount(PostGame, {
    props: {
      winner: 'chaff' as TeamId,
      stats: smallStats(),
      players: smallRoster(),
      currentPlayerId: 'p1',
      ...props,
    },
    global: {
      stubs: {
        AsciiButton: AsciiButtonStub,
        TerminalPanel: TerminalPanelStub,
        NuxtLink: NuxtLinkStub,
      },
    },
  })
}

describe('PostGame', () => {
  describe('victory banner', () => {
    it('announces CHAFF VICTORY when chaff wins', () => {
      const wrapper = mountPostGame({ winner: 'chaff' })
      const banner = wrapper.find('[data-testid="post-game"]')
      expect(banner.text()).toContain('CHAFF VICTORY')
      expect(banner.text()).not.toContain('AUDIT VICTORY')
    })

    it('announces AUDIT VICTORY when audit wins', () => {
      const wrapper = mountPostGame({ winner: 'audit' })
      expect(wrapper.text()).toContain('AUDIT VICTORY')
      expect(wrapper.text()).not.toContain('CHAFF VICTORY')
    })
  })

  describe('MMR change tile', () => {
    it('shows a signed MMR delta when provided', () => {
      expect(mountPostGame({ mmrChange: 25 }).text()).toContain('+25')
      expect(mountPostGame({ mmrChange: -18 }).text()).toContain('-18')
    })

    it('omits the MMR tile when no change is provided', () => {
      const wrapper = mountPostGame()
      // 'MMR' label only renders inside the tile (v-if mmrChange !== undefined)
      expect(wrapper.text()).not.toContain('MMR')
    })
  })

  describe('your-performance panel', () => {
    it("shows the current player's K/D/A, damage and gold", () => {
      const wrapper = mountPostGame()
      const text = wrapper.text()
      // p1 stats: 9/2/7, 31,200 hero dmg, 8,400 scrip (toLocaleString → grouped)
      expect(text).toContain('9')
      expect(text).toContain('31,200')
      expect(text).toContain('8,400')
    })

    it('renders an MMR delta with a sign when provided', () => {
      const gain = mountPostGame({ mmrChange: 27 })
      expect(gain.text()).toContain('+27')

      const loss = mountPostGame({ mmrChange: -18 })
      expect(loss.text()).toContain('-18')
    })

    it('omits the MMR field when mmrChange is undefined', () => {
      const wrapper = mountPostGame()
      expect(wrapper.text()).not.toContain('MMR')
    })

    it('hides the performance panel when the current player has no stats', () => {
      const wrapper = mountPostGame({ currentPlayerId: 'ghost' })
      expect(wrapper.text()).not.toContain('Your Performance')
      // The scoreboard panel still renders.
      expect(wrapper.text()).toContain('Scoreboard')
    })
  })

  describe('scoreboard', () => {
    it('splits players into CHAFF and AUDIT sections with hero + player names', () => {
      const wrapper = mountPostGame()
      const text = wrapper.text()
      expect(text).toContain('CHAFF')
      expect(text).toContain('AUDIT')
      // hero names resolved from HEROES
      expect(text).toContain('Echo')
      expect(text).toContain('Daemon')
      // player names
      expect(text).toContain('you')
      expect(text).toContain('daemon_carry')
    })

    it('renders one scoreboard row per player across both teams', () => {
      const wrapper = mountPostGame()
      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(4)
    })

    it('exposes accessible table semantics (caption + scoped headers)', () => {
      const wrapper = mountPostGame()
      // Each team table is labelled for screen readers.
      const captions = wrapper.findAll('caption').map((c) => c.text())
      expect(captions).toContain('Chaff team final scoreboard')
      expect(captions).toContain('Audit team final scoreboard')
      // Column headers are scoped (8 columns × 2 tables).
      expect(wrapper.findAll('th[scope="col"]').length).toBeGreaterThanOrEqual(16)
      // Each player's name cell is a row header (4 players → 4 row headers).
      const rowHeaders = wrapper.findAll('th[scope="row"]')
      expect(rowHeaders).toHaveLength(4)
      expect(rowHeaders.map((h) => h.text())).toContain('you')
    })

    it('resolves item ids to readable item names', () => {
      const players = [
        { id: 'p1', name: 'you', heroId: SAMPLE_HEROES.echo, team: 'chaff' as TeamId },
      ]
      const stats: Record<string, PlayerEndStats> = {
        p1: makePlayerEndStats({
          items: [SAMPLE_ITEMS.salve, SAMPLE_ITEMS.treads, null, null, null, null],
        }),
      }
      const wrapper = mountPostGame({ players, stats, currentPlayerId: 'p1' })
      const text = wrapper.text()
      expect(text).toContain('Trauma Patch')
      expect(text).toContain('Gait Rig')
    })

    it('highlights the current player row', () => {
      const wrapper = mountPostGame()
      // the self-row gets the bg-ability/font-bold class block
      const highlighted = wrapper.findAll('tr.font-bold')
      expect(highlighted.length).toBe(1)
      expect(highlighted[0]!.text()).toContain('you')
    })

    it('defaults missing stats to zeros instead of crashing', () => {
      // e2 has no stats entry → row should still render with 0/0/0
      const stats = smallStats()
      delete stats.e2
      const wrapper = mountPostGame({ stats })
      const rows = wrapper.findAll('tbody tr')
      expect(rows).toHaveLength(4)
      expect(wrapper.text()).toContain('regex_mid')
    })
  })

  describe('actions', () => {
    it('emits playAgain when PLAY AGAIN is clicked', async () => {
      const wrapper = mountPostGame()
      await wrapper.get('[data-testid="play-again-btn"]').trigger('click')
      expect(wrapper.emitted('playAgain')).toHaveLength(1)
    })

    it('emits returnToMenu when MAIN MENU is clicked', async () => {
      const wrapper = mountPostGame()
      await wrapper.get('[data-testid="return-to-menu-btn"]').trigger('click')
      expect(wrapper.emitted('returnToMenu')).toHaveLength(1)
    })

    it('shows a WATCH REPLAY link to the replay route only when a gameId is present', () => {
      const without = mountPostGame()
      expect(without.find('a[href^="/replay/"]').exists()).toBe(false)

      const withId = mountPostGame({ gameId: 'game_abc' })
      const link = withId.find('a[href^="/replay/"]')
      expect(link.exists()).toBe(true)
      expect(link.attributes('href')).toBe('/replay/game_abc')
      expect(link.text()).toContain('WATCH REPLAY')
    })
  })

  describe('tutorial wrap-up', () => {
    it('frames a normal game as a match, with a PLAY AGAIN button and no tutorial note', () => {
      const wrapper = mountPostGame()
      expect(wrapper.text()).toContain('match concluded')
      expect(wrapper.find('[data-testid="tutorial-wrapup"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="play-again-btn"]').text()).toBe('PLAY AGAIN')
    })

    it('celebrates a tutorial and nudges toward a real match', () => {
      const wrapper = mountPostGame({ mode: 'tutorial', tutorialComplete: true })
      expect(wrapper.text()).toContain('tutorial complete')
      expect(wrapper.get('[data-testid="tutorial-wrapup"]').text()).toContain('Ready for a real')
      // The primary CTA (still the playAgain emit → lobby) is relabelled.
      const cta = wrapper.get('[data-testid="play-again-btn"]')
      expect(cta.text()).toBe('FIND A REAL MATCH')
    })

    it('does not claim completion when the player quit practice early', () => {
      // REGRESSION: practice is now quittable from tick 0 (END PRACTICE), so
      // `mode === 'tutorial'` no longer implies the drills were finished. A
      // learner who bailed at tick 2 was congratulated for basics they never
      // saw — under a red AUDIT VICTORY headline reading like a defeat.
      const wrapper = mountPostGame({ mode: 'tutorial', tutorialComplete: false })
      expect(wrapper.text()).not.toContain('tutorial complete')
      expect(wrapper.text()).toContain('practice ended')
      expect(wrapper.get('[data-testid="tutorial-wrapup"]').text()).toContain(
        'you left before the drills finished',
      )
      // A self-initiated exit must not be framed as a win or a loss.
      expect(wrapper.text()).not.toContain('AUDIT VICTORY')
      expect(wrapper.text()).not.toContain('CHAFF VICTORY')
    })

    it('still emits playAgain from the relabelled tutorial CTA', async () => {
      const wrapper = mountPostGame({ mode: 'tutorial' })
      await wrapper.get('[data-testid="play-again-btn"]').trigger('click')
      expect(wrapper.emitted('playAgain')).toHaveLength(1)
    })
  })

  describe('match MVP', () => {
    it('crowns the highest-impact performer', () => {
      // p1 ("you"): 9k/2d/7a + 31.2k dmg dominates the default roster.
      const mvp = mountPostGame().find('[data-testid="post-game-mvp"]')
      expect(mvp.exists()).toBe(true)
      expect(mvp.get('[data-testid="mvp-name"]').text()).toContain('you')
    })

    // Playtest 3: a bot from the LOSING team was crowned on a CHAFF VICTORY —
    // the end screen contradicting its own banner.
    it('crowns from the winning team even when a loser out-scored everyone', () => {
      const stats = smallStats()
      stats.e1 = makePlayerEndStats({
        kills: 20,
        deaths: 0,
        assists: 10,
        scrip: 12_000,
        heroDamage: 50_000,
      })
      const wrapper = mountPostGame({ stats, winner: 'chaff' })
      const mvp = wrapper.get('[data-testid="post-game-mvp"]')
      expect(mvp.get('[data-testid="mvp-name"]').text()).not.toContain('daemon_carry')
      expect(mvp.classes()).toContain('border-chaff/60')
    })
  })
})

// playtest2 37.png — the practice graduation screen.
describe('PostGame after a practice game (playtest2 #7)', () => {
  it('offers no WATCH REPLAY for practice — practice games archive none — and says why', () => {
    const wrapper = mountPostGame({ mode: 'tutorial', tutorialComplete: true, gameId: 'prac_1' })
    expect(wrapper.find('a[href^="/replay/"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="no-replay"]').text()).toContain('not recorded')
  })

  it('a dev_ game is unrecorded too; a normal match keeps its replay', () => {
    const dev = mountPostGame({ gameId: 'dev_1' })
    expect(dev.find('a[href^="/replay/"]').exists()).toBe(false)
    const real = mountPostGame({ gameId: 'game_abc' })
    expect(real.find('a[href^="/replay/"]').exists()).toBe(true)
    expect(real.find('[data-testid="no-replay"]').exists()).toBe(false)
  })

  it('shows handles and labels instead of raw ids', () => {
    const players = [
      {
        id: 'guest_b24b52530031',
        name: 'guest_b24b52530031',
        heroId: 'echo',
        team: 'chaff' as TeamId,
      },
      {
        id: 'bot_ally_prac_1791624441320_akrqgc',
        name: 'bot_ally_prac_1791624441320_akrqgc',
        heroId: 'sentry',
        team: 'chaff' as TeamId,
      },
      {
        id: 'local_cff6baeb-1111-2222-3333-444455556666',
        name: 'local_cff6baeb-1111-2222-3333-444455556666',
        heroId: 'daemon',
        team: 'audit' as TeamId,
      },
      {
        id: 'bot_enemy1_prac_1791623981819_5o2abc',
        name: 'BOT_ENEMY1_PRAC_1791623981819_5O2ABC',
        heroId: 'kernel',
        team: 'audit' as TeamId,
      },
    ]
    const stats = {
      guest_b24b52530031: makePlayerEndStats({ kills: 1, deaths: 2, assists: 0, heroDamage: 69 }),
      bot_ally_prac_1791624441320_akrqgc: makePlayerEndStats({
        kills: 0,
        deaths: 1,
        assists: 0,
        heroDamage: 510,
      }),
      'local_cff6baeb-1111-2222-3333-444455556666': makePlayerEndStats({
        kills: 0,
        deaths: 2,
        assists: 0,
        heroDamage: 544,
      }),
      bot_enemy1_prac_1791623981819_5o2abc: makePlayerEndStats({
        kills: 3,
        deaths: 0,
        assists: 0,
        heroDamage: 6660,
      }),
    }
    const wrapper = mountPostGame({
      players,
      stats,
      currentPlayerId: 'guest_b24b52530031',
      mode: 'tutorial',
      tutorialComplete: true,
      winner: 'audit', // the MVP is the winning side's — the Kernel bot
    })
    const text = wrapper.text()
    expect(text).not.toMatch(/bot_|BOT_ENEMY|local_|guest_b24/)
    expect(wrapper.get('[data-testid="mvp-name"]').text()).toContain('Kernel')
    expect(wrapper.get('[data-testid="mvp-name"]').text()).toContain('bot')
  })

  it('a real name is left alone', () => {
    const wrapper = mountPostGame()
    expect(wrapper.text()).toContain('kernel_main')
  })

  it('says which drills were skipped instead of "you have the basics"', () => {
    const wrapper = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      skippedDrills: ['cast', 'tap'],
    })
    const wrap = wrapper.get('[data-testid="tutorial-wrapup"]').text()
    expect(wrap).toContain('CAST')
    expect(wrap).toContain('TAP')
    expect(wrap).toMatch(/skipped/i)
    expect(wrap).not.toContain("You've got the basics")
  })

  it('pluralises the last-hit observation ("1 wave unit", not "1 wave units")', () => {
    const wrapper = mountPostGame({
      stats: { ...smallStats(), p1: makePlayerEndStats({ lastHits: 1 }) },
    })
    const text = wrapper.get('[data-testid="what-to-work-on"]').text()
    expect(text).toContain('You stripped 1 wave unit')
    expect(text).not.toContain('1 wave units')
  })
})

// playtest2 #10: a guest's graduation screen called GET /api/player/me, which
// 404s for a guest (no player row) — every time.
describe('the post-tutorial session refresh', () => {
  afterEach(() => vi.unstubAllGlobals())
  const flush = () => new Promise((r) => setTimeout(r, 0))

  it('refreshes a registered graduate', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({}))
    vi.stubGlobal('$fetch', fetchSpy)
    mountPostGame({ mode: 'tutorial', tutorialComplete: true, currentPlayerId: 'p1' })
    await flush()
    expect(fetchSpy).toHaveBeenCalledWith('/api/player/me')
  })

  // GET /api/player/me now answers 200 for a guest (session-shaped, guest:true),
  // so a guest graduate refreshes like anyone else.
  it('refreshes a guest graduate too', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({}))
    vi.stubGlobal('$fetch', fetchSpy)
    mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      currentPlayerId: 'guest_b24b52530031',
      players: [{ id: 'guest_b24b52530031', name: 'g', heroId: 'echo', team: 'chaff' as TeamId }],
    })
    await flush()
    expect(fetchSpy).toHaveBeenCalledWith('/api/player/me')
  })

  it('never asks after skipped drills (nothing banked)', async () => {
    const fetchSpy = vi.fn(() => Promise.resolve({}))
    vi.stubGlobal('$fetch', fetchSpy)
    mountPostGame({ mode: 'tutorial', tutorialComplete: true, skippedDrills: ['tap'] })
    mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      tutorialSummary: { completed: true, mastered: false, skipped: ['cast'] },
    })
    await flush()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stays quiet when the refresh fails', async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error('503')))
    vi.stubGlobal('$fetch', fetchSpy)
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const wrapper = mountPostGame({ mode: 'tutorial', tutorialComplete: true })
    await flush()
    expect(fetchSpy).toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(wrapper.get('[data-testid="tutorial-wrapup"]').text()).toContain('Ready for a real')
    errors.mockRestore()
  })
})

// game_over.tutorial is the server's word on how the drill flow ended; the
// "Moving on" notice parsing (skippedDrills) is only the fallback for a
// game_over without it.
describe('PostGame reads the tutorial game_over block', () => {
  const banner = (w: ReturnType<typeof mountPostGame>) => w.get('[data-testid="post-game"]').text()

  it('names the skipped drills from game_over.tutorial and drops the pass headline', () => {
    const w = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      tutorialSummary: { completed: true, mastered: false, skipped: ['cast', 'tap'] },
    })
    const wrap = w.get('[data-testid="tutorial-wrapup"]').text()
    expect(wrap).toContain('CAST')
    expect(wrap).toContain('TAP')
    expect(wrap).not.toContain("You've got the basics")
    expect(banner(w)).not.toContain('PRACTICE COMPLETE')
    expect(banner(w)).not.toContain('tutorial complete')
    expect(banner(w)).toContain('DRILLS SKIPPED')
  })

  it('prefers the block over the notice fallback', () => {
    const w = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      skippedDrills: ['buy'],
      tutorialSummary: { completed: true, mastered: false, skipped: ['ice'] },
    })
    const wrap = w.get('[data-testid="tutorial-wrapup"]').text()
    expect(wrap).toContain('ICE')
    expect(wrap).not.toContain('BUY')
  })

  it('a mastered run keeps the pass headline', () => {
    const w = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: false,
      tutorialSummary: { completed: true, mastered: true, skipped: [] },
    })
    expect(banner(w)).toContain('PRACTICE COMPLETE')
    expect(w.get('[data-testid="tutorial-wrapup"]').text()).toContain("You've got the basics")
  })

  it('an unfinished flow reads as ended early, whatever the step counter says', () => {
    const w = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      tutorialSummary: { completed: false, mastered: false, skipped: [] },
    })
    expect(banner(w)).toContain('PRACTICE ENDED')
    expect(w.get('[data-testid="tutorial-wrapup"]').text()).toContain(
      'you left before the drills finished',
    )
  })

  // Server contract (playtest 3): game_over.tutorial.reason says WHY it ended.
  it('the explicit reason wins over the reconstructed fields', () => {
    const left = mountPostGame({
      mode: 'tutorial',
      tutorialComplete: true,
      tutorialSummary: { completed: true, mastered: false, skipped: [], reason: 'left_early' },
    })
    expect(banner(left)).toContain('PRACTICE ENDED')
    expect(left.get('[data-testid="tutorial-wrapup"]').text()).toContain(
      'you left before the drills finished',
    )
    const skippedRun = mountPostGame({
      mode: 'tutorial',
      tutorialSummary: { completed: true, mastered: false, skipped: [], reason: 'drills_skipped' },
    })
    expect(banner(skippedRun)).toContain('DRILLS SKIPPED')
    const clean = mountPostGame({
      mode: 'tutorial',
      tutorialSummary: { completed: true, mastered: true, skipped: [], reason: 'mastered' },
    })
    expect(banner(clean)).toContain('PRACTICE COMPLETE')
  })

  it('falls back to the notice-parsed drills when the block is absent', () => {
    const w = mountPostGame({ mode: 'tutorial', tutorialComplete: true, skippedDrills: ['burn'] })
    expect(w.get('[data-testid="tutorial-wrapup"]').text()).toContain('BURN')
    expect(banner(w)).toContain('DRILLS SKIPPED')
  })
})
