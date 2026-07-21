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

// Derived from board state — no separate counter to keep in sync.
// Product of step multipliers for each safe open so far; 1.0 before any open.
export function cumulativeMultiplier(board: Board, houseFactor: number = DEFAULT_HOUSE_FACTOR): number {
  const totalSafe = board.width * board.height - board.mineCount
  const opened = openedSafeCount(board)
  let multiplier = 1
  for (let k = 0; k < opened; k++) {
    multiplier *= stepMultiplier(totalSafe - k, board.mineCount, houseFactor)
  }
  return multiplier
}
