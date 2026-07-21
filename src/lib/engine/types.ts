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
}
