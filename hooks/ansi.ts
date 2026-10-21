/**
 * Splits a line carrying ANSI SGR escapes (colors, dim, bold) into styled runs,
 * so a drawing can carry the script's colors without the control characters a
 * Text element refuses.
 */

/** A run of text drawn in one style. */
export type StyledRun = {
  text: string
  color?: string
  backgroundColor?: string
  dim: boolean
  bold: boolean
}

type Style = Omit<StyledRun, 'text'>

/**
 * Every escape sequence: an SGR escape captures its parameters; any other (cursor
 * moves, OSC titles) captures nothing and is dropped from the text.
 */
const ESCAPE_PATTERN = /\x1b\[([0-9;]*)m|\x1b\][^\x07]*\x07|\x1b\[[0-9;?]*[A-Za-z]|\x1b[^[\]]/g
/** Other C0 control characters a Text element also refuses, dropped. */
const CONTROL_PATTERN = /[\x00-\x08\x0b-\x1f\x7f]/g

const SGR_RESET = 0
const SGR_BOLD = 1
const SGR_DIM = 2
const SGR_NORMAL_INTENSITY = 22
const SGR_FOREGROUND_EXTENDED = 38
const SGR_FOREGROUND_DEFAULT = 39
const SGR_BACKGROUND_EXTENDED = 48
const SGR_BACKGROUND_DEFAULT = 49
const SGR_FOREGROUND_BASIC_FIRST = 30
const SGR_FOREGROUND_BASIC_LAST = 37
const SGR_BACKGROUND_BASIC_FIRST = 40
const SGR_BACKGROUND_BASIC_LAST = 47
const SGR_FOREGROUND_BRIGHT_FIRST = 90
const SGR_FOREGROUND_BRIGHT_LAST = 97
const SGR_BACKGROUND_BRIGHT_FIRST = 100
const SGR_BACKGROUND_BRIGHT_LAST = 107
const EXTENDED_MODE_256 = 5
const EXTENDED_MODE_RGB = 2

/** The 16 named colors of the basic SGR range, as the surface names them. */
const BASIC_COLOR_NAMES: readonly string[] = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'gray', 'redBright', 'greenBright', 'yellowBright', 'blueBright', 'magentaBright', 'cyanBright', 'whiteBright',
]
/** Where the bright half of the basic color names starts. */
const BRIGHT_COLOR_OFFSET = 8
/** Hex of the 16 basic colors in the xterm palette, for 256-color indices 0–15. */
const BASIC_COLOR_HEX: readonly string[] = [
  '#000000', '#800000', '#008000', '#808000', '#000080', '#800080', '#008080', '#c0c0c0',
  '#808080', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#ffffff',
]
/** Channel levels of the 6x6x6 color cube, 256-color indices 16–231. */
const CUBE_LEVELS: readonly number[] = [0, 95, 135, 175, 215, 255]
const CUBE_FIRST_INDEX = 16
const CUBE_SIDE = 6
const GRAY_FIRST_INDEX = 232
const GRAY_FIRST_LEVEL = 8
const GRAY_STEP = 10
const PALETTE_SIZE = 256

