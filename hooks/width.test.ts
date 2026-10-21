import { expect, test } from 'claude-code/testing'
import { displayWidth, fitToColumns } from './width'

test('counts emoji as two cells and ascii as one', async () => {
  expect(displayWidth('🧠F5.1📁claude-empty$0')).toBe(22)
  expect(displayWidth('⏸ manual mode on')).toBe(16)
  expect(displayWidth('✔️')).toBe(1)
})

test('cuts text at a cell boundary without splitting a wide character', async () => {
  expect(fitToColumns('ab🧠cd', 3)).toBe('ab')
  expect(fitToColumns('ab🧠cd', 4)).toBe('ab🧠')
  expect(fitToColumns('abc', 10)).toBe('abc')
})
