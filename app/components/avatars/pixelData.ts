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
}

// ── Export ────────────────────────────────────────────────────────

export const heroPixelData: Record<string, PixelGrid> = Object.fromEntries(
  Object.entries(sprites).map(([id, { palette, grid }]) => [id, buildGrid(palette, grid)]),
)
