/**
 * 16x16 pixel art data for all 10 heroes.
 *
 * Each hero is defined with a color palette and a grid of palette indices.
 * Grid characters: '0' = transparent, '1'-'9','a'-'f' = palette index.
 */

type PixelGrid = (string | 0)[][]

interface HeroSpriteData {
  palette: string[]
  grid: string[]
}

function buildGrid(palette: string[], rows: string[]): PixelGrid {
  return rows.map((row) =>
    Array.from(row).map((c) => {
      if (c === '0') return 0
      const idx = Number.parseInt(c, 16) - 1
      return palette[idx] ?? 0
    }),
  )
}

// ── Hero Sprite Definitions ──────────────────────────────────────

const sprites: Record<string, HeroSpriteData> = {
  // ── Echo ── Carry, Ranged — Recursive signal, antenna, wave motif
  // Cyan/teal energy waves
  echo: {
    palette: [
      '#03191f', // 1: darkest shadow
      '#072e38', // 2: dark teal
      '#0a5e6e', // 3: mid teal
      '#12a5b8', // 4: bright teal
      '#00d4ff', // 5: cyan energy
      '#5ee8ff', // 6: light cyan
      '#c0ffff', // 7: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000006000600000', // 0  antenna tips
      '0000055000550000', // 1  antenna stems
      '0000544554400000', // 2  energy crown
      '0003444444430000', // 3  head top
      '0034444444430000', // 4  head
      '0034367763430000', // 5  eyes (6=glow, 7=bright)
      '0034443344430000', // 6  mid face
      '0003443344300000', // 7  lower face
      '0000344443000000', // 8  chin
      '0000034430000000', // 9  neck
      '0003455554300000', // 10 collar with energy
      '0034344443430000', // 11 shoulders
      '0343455543430000', // 12 upper chest energy
      '0343344443430000', // 13 chest
      '0034344443430000', // 14 body
      '0003433334300000', // 15 base
    ],
  },

  // ── Sentry ── Support, Ranged — Watchpoint sentinel, big visor
  // Green body with gold visor
  sentry: {
    palette: [
      '#0a2a1a', // 1: darkest green
      '#1a4a2a', // 2: dark green
      '#2e8a4a', // 3: green
      '#2ecc71', // 4: bright green
      '#b8860b', // 5: dark gold
      '#f39c12', // 6: gold
      '#f7dc6f', // 7: light gold
      '#ffffff', // 8: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000044444400000', // 0  helmet top
      '0000444444440000', // 1  helmet
      '0003344444433000', // 2  helmet sides
      '0033334444333300', // 3  helmet wider
      '0034566666654300', // 4  VISOR (gold bar)
      '0034576676754300', // 5  visor glow
      '0033456666543300', // 6  lower visor
      '0003333333333000', // 7  lower face
      '0000334444330000', // 8  chin
      '0000033333000000', // 9  neck
      '0003344443430000', // 10 collar
      '0033443334430000', // 11 shoulders
      '0323344443432300', // 12 upper body
      '0322334443223200', // 13 body
      '0322334443322300', // 14 body
      '0022333333322000', // 15 base
    ],
  },

  // ── Daemon ── Assassin, Melee — Shadow process, hooded
  // Dark purple/black with red glowing eyes
  daemon: {
    palette: [
      '#050510', // 1: near black
      '#0f0a1e', // 2: very dark purple
      '#1e1038', // 3: dark purple
      '#3c1f6e', // 4: purple
      '#6c3483', // 5: mid purple
      '#9b59b6', // 6: bright purple
      '#e74c3c', // 7: red eye glow
      '#d7bde2', // 8: light purple
    ],
    //          0123456789abcdef
    grid: [
      '0000000345000000', // 0  hood peak
      '0000003455300000', // 1  hood tip
      '0000034555400000', // 2  hood upper
      '0000345555430000', // 3  hood
      '0033442222443300', // 4  hood shadow face
      '0032217117223000', // 5  glowing red eyes
      '0032211112230000', // 6  deep shadow
      '0033221122330000', // 7  lower shadow
      '0003322223300000', // 8  chin
      '0000332223000000', // 9  neck
      '0034543223454300', // 10 cloak shoulders
      '0345554334555400', // 11 wide cloak
      '0324545334545200', // 12 cloak body
      '0322345554322300', // 13 body
      '0322334553322300', // 14 body v-shape
      '0022333443322000', // 15 base
    ],
  },

  // ── Kernel ── Tank, Melee — Core processor, heavy armor
  // Amber/gold with circuit patterns
  kernel: {
    palette: [
      '#1a1000', // 1: very dark amber
      '#3a2800', // 2: dark amber
      '#6e4a00', // 3: amber
      '#b8860b', // 4: dark gold
      '#d4a017', // 5: gold
      '#f39c12', // 6: bright gold
      '#f7dc6f', // 7: light gold
      '#fff8dc', // 8: cream highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000455555540000', // 0  flat-top helmet
      '0004565665654000', // 1  helmet circuits
      '0044555555554400', // 2  helmet wide
      '0044555555554400', // 3  helmet
      '0043387783344000', // 4  visor eyes (8=bright)
      '0043333344334000', // 5  face plate
      '0044363336444000', // 6  face circuits
      '0004433664340000', // 7  jaw
      '0000444444400000', // 8  chin plate
      '0000043443000000', // 9  neck
      '0455454334545500', // 10 big pauldrons
      '4455543334554540', // 11 wide shoulders
      '0454445445444500', // 12 upper body
      '0433456556344300', // 13 chest circuits
      '0433445564344300', // 14 body
      '0033444554433000', // 15 base
    ],
  },

  // ── Regex ── Mage, Ranged — Pattern matcher, wizard hat
  // Blue/cyan with magical glow
  regex: {
    palette: [
      '#040a20', // 1: very dark blue
      '#0a1a40', // 2: dark blue
      '#1a3a7e', // 3: blue
      '#2980b9', // 4: bright blue
      '#00d4ff', // 5: cyan
      '#7fefff', // 6: light cyan
      '#e0ffff', // 7: white glow
    ],
    //          0123456789abcdef
    grid: [
      '0000000060000000', // 0  hat tip
      '0000000545000000', // 1  hat tip
      '0000004434000000', // 2  hat
      '0000044334400000', // 3  hat wider
      '0000434334300000', // 4  hat lower
      '0055555555555000', // 5  BRIM (wide)
      '0003347734300000', // 6  face + eyes (7=glow)
      '0003333333300000', // 7  face
      '0000332233000000', // 8  chin
      '0000032230000000', // 9  neck
      '0003443234400000', // 10 robe collar
      '0033443234430000', // 11 robe shoulders
      '0323345543230000', // 12 robe body glow
      '0322334433220000', // 13 robe
      '0322333333220000', // 14 robe
      '0022333333220000', // 15 base
    ],
  },

  // ── Socket ── Offlaner, Melee — Network connector, cables
  // Electric blue with white sparks
  socket: {
    palette: [
      '#06101e', // 1: very dark
      '#0a2040', // 2: dark navy
      '#1a4a7e', // 3: blue
      '#3498db', // 4: bright blue
      '#5dade2', // 5: light blue
      '#ffffff', // 6: white spark
      '#aed6f1', // 7: pale blue
    ],
    //          0123456789abcdef
    grid: [
      '0000000000000000', // 0  empty
      '0000044444400000', // 1  head top
      '0000445445400000', // 2  head accents
      '0004434434440000', // 3  head
      '0004367763440000', // 4  eyes (6=spark 7=pale)
      '0004433334440000', // 5  face
      '0000443344400000', // 6  lower face
      '0000044334000000', // 7  chin
      '0600003443000060', // 8  neck + cable sparks
      '0560343334306500', // 9  cable connections
      '0454443334445400', // 10 shoulders + cables
      '6345533333554360', // 11 wide + sparks
      '0334343343433300', // 12 body
      '0322334434322300', // 13 body
      '0322333333322300', // 14 body
      '0022333333322000', // 15 base
    ],
  },

  // ── Proxy ── Support, Ranged — Intermediary, dual-faced
  // Left half green, right half silver — split design
  proxy: {
    palette: [
      '#0a1a0a', // 1: dark green shadow
      '#1a3a1a', // 2: dark green
      '#27ae60', // 3: green
      '#2ecc71', // 4: bright green
      '#4a4a4e', // 5: dark silver
      '#7f8c8d', // 6: silver
      '#bdc3c7', // 7: light silver
      '#ecf0f1', // 8: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000000000000000', // 0  empty
      '0000044356700000', // 1  top split
      '0000433556770000', // 2  head
      '0004333556670000', // 3  head wider
      '0043333556667000', // 4  forehead
      '0043483568760000', // 5  eyes (8=bright both sides)
      '0043333566670000', // 6  face
      '0003322556670000', // 7  lower face
      '0000332556600000', // 8  chin split
      '0000032256000000', // 9  neck
      '0003432256670000', // 10 collar
      '0034432256770000', // 11 shoulders
      '0323432567570000', // 12 body
      '0322332566570000', // 13 body
      '0322322556570000', // 14 body
      '0022322556500000', // 15 base
    ],
  },

  // ── Malloc ── Carry, Melee — Memory allocator, blocky
  // Gold/amber with block patterns
  malloc: {
    palette: [
      '#1a1200', // 1: dark shadow
      '#3a2a00', // 2: dark amber
      '#6e5000', // 3: amber
      '#a07a00', // 4: medium gold
      '#d4a017', // 5: gold
      '#f39c12', // 6: bright gold
      '#f7dc6f', // 7: light gold
      '#ffeaa7', // 8: cream highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000000000000000', // 0  empty
      '0005555555555000', // 1  flat square head top
      '0005666666665000', // 2  head
      '0005655555565000', // 3  head inner
      '0005687758650000', // 4  eyes (8=bright 7=glow)
      '0005655555650000', // 5  face
      '0005556666550000', // 6  mouth block
      '0005555555550000', // 7  jaw (boxy)
      '0000555555500000', // 8  chin block
      '0000044554000000', // 9  neck
      '0055544445550000', // 10 shoulders blocky
      '0056654456650000', // 11 shoulders
      '0056555565650000', // 12 chest blocks
      '0055566655550000', // 13 block pattern
      '0045555665540000', // 14 body
      '0044555555440000', // 15 base
    ],
  },

  // ── Cipher ── Assassin, Melee — Encryption, masked ninja
  // Dark green with matrix data lines
  cipher: {
    palette: [
      '#050a05', // 1: near black-green
      '#0a1e0a', // 2: very dark green
      '#143814', // 3: dark green
      '#1e6e1e', // 4: green
      '#2ecc71', // 5: bright green
      '#7dcea0', // 6: light green
      '#d5f5e3', // 7: matrix white-green
    ],
    //          0123456789abcdef
    grid: [
      '0000000000000000', // 0  empty
      '0000034444300000', // 1  head top
      '0000344444430000', // 2  head
      '0003434444340000', // 3  head
      '0003375537300000', // 4  eyes (7=matrix, 5=glow)
      '0003333333300000', // 5  upper face
      '0003222222300000', // 6  MASK dark band
      '0003215521300000', // 7  mask vents (5=green)
      '0000322223000000', // 8  mask lower
      '0000032230000000', // 9  neck
      '0003433234300000', // 10 collar
      '0034433234430000', // 11 shoulders
      '0323345534320000', // 12 body matrix lines
      '0322354453220000', // 13 body data
      '0322335533220000', // 14 body
      '0022333333220000', // 15 base
    ],
  },

  // ── Firewall ── Tank, Melee — Shield wall, flame barrier
  // Red/orange with flame effects
  firewall: {
    palette: [
      '#1a0500', // 1: very dark red
      '#3e0a00', // 2: dark red
      '#8b1a00', // 3: dark red-orange
      '#c0392b', // 4: red
      '#e74c3c', // 5: bright red
      '#e67e22', // 6: orange
      '#f39c12', // 7: gold/fire
      '#f7dc6f', // 8: yellow highlight
    ],
    //          0123456789abcdef
    grid: [
      '0800000000000080', // 0  flame tips
      '0760000000000670', // 1  flames
      '7650045555400567', // 2  flame + helmet top
      '6500445555440056', // 3  flame + helmet
      '0004433344440000', // 4  helmet
      '0004387783440000', // 5  eyes (8=bright 7=glow)
      '0004433333440000', // 6  face
      '0000443553400000', // 7  mouth (5=red glow)
      '0000044444000000', // 8  chin
      '0000034443000000', // 9  neck
      '8764543334546780', // 10 shoulders with flames
      '7655543334555670', // 11 wide shoulders
      '0544554455445400', // 12 upper body
      '0434455445443400', // 13 body
      '0433445554433400', // 14 body shield
      '0033444554433000', // 15 base
    ],
  },

  // ── Null ── Mage, Ranged — Void caster, dark energy
  // Dark purple/void black with magenta energy
  null_ref: {
    palette: [
      '#08001a', // 1: void black
      '#15002e', // 2: very dark purple
      '#2a0052', // 3: dark purple
      '#4a0080', // 4: purple
      '#7b00b8', // 5: bright purple
      '#c800ff', // 6: magenta energy
      '#e066ff', // 7: light magenta
      '#ffbbff', // 8: pink highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000000870000000', // 0  energy wisp
      '0000007657000000', // 1  energy glow
      '0000066556600000', // 2  head crown
      '0000455555540000', // 3  head top
      '0004455555440000', // 4  head
      '0004487784440000', // 5  eyes (8=bright 7=glow)
      '0004444444440000', // 6  face
      '0000433553400000', // 7  lower face
      '0000044444000000', // 8  chin
      '0000034443000000', // 9  neck
      '0006534445360000', // 10 collar with energy
      '0065534445356000', // 11 shoulders
      '0653445544345600', // 12 upper body energy
      '0633344443336000', // 13 body
      '0033344443330000', // 14 body
      '0023333333320000', // 15 base
    ],
  },

  // ── Lambda ── Mage, Ranged — Functional caster, code brackets
  // Neon green/lime with code motif
  lambda: {
    palette: [
      '#001a00', // 1: very dark green
      '#003300', // 2: dark green
      '#006600', // 3: forest green
      '#00aa00', // 4: green
      '#00ff00', // 5: neon green
      '#66ff66', // 6: light green
      '#bbffbb', // 7: pale green glow
      '#ffff00', // 8: yellow accent
    ],
    //          0123456789abcdef
    grid: [
      '0000005650000000', // 0  lambda tip
      '0000045654000000', // 1  lambda symbol top
      '0000443453400000', // 2  lambda arms
      '0004434434400000', // 3  head top
      '0004444444400000', // 4  head
      '0004468864400000', // 5  eyes (8=bright 6=glow)
      '0004443344400000', // 6  face
      '0000443344000000', // 7  lower face
      '0000044340000000', // 8  chin
      '0000034430000000', // 9  neck
      '0003444544300000', // 10 collar
      '0034445544430000', // 11 shoulders
      '0324345543230000', // 12 body with code lines
      '0322345543220000', // 13 body
      '0322344443220000', // 14 body
      '0022333333220000', // 15 base
    ],
  },

  // ── Mutex ── Offlaner, Melee — Lock/padlock, bronze armor
  // Bronze/copper with lock shape
  mutex: {
    palette: [
      '#1a0e00', // 1: dark shadow
      '#3a2200', // 2: dark bronze
      '#6e4000', // 3: bronze
      '#a06818', // 4: medium bronze
      '#c48830', // 5: copper
      '#d4a050', // 6: light copper
      '#e8c878', // 7: gold highlight
      '#fff0c0', // 8: cream highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000055555500000', // 0  lock arch top
      '0000565005650000', // 1  lock arch
      '0000560000650000', // 2  lock arch sides
      '0005566666550000', // 3  head top (lock body)
      '0005555555550000', // 4  head
      '0005587785550000', // 5  eyes (8=bright 7=glow)
      '0005555555550000', // 6  face
      '0005546645550000', // 7  keyhole motif
      '0000555555500000', // 8  chin
      '0000044554000000', // 9  neck
      '0055544445555000', // 10 wide pauldrons
      '0565544445565000', // 11 shoulders
      '0555545454555000', // 12 chest
      '0455456654554000', // 13 body
      '0445455554444000', // 14 body
      '0044445554440000', // 15 base
    ],
  },

  // ── Ping ── Offlaner, Ranged — Network ping, circular waves
  // Bright yellow/electric with wave pattern
  ping: {
    palette: [
      '#1a1400', // 1: dark shadow
      '#3a3000', // 2: dark yellow
      '#6e5e00', // 3: amber
      '#a09000', // 4: yellow-amber
      '#d4c800', // 5: bright yellow
      '#ffee00', // 6: neon yellow
      '#ffff66', // 7: light yellow
      '#ffffff', // 8: white spark
    ],
    //          0123456789abcdef
    grid: [
      '0000000870000000', // 0  signal spark
      '0000007667000000', // 1  signal top
      '0000066566600000', // 2  signal ring
      '0000455555400000', // 3  head top
      '0004444444400000', // 4  head
      '0004478874400000', // 5  eyes (8=bright 7=glow)
      '0004444444400000', // 6  face
      '0000443344000000', // 7  lower face
      '0000044440000000', // 8  chin
      '0000034430000000', // 9  neck
      '0073444544370000', // 10 collar + wave rings
      '0734444444370000', // 11 shoulders + waves
      '7334445544337000', // 12 body + wave pattern
      '0332344443230000', // 13 body
      '0322344443220000', // 14 body
      '0022333333220000', // 15 base
    ],
  },

  // ── Cron ── Support, Melee — Clock/timer, blue armor
  // Blue/silver with clock motif
  cron: {
    palette: [
      '#000a1e', // 1: very dark blue
      '#001a3e', // 2: dark blue
      '#003a7e', // 3: blue
      '#0060b8', // 4: bright blue
      '#5090d0', // 5: light blue
      '#90b8e0', // 6: pale blue
      '#c0c8d0', // 7: silver
      '#f0f4ff', // 8: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000044444400000', // 0  clock top
      '0004444844440000', // 1  clock face (8=12 o'clock)
      '0004440844400000', // 2  clock hands
      '0044440844440000', // 3  head / clock
      '0044448444440000', // 4  head (8=center)
      '0033478874330000', // 5  eyes (8=bright 7=glow)
      '0033444444330000', // 6  face
      '0003332233300000', // 7  lower face
      '0000334433000000', // 8  chin
      '0000033330000000', // 9  neck
      '0034443334430000', // 10 collar
      '0344443334440000', // 11 shoulders
      '0323345543230000', // 12 body
      '0322344443220000', // 13 body
      '0322334433220000', // 14 body
      '0022333333220000', // 15 base
    ],
  },

  // ── Traceroute ── Assassin, Ranged — Arrow/path trail
  // Red/orange with arrow motif
  traceroute: {
    palette: [
      '#1a0200', // 1: very dark red
      '#3e0800', // 2: dark red
      '#7e1800', // 3: dark red-orange
      '#b83000', // 4: red-orange
      '#e85000', // 5: orange
      '#ff7820', // 6: bright orange
      '#ffa040', // 7: light orange
      '#ffd080', // 8: cream highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000000600000000', // 0  arrow tip
      '0000005650000000', // 1  arrowhead
      '0000045554000000', // 2  arrowhead wider
      '0000444444400000', // 3  head top
      '0004444444400000', // 4  head
      '0004478874400000', // 5  eyes (8=bright 7=glow)
      '0004443344400000', // 6  face
      '0000443344000000', // 7  lower face
      '0000044340000000', // 8  chin
      '0000034430000000', // 9  neck
      '0003454454300000', // 10 collar
      '0034445544430000', // 11 shoulders
      '0323344443230000', // 12 body
      '6322345543226000', // 13 body + trail marks
      '0622344443260000', // 14 body + trail
      '0062333333600000', // 15 base + trail
    ],
  },

  // ── Thread ── Carry, Ranged — Interweaving lines, multi-color
  // Multi-color with interwoven threads
  thread: {
    palette: [
      '#0a0a1e', // 1: dark base
      '#1e1e3e', // 2: dark indigo
      '#3a6ee8', // 3: blue thread
      '#e83a6e', // 4: red thread
      '#3ae86e', // 5: green thread
      '#e8c83a', // 6: gold thread
      '#a0b0ff', // 7: light blue glow
      '#ffffff', // 8: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0000004540000000', // 0  thread cross top
      '0000043534000000', // 1  thread cross
      '0000334453300000', // 2  head crown
      '0003225522300000', // 3  head top
      '0002334433200000', // 4  head
      '0002387783200000', // 5  eyes (8=bright 7=glow)
      '0002234432200000', // 6  face
      '0000223322000000', // 7  lower face
      '0000022220000000', // 8  chin
      '0000022220000000', // 9  neck
      '0034522254300000', // 10 collar (thread colors)
      '0345233325430000', // 11 shoulders
      '3452233322543000', // 12 body threads
      '0432255224340000', // 13 body woven
      '0422233322240000', // 14 body
      '0022222222200000', // 15 base
    ],
  },

  // ── Cache ── Tank, Ranged — Layered box/storage shape
  // Teal/silver with stacked layers
  cache: {
    palette: [
      '#001a18', // 1: very dark teal
      '#003a34', // 2: dark teal
      '#006a60', // 3: teal
      '#00a090', // 4: bright teal
      '#40c8b8', // 5: light teal
      '#80e0d0', // 6: pale teal
      '#b0b8c0', // 7: silver
      '#e0f0f0', // 8: white highlight
    ],
    //          0123456789abcdef
    grid: [
      '0077777777770000', // 0  top layer
      '0076666666670000', // 1  top layer front
      '0055555555555000', // 2  2nd layer top
      '0054444444450000', // 3  2nd layer front
      '0004444444400000', // 4  head top
      '0004478874400000', // 5  eyes (8=bright 7=glow)
      '0004443344400000', // 6  face
      '0000443344000000', // 7  lower face
      '0000044440000000', // 8  chin
      '0000034430000000', // 9  neck
      '0003444544300000', // 10 collar
      '0034455554430000', // 11 shoulders
      '0324455554320000', // 12 body
      '0322344443220000', // 13 body
      '0322334433220000', // 14 body
      '0022333333220000', // 15 base
    ],
  },
}

// ── Export ────────────────────────────────────────────────────────

export const heroPixelData: Record<string, PixelGrid> = Object.fromEntries(
  Object.entries(sprites).map(([id, { palette, grid }]) => [id, buildGrid(palette, grid)]),
)
