import { describe, expect, it } from 'vitest'
import { chord, generateBoard, openCell, toggleFlag } from './board'
import { BEGINNER, EXPERT, custom } from './presets'
import type { Board, Cell } from './types'

// Brute-force adjacency, independent of the engine implementation.
function bruteAdjacent(width: number, height: number, mines: Set<number>, index: number): number {
  const x = index % width
  const y = Math.floor(index / width)
  let count = 0
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mines.has(ny * width + nx)) count++
    }
  }
  return count
}

// Hand-crafted board with mines already placed — for deterministic scenarios.
function makeBoard(width: number, height: number, mineIndices: number[]): Board {
  const mines = new Set(mineIndices)
  const cells: Cell[] = Array.from({ length: width * height }, (_, i) => ({
    mine: mines.has(i),
    adjacent: bruteAdjacent(width, height, mines, i),
    state: 'hidden',
  }))
  return { width, height, mineCount: mineIndices.length, cells, status: 'playing', minesPlaced: true }
}

describe('generateBoard', () => {
  it('creates a hidden, mine-free board until first click', () => {
    const board = generateBoard(BEGINNER)
    expect(board.cells).toHaveLength(81)
    expect(board.minesPlaced).toBe(false)
    expect(board.status).toBe('playing')
    expect(board.cells.every((c) => !c.mine && c.state === 'hidden')).toBe(true)
  })
})

describe('presets', () => {
  it('custom validates bounds', () => {
    expect(() => custom(0, 5, 1)).toThrow()
    expect(() => custom(5, 5, 0)).toThrow()
    expect(() => custom(5, 5, 17)).toThrow() // 25 - 9 = 16 max
    expect(custom(5, 5, 16)).toEqual({ width: 5, height: 5, mines: 16 })
    expect(() => custom(5.5, 5, 3)).toThrow()
  })
})

describe('first click', () => {
  it('never places a mine on the clicked cell or its neighbors', () => {
    for (let run = 0; run < 20; run++) {
      const board = openCell(generateBoard(BEGINNER), 4, 4)
      expect(board.minesPlaced).toBe(true)
      expect(board.cells.filter((c) => c.mine)).toHaveLength(10)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(board.cells[(4 + dy) * 9 + (4 + dx)].mine).toBe(false)
        }
      }
      expect(board.status).not.toBe('lost')
    }
  })

  it('computes adjacent counts that are always accurate', () => {
    const board = openCell(generateBoard(EXPERT), 15, 8)
    const mines = new Set(board.cells.map((c, i) => (c.mine ? i : -1)).filter((i) => i >= 0))
    board.cells.forEach((cell, i) => {
      expect(cell.adjacent).toBe(bruteAdjacent(board.width, board.height, mines, i))
    })
  })
})

describe('openCell', () => {
  it('flood-opens connected zero regions and their numbered border', () => {
    // 5x5, single mine in the corner: opening the far corner cascades everything else
    const board = openCell(makeBoard(5, 5, [0]), 4, 4)
    const openCount = board.cells.filter((c) => c.state === 'open').length
    expect(openCount).toBe(24)
    expect(board.cells[0].state).toBe('hidden')
    expect(board.status).toBe('won')
  })

  it('does not open flagged cells (directly or via flood)', () => {
    const flagged = toggleFlag(makeBoard(5, 5, [0]), 2, 2)
    expect(openCell(flagged, 2, 2)).toBe(flagged)
    const board = openCell(flagged, 4, 4)
    expect(board.cells[2 * 5 + 2].state).toBe('flagged')
  })

  it('loses when opening a mine and reveals all mines', () => {
    const board = openCell(makeBoard(5, 5, [0, 24]), 0, 0)
    expect(board.status).toBe('lost')
    expect(board.cells[0].state).toBe('open')
    expect(board.cells[24].state).toBe('open')
  })

  it('is a no-op after the game ended', () => {
    const lost = openCell(makeBoard(5, 5, [0]), 0, 0)
    expect(openCell(lost, 4, 4)).toBe(lost)
  })

  it('does not mutate the input board', () => {
    const before = makeBoard(5, 5, [0])
    const snapshot = JSON.parse(JSON.stringify(before))
    openCell(before, 4, 4)
    expect(before).toEqual(snapshot)
  })
})

describe('toggleFlag', () => {
  it('toggles hidden <-> flagged and ignores open cells', () => {
    const board = makeBoard(3, 3, [0])
    const flagged = toggleFlag(board, 1, 1)
    expect(flagged.cells[4].state).toBe('flagged')
    expect(toggleFlag(flagged, 1, 1).cells[4].state).toBe('hidden')
    const opened = openCell(board, 2, 2)
    expect(toggleFlag(opened, 2, 2)).toBe(opened)
  })
})

describe('chord', () => {
  // 3x3 with a mine at (0,0); cell (1,1) shows 1
  it('opens unflagged neighbors when flags match the number', () => {
    let board = makeBoard(3, 3, [0])
    board = openCell(board, 1, 1)
    board = toggleFlag(board, 0, 0)
    board = chord(board, 1, 1)
    expect(board.status).toBe('won')
    expect(board.cells.filter((c) => c.state === 'open')).toHaveLength(8)
  })

  it('does nothing when flag count does not match', () => {
    let board = makeBoard(3, 3, [0])
    board = openCell(board, 1, 1)
    expect(chord(board, 1, 1)).toBe(board)
  })

  it('loses when a flag is wrong and the chord hits the mine', () => {
    let board = makeBoard(3, 3, [0])
    board = openCell(board, 1, 1)
    board = toggleFlag(board, 2, 0) // wrong flag
    board = chord(board, 1, 1)
    expect(board.status).toBe('lost')
    expect(board.cells[0].state).toBe('open')
  })
})

describe('win/lose transitions', () => {
  it('wins when all non-mine cells are open', () => {
    let board = makeBoard(2, 2, [0])
    board = openCell(board, 1, 0)
    board = openCell(board, 0, 1)
    expect(board.status).toBe('playing')
    board = openCell(board, 1, 1)
    expect(board.status).toBe('won')
  })
})

describe('performance', () => {
  it('flood fills a 30x16 board without recursion issues', () => {
    const board = openCell(generateBoard({ width: 30, height: 16, mines: 1 }), 29, 15, () => 0)
    const openCount = board.cells.filter((c) => c.state === 'open').length
    expect(openCount).toBeGreaterThan(400)
    expect(board.status === 'playing' || board.status === 'won').toBe(true)
  })
})

describe('input guards', () => {
  it('generateBoard rejects impossible mine counts', () => {
    expect(() => generateBoard({ width: 3, height: 3, mines: 1 })).toThrow()
    expect(() => generateBoard({ width: 9, height: 9, mines: -1 })).toThrow()
  })

  it('out-of-range coordinates are no-ops for all entry points', () => {
    const board = makeBoard(3, 3, [0])
    for (const [x, y] of [[-1, 1], [3, 0], [0, -1], [0, 3]] as const) {
      expect(openCell(board, x, y)).toBe(board)
      expect(toggleFlag(board, x, y)).toBe(board)
      expect(chord(board, x, y)).toBe(board)
    }
  })
})
