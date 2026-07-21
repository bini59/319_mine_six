import type { Board } from './types'

export const DEFAULT_HOUSE_FACTOR = 0.97

// Fair step is 1 / P(safe); the house factor (< 1) shaves the edge.
// Denser mines → lower P(safe) → steeper curve, exactly as PRD 4.2 wants.
export function stepMultiplier(
  remainingSafe: number,
  remainingMines: number,
  houseFactor: number = DEFAULT_HOUSE_FACTOR,
): number {
  if (remainingSafe <= 0 || remainingMines < 0) {
    throw new Error('stepMultiplier: remainingSafe must be > 0 and remainingMines >= 0')
  }
  return (houseFactor * (remainingSafe + remainingMines)) / remainingSafe
}

export function openedSafeCount(board: Board): number {
  return board.cells.filter((c) => c.state === 'open' && !c.mine).length
}

// The board carries its own multiplier, accumulated one step per risked click
// inside openCell/chord (M05 balance): the exempt first click pays nothing and
// flood reveals are free information. Deriving a per-revealed-cell product here
// let a single lucky click pay 1.15^flood — simulation.test.ts measured EV in
// the billions before the change.
export function cumulativeMultiplier(board: Board): number {
  return board.multiplier ?? 1
}
