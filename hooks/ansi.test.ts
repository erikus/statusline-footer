import { expect, test } from 'claude-code/testing'
import { paletteColor, parseAnsi } from './ansi'

test('paletteColor maps the 256-color palette', async () => {
  expect(paletteColor(0)).toBe('black')
  expect(paletteColor(9)).toBe('redBright')
  expect(paletteColor(16)).toBe('#000000')
  expect(paletteColor(39)).toBe('#00afff')
  expect(paletteColor(231)).toBe('#ffffff')
  expect(paletteColor(232)).toBe('#080808')
  expect(paletteColor(255)).toBe('#eeeeee')
  expect(paletteColor(256)).toBeUndefined()
})

test('parseAnsi splits the status line into styled runs without control characters', async () => {
  const runs = parseAnsi('\x1b[38;5;170m🧠F5.1\x1b[0m \x1b[2mdim\x1b[0m\x1b[48;5;22m▁\x1b[49mx')
  expect(runs).toEqual([
    { text: '🧠F5.1', color: '#d75fd7', backgroundColor: undefined, dim: false, bold: false },
    { text: ' ', color: undefined, backgroundColor: undefined, dim: false, bold: false },
    { text: 'dim', color: undefined, backgroundColor: undefined, dim: true, bold: false },
    { text: '▁', color: undefined, backgroundColor: '#005f00', dim: false, bold: false },
    { text: 'x', color: undefined, backgroundColor: undefined, dim: false, bold: false },
  ])
  for (const run of runs) expect(run.text).not.toMatch(/[\x00-\x1f]/)
})

test('parseAnsi drops non-SGR escapes', async () => {
  expect(parseAnsi('a\x1b[2Kb\x1b]0;title\x07c')).toEqual([
    { text: 'abc', color: undefined, backgroundColor: undefined, dim: false, bold: false },
  ])
})
