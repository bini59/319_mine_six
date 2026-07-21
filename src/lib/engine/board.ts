import type { Board, Cell } from './types'
import type { BoardParams } from './presets'
import { rectCells, type Rect } from './contract'

// density-up (#7): force `count` extra mines inside `rect` at placement time.
export interface ForcedZone {
  rect: Rect
  count: number
}

const HIDDEN_CELL: Cell = { mine: false, adjacent: 0, state: 'hidden' }

function neighborsOf(width: number, height: number, index: number): number[] {
  const x = index % width
  const y = Math.floor(index / width)
  const result: number[] = []
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height) result.push(ny * width + nx)
    }
  }
  return result
}

function outOfBounds(board: Board, x: number, y: number): boolean {
  return x < 0 || x >= board.width || y < 0 || y >= board.height
}

export function generateBoard({ width, height, mines }: BoardParams): Board {
  if (mines < 0 || mines > width * height - 9) {
    throw new Error(`mines must be between 0 and ${width * height - 9} (first-click exemption zone)`)
  }
  return {
    width,
    height,
    mineCount: mines,
    // ponytail: mines deferred until first openCell — first-click exemption without regeneration loops
    cells: Array.from({ length: width * height }, () => HIDDEN_CELL),
    status: 'playing',
    minesPlaced: false,
  }
}

// ponytail: partial Fisher–Yates for the first `count` picks — unbiased, O(count)
function pickRandom(pool: number[], count: number, rng: () => number): number[] {
  const copy = [...pool]
  const picked: number[] = []
  for (let k = 0; k < Math.min(count, copy.length); k++) {
    const j = k + Math.floor(rng() * (copy.length - k))
    ;[copy[j], copy[k]] = [copy[k], copy[j]]
    picked.push(copy[k])
  }
  return picked
}

// Place mines everywhere except the clicked cell and its neighbors, then compute
// adjacency counts once (never recomputed afterwards — numbers always tell the truth).
// Forced zones (density-up) get their mines first, then the global pool fills the rest.
function placeMines(
  board: Board,
  safeIndex: number,
  rng: () => number,
  forcedZones: readonly ForcedZone[] = [],
): readonly Cell[] {
  const safe = new Set([safeIndex, ...neighborsOf(board.width, board.height, safeIndex)])
  const mineSet = new Set<number>()
  for (const { rect, count } of forcedZones) {
    const zonePool = rectCells(rect, board.width).filter((i) => !safe.has(i) && !mineSet.has(i))
    // ponytail: cap when the first-click exemption leaves too few zone candidates —
    // openCell recomputes mineCount from actual placement, so counts stay coherent
    for (const i of pickRandom(zonePool, count, rng)) mineSet.add(i)
  }
  const pool: number[] = []
  for (let i = 0; i < board.cells.length; i++) {
    if (!safe.has(i) && !mineSet.has(i)) pool.push(i)
  }
  for (const i of pickRandom(pool, board.mineCount - mineSet.size, rng)) mineSet.add(i)
  return board.cells.map((cell, i) => ({
    ...cell,
    mine: mineSet.has(i),
    adjacent: neighborsOf(board.width, board.height, i).filter((n) => mineSet.has(n)).length,
  }))
}

function revealMines(cells: readonly Cell[]): Cell[] {
  return cells.map((c) => (c.mine && c.state !== 'open' ? { ...c, state: 'open' } : c))
}

function isWon(board: Pick<Board, 'cells' | 'mineCount'>): boolean {
  const openCount = board.cells.filter((c) => c.state === 'open').length
  return openCount === board.cells.length - board.mineCount
}

// Iterative flood fill: opens `start`, chains through zero-adjacent cells.
// Mutates only the local `cells` copy — callers receive a new Board.
function floodOpen(board: Board, cells: Cell[], start: number): void {
  const stack = [start]
  while (stack.length > 0) {
    const i = stack.pop() as number
    if (cells[i].state !== 'hidden') continue
    cells[i] = { ...cells[i], state: 'open' }
    if (cells[i].adjacent === 0 && !cells[i].mine) {
      for (const n of neighborsOf(board.width, board.height, i)) {
        if (cells[n].state === 'hidden') stack.push(n)
      }
    }
  }
}

export function openCell(
  board: Board,
  x: number,
  y: number,
  rng: () => number = Math.random,
  forcedZones: readonly ForcedZone[] = [],
): Board {
  if (outOfBounds(board, x, y)) return board
  const index = y * board.width + x
  if (board.status !== 'playing' || board.cells[index].state !== 'hidden') return board

  const placed = board.minesPlaced ? board.cells : placeMines(board, index, rng, forcedZones)
  // mineCount follows actual placement — forced zones can be capped by the
  // first-click exemption, and win detection must match reality.
  const mineCount = board.minesPlaced ? board.mineCount : placed.filter((c) => c.mine).length

  if (placed[index].mine) {
    return { ...board, mineCount, minesPlaced: true, cells: revealMines(placed), status: 'lost' }
  }

  const cells = [...placed]
  floodOpen(board, cells, index)
  const won = isWon({ cells, mineCount })
  return { ...board, mineCount, minesPlaced: true, cells, status: won ? 'won' : 'playing' }
}

export function toggleFlag(board: Board, x: number, y: number): Board {
  if (outOfBounds(board, x, y)) return board
  const index = y * board.width + x
  const cell = board.cells[index]
  if (board.status !== 'playing' || cell.state === 'open') return board
  const next: Cell = { ...cell, state: cell.state === 'flagged' ? 'hidden' : 'flagged' }
  const cells = [...board.cells]
  cells[index] = next
  return { ...board, cells }
}

// Chord: on an open numbered cell whose adjacent flag count matches its number,
// open every adjacent hidden non-flagged cell. A wrong flag means hitting a mine.
export function chord(board: Board, x: number, y: number): Board {
  if (outOfBounds(board, x, y)) return board
  const index = y * board.width + x
  const cell = board.cells[index]
  if (board.status !== 'playing' || cell.state !== 'open' || cell.adjacent === 0) return board

  const neighbors = neighborsOf(board.width, board.height, index)
  const flagCount = neighbors.filter((n) => board.cells[n].state === 'flagged').length
  if (flagCount !== cell.adjacent) return board

  const targets = neighbors.filter((n) => board.cells[n].state === 'hidden')
  if (targets.some((n) => board.cells[n].mine)) {
    return { ...board, cells: revealMines(board.cells), status: 'lost' }
  }

  const cells = [...board.cells]
  for (const t of targets) floodOpen(board, cells, t)
  const won = isWon({ cells, mineCount: board.mineCount })
  return { ...board, cells, status: won ? 'won' : 'playing' }
}