function hex2(channel: number): string {
  return channel.toString(16).padStart(2, '0')
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`
}

/** The hex color of a 256-color palette index, or undefined when out of range. */
export function paletteHex(index: number): string | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= PALETTE_SIZE) return undefined
  if (index < CUBE_FIRST_INDEX) return BASIC_COLOR_HEX[index]
  if (index < GRAY_FIRST_INDEX) {
    const cube = index - CUBE_FIRST_INDEX
    const r = CUBE_LEVELS[Math.floor(cube / (CUBE_SIDE * CUBE_SIDE))] ?? 0
    const g = CUBE_LEVELS[Math.floor(cube / CUBE_SIDE) % CUBE_SIDE] ?? 0
    const b = CUBE_LEVELS[cube % CUBE_SIDE] ?? 0
    return rgbHex(r, g, b)
  }
  const level = GRAY_FIRST_LEVEL + (index - GRAY_FIRST_INDEX) * GRAY_STEP
  return rgbHex(level, level, level)
}

/** Reads one extended color (`38;5;n` or `38;2;r;g;b`) from `codes` at `at`; returns the color and the codes consumed. */
function readExtendedColor(codes: readonly number[], at: number): { color?: string; consumed: number } {
  const mode = codes[at]
  if (mode === EXTENDED_MODE_256) {
    return { color: paletteHex(codes[at + 1] ?? -1), consumed: 2 }
  }
  if (mode === EXTENDED_MODE_RGB) {
    const [r, g, b] = [codes[at + 1], codes[at + 2], codes[at + 3]]
    if (r === undefined || g === undefined || b === undefined) return { consumed: 4 }
    return { color: rgbHex(r, g, b), consumed: 4 }
  }
  return { consumed: 1 }
}

function applySgr(style: Style, params: string): Style {
  const next: Style = { ...style }
  const codes = params === '' ? [SGR_RESET] : params.split(';').map((p) => (p === '' ? SGR_RESET : Number(p)))
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? SGR_RESET
    if (code === SGR_RESET) {
      next.color = undefined
      next.backgroundColor = undefined
      next.dim = false
      next.bold = false
    } else if (code === SGR_BOLD) next.bold = true
    else if (code === SGR_DIM) next.dim = true
    else if (code === SGR_NORMAL_INTENSITY) { next.bold = false; next.dim = false }
    else if (code === SGR_FOREGROUND_DEFAULT) next.color = undefined
    else if (code === SGR_BACKGROUND_DEFAULT) next.backgroundColor = undefined
    else if (code >= SGR_FOREGROUND_BASIC_FIRST && code <= SGR_FOREGROUND_BASIC_LAST) {
      next.color = BASIC_COLOR_NAMES[code - SGR_FOREGROUND_BASIC_FIRST]
    } else if (code >= SGR_BACKGROUND_BASIC_FIRST && code <= SGR_BACKGROUND_BASIC_LAST) {
      next.backgroundColor = BASIC_COLOR_NAMES[code - SGR_BACKGROUND_BASIC_FIRST]
    } else if (code >= SGR_FOREGROUND_BRIGHT_FIRST && code <= SGR_FOREGROUND_BRIGHT_LAST) {
      next.color = BASIC_COLOR_NAMES[code - SGR_FOREGROUND_BRIGHT_FIRST + BRIGHT_COLOR_OFFSET]
    } else if (code >= SGR_BACKGROUND_BRIGHT_FIRST && code <= SGR_BACKGROUND_BRIGHT_LAST) {
      next.backgroundColor = BASIC_COLOR_NAMES[code - SGR_BACKGROUND_BRIGHT_FIRST + BRIGHT_COLOR_OFFSET]
    } else if (code === SGR_FOREGROUND_EXTENDED || code === SGR_BACKGROUND_EXTENDED) {
      const { color, consumed } = readExtendedColor(codes, i + 1)
      if (code === SGR_FOREGROUND_EXTENDED) next.color = color
      else next.backgroundColor = color
      i += consumed
    }
  }
  return next
}

/** Splits `line` into styled runs; empty runs are dropped. */
export function parseAnsi(line: string): StyledRun[] {
  const runs: StyledRun[] = []
  let style: Style = { dim: false, bold: false }
  let last = 0
  const push = (text: string) => {
    const safe = text.replace(CONTROL_PATTERN, '')
    if (safe !== '') runs.push({ text: safe, ...style })
  }
  let text = ''
  for (const match of line.matchAll(ESCAPE_PATTERN)) {
    text += line.slice(last, match.index)
    last = match.index + match[0].length
    const params = match[1]
    if (params === undefined) continue
    push(text)
    text = ''
    style = applySgr(style, params)
  }
  push(text + line.slice(last))
  return runs
}
