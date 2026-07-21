import { beforeEach, describe, expect, it } from 'vitest'
import { cumulativeMultiplier, openedSafeCount, stepMultiplier } from './multiplier'
import { generateBoard, openCell } from './board'
import { BEGINNER } from './presets'
import { START_BALANCE, mergePersisted, useGameStore } from '@/store/game'
import { emptyStats } from '@/lib/game/stats'
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

// Opens `openedSafe` cells and accrues the matching per-click multiplier,
// as if each was a separate non-flood click.
function withOpened(board: Board, openedSafe: number): Board {
  const cells = [...board.cells]
  let remaining = openedSafe
  for (let i = 0; i < cells.length && remaining > 0; i++) {
    if (!cells[i].mine) {
      cells[i] = { ...cells[i], state: 'open' }
      remaining--
    }
  }
  const totalSafe = board.width * board.height - board.mineCount
  let multiplier = board.multiplier ?? 1
  for (let k = 0; k < openedSafe; k++) multiplier *= stepMultiplier(totalSafe - k, board.mineCount)
  return { ...board, cells, multiplier }
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

  it('charges one step per risked click at the pre-click odds', () => {
    // makeBoard(3,3,[8]): cells 4,5,7 are numbered (no flood). Two clicks:
    // steps at remainingSafe 8 then 7, mines 1.
    const two = openCell(openCell(board, 1, 1), 2, 1)
    expect(cumulativeMultiplier(two)).toBeCloseTo(stepMultiplier(8, 1) * stepMultiplier(7, 1))
  })

  it('increases monotonically with each risked click', () => {
    let b = board
    let prev = 1
    for (const [x, y] of [[1, 1], [2, 1], [1, 2]] as const) {
      b = openCell(b, x, y)
      const m = cumulativeMultiplier(b)
      expect(m).toBeGreaterThan(prev)
      prev = m
    }
  })

  it('grows faster on denser boards at equal clicks', () => {
    const sparse = openCell(makeBoard(4, 4, [15]), 2, 2) // 1 mine, numbered cell
    const dense = openCell(makeBoard(4, 4, [10, 11, 12, 13, 14, 15]), 1, 1) // 6 mines
    expect(cumulativeMultiplier(dense)).toBeGreaterThan(cumulativeMultiplier(sparse))
  })

  it('a flood click pays exactly one step, not one per revealed cell', () => {
    // Opening the zero-region corner floods most of the board in one click.
    const flooded = openCell(board, 0, 0)
    expect(openedSafeCount(flooded)).toBeGreaterThan(1)
    expect(cumulativeMultiplier(flooded)).toBeCloseTo(stepMultiplier(8, 1))
  })

  it('the exempt first click pays nothing', () => {
    let b = generateBoard(BEGINNER)
    b = openCell(b, 4, 4, () => 0.5)
    expect(cumulativeMultiplier(b)).toBe(1)
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

describe('mergePersisted (reload refund)', () => {
  it('refunds an unresolved persisted bet into balance', () => {
    const current = { balance: 1000, bet: 0, stats: emptyStats(), other: 'x' }
    expect(mergePersisted({ balance: 900, bet: 100 }, current)).toEqual(current)
  })

  it('falls back to current state when nothing persisted', () => {
    const current = { balance: 1000, bet: 0, stats: emptyStats() }
    expect(mergePersisted(undefined, current)).toEqual(current)
  })

  it('merges persisted stats and defaults missing fields on old blobs', () => {
    const current = { balance: 1000, bet: 0, stats: emptyStats() }
    const merged = mergePersisted({ balance: 500, stats: { rounds: 3, wins: 1 } }, current)
    expect(merged.stats).toEqual({ ...emptyStats(), rounds: 3, wins: 1 })
    expect(mergePersisted({ balance: 500 }, current).stats).toEqual(emptyStats())
  })
})
