import { beforeEach, describe, expect, it } from 'vitest'
import { cumulativeMultiplier, stepMultiplier } from './multiplier'
import { openCell } from './board'
import { START_BALANCE, useGameStore } from '@/store/game'
import type { Board, Cell } from './types'

// Deterministic board with mines pre-placed (same shape as board.test.ts helper).
function makeBoard(width: number, height: number, mineIndices: number[]): Board {
  const mines = new Set(mineIndices)
  const count = (i: number) => {
    const x = i % width
    const y = Math.floor(i / width)
    let n = 0
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue
        const nx = x + dx
        const ny = y + dy
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mines.has(ny * width + nx)) n++
      }
    return n
  }
  const cells: Cell[] = Array.from({ length: width * height }, (_, i) => ({
    mine: mines.has(i),
    adjacent: count(i),
    state: 'hidden',
  }))
  return { width, height, mineCount: mineIndices.length, cells, status: 'playing', minesPlaced: true }
}

function withOpened(board: Board, openedSafe: number): Board {
  const cells = [...board.cells]
  let remaining = openedSafe
  for (let i = 0; i < cells.length && remaining > 0; i++) {
    if (!cells[i].mine) {
      cells[i] = { ...cells[i], state: 'open' }
      remaining--
    }
  }
  return { ...board, cells }
}

describe('stepMultiplier', () => {
  it('is houseFactor / P(safe)', () => {
    // P(safe) = 9/10 → fair step 10/9
    expect(stepMultiplier(9, 1, 1)).toBeCloseTo(10 / 9)
    expect(stepMultiplier(9, 1, 0.97)).toBeCloseTo((0.97 * 10) / 9)
  })

  it('is steeper with higher mine density', () => {
    expect(stepMultiplier(5, 5)).toBeGreaterThan(stepMultiplier(9, 1))
  })

  it('throws when no safe cells remain', () => {
    expect(() => stepMultiplier(0, 5)).toThrow()
    expect(() => stepMultiplier(-1, 5)).toThrow()
    expect(() => stepMultiplier(5, -1)).toThrow()
  })
})

describe('cumulativeMultiplier', () => {
  const board = makeBoard(3, 3, [8]) // 8 safe, 1 mine

  it('is 1.0 before any open', () => {
    expect(cumulativeMultiplier(board)).toBe(1)
  })

  it('accumulates the product of step multipliers', () => {
    // opens 1..2: steps at remainingSafe 8 then 7, mines 1
    const expected = stepMultiplier(8, 1) * stepMultiplier(7, 1)
    expect(cumulativeMultiplier(withOpened(board, 2))).toBeCloseTo(expected)
  })

  it('increases monotonically with each open', () => {
    let prev = 1
    for (let k = 1; k <= 8; k++) {
      const m = cumulativeMultiplier(withOpened(board, k))
      expect(m).toBeGreaterThan(prev)
      prev = m
    }
  })

  it('grows faster on denser boards at equal opens', () => {
    const sparse = makeBoard(4, 4, [15]) // 1 mine
    const dense = makeBoard(4, 4, [10, 11, 12, 13, 14, 15]) // 6 mines
    expect(cumulativeMultiplier(withOpened(dense, 3))).toBeGreaterThan(
      cumulativeMultiplier(withOpened(sparse, 3)),
    )
  })

  it('respects the house factor', () => {
    const opened = withOpened(board, 3)
    expect(cumulativeMultiplier(opened, 1)).toBeGreaterThan(cumulativeMultiplier(opened, 0.97))
  })
})

describe('game store: bet → open → cashout lifecycle', () => {
  beforeEach(() => {
    useGameStore.setState({
      board: makeBoard(3, 3, [8]),
      balance: START_BALANCE,
      bet: 0,
      cashedOut: false,
    })
  })

  it('deducts the bet up-front and pays bet × multiplier on cashout', () => {
    const s = () => useGameStore.getState()
    s().placeBet(100)
    expect(s().balance).toBe(START_BALANCE - 100)
    expect(s().bet).toBe(100)

    useGameStore.setState({ board: withOpened(s().board, 2) })
    const payout = Math.round(100 * cumulativeMultiplier(s().board))
    s().cashout()
    expect(s().balance).toBe(START_BALANCE - 100 + payout)
    expect(s().bet).toBe(0)
    expect(s().cashedOut).toBe(true)

    const after = s().balance
    s().cashout() // no-op: already settled
    expect(s().balance).toBe(after)
    s().open(0, 0) // no-op: round over
    expect(s().board.cells.every((c) => c.mine || c.state === 'open' || c.state === 'hidden')).toBe(true)
  })

  it('clamps the bet to the balance and rejects garbage', () => {
    const s = () => useGameStore.getState()
    s().placeBet(START_BALANCE * 10)
    expect(s().bet).toBe(START_BALANCE)
    expect(s().balance).toBe(0)
  })

  it('loses the whole bet on a mine, then refill restores the balance', () => {
    const s = () => useGameStore.getState()
    useGameStore.setState({ balance: 100 })
    s().placeBet(100)
    s().open(2, 2) // index 8 = mine
    expect(s().board.status).toBe('lost')
    expect(s().balance).toBe(0)

    s().refill()
    expect(s().balance).toBe(START_BALANCE)
  })

  it('lose via open() zeroes the bet with no payout', () => {
    const s = () => useGameStore.getState()
    s().placeBet(100)
    s().open(2, 2) // mine at index 8
    expect(s().board.status).toBe('lost')
    expect(s().bet).toBe(0)
    expect(s().balance).toBe(START_BALANCE - 100)
  })

  it('win via open() auto-pays like a full-board cashout', () => {
    const s = () => useGameStore.getState()
    s().placeBet(100)
    useGameStore.setState({ board: withOpened(s().board, 7) })
    // open the last safe cell (index 7 = x1,y2) → status won
    const payoutBoard = openCell(s().board, 1, 2)
    expect(payoutBoard.status).toBe('won')
    s().open(1, 2)
    expect(s().balance).toBe(START_BALANCE - 100 + Math.round(100 * cumulativeMultiplier(s().board)))
    expect(s().bet).toBe(0)
  })

  it('refill only fires when broke and out of round', () => {
    const s = () => useGameStore.getState()
    s().refill()
    expect(s().balance).toBe(START_BALANCE) // unchanged, not broke
    useGameStore.setState({ balance: 0, bet: 50 })
    s().refill()
    expect(s().balance).toBe(0) // bet in play — no free money mid-round
  })
})
