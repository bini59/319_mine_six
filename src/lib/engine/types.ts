export type CellState = 'hidden' | 'open' | 'flagged'

export interface Cell {
  mine: boolean
  adjacent: number
  state: CellState
}

export type GameStatus = 'playing' | 'won' | 'lost'

export interface Board {
  width: number
  height: number
  mineCount: number
  // ponytail: 1D array, index = y * width + x — simpler copy/flood than nested arrays
  cells: readonly Cell[]
  status: GameStatus
  minesPlaced: boolean
  // Cells revealed by the exempt first click (M05 balance): they carried zero
  // risk, so contract clears must not credit them.
  // Absent/empty on hand-crafted boards — everything is then priced as risky.
  freeOpened?: readonly number[]
  // Cumulative payout multiplier, accumulated per risked CLICK at click time
  // (M05 balance): flood reveals are free information — charging a step per
  // revealed cell paid 1.15^flood for one cell of risk (measured EV ≈ 2×10⁹
  // in simulation.test.ts). Absent = 1 (fresh or hand-crafted board).
  multiplier?: number
}
