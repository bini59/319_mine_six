import { beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTRACT_PARAMS,
  breakContract,
  contractsMultiplier,
  rectInBounds,
  resolveContracts,
  signContract,
  timingMultiplier,
  type Contract,
  type Rect,
} from './contract'
import { openCell } from './board'
import { cumulativeMultiplier } from './multiplier'
import { useGameStore } from '@/store/game'
import type { Board, Cell } from './types'

// Hand-crafted board with mines already placed — deterministic scenarios.
function makeBoard(width: number, height: number, mineIndices: number[]): Board {
  const mines = new Set(mineIndices)
  const adjacent = (index: number): number => {
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
  const cells: Cell[] = Array.from({ length: width * height }, (_, i) => ({
    mine: mines.has(i),
    adjacent: adjacent(i),
    state: 'hidden',
  }))
  return { width, height, mineCount: mineIndices.length, cells, status: 'playing', minesPlaced: true }
}

function makeContract(partial: Partial<Contract> & { rect: Rect }): Contract {
  return {
    id: 1,
    constraintId: 'no-flag',
    multiplierBonus: 0.4,
    signedAtOpenedFraction: 0,
    timingMultiplier: 0.4,
    status: 'active',
    ...partial,
  }
}

describe('rectInBounds', () => {
  const board = makeBoard(5, 4, [])
  it('accepts rects inside the board and rejects the rest', () => {
    expect(rectInBounds(board, { x: 0, y: 0, w: 5, h: 4 })).toBe(true)
    expect(rectInBounds(board, { x: 4, y: 3, w: 1, h: 1 })).toBe(true)
    expect(rectInBounds(board, { x: -1, y: 0, w: 2, h: 2 })).toBe(false)
    expect(rectInBounds(board, { x: 4, y: 0, w: 2, h: 1 })).toBe(false)
    expect(rectInBounds(board, { x: 0, y: 0, w: 0, h: 1 })).toBe(false)
  })
})

describe('timingMultiplier', () => {
  it('pays more the less information is revealed', () => {
    expect(timingMultiplier(0.4, 0, 1)).toBeCloseTo(0.4)
    expect(timingMultiplier(0.4, 0.5, 1)).toBeCloseTo(0.2)
    expect(timingMultiplier(0.4, 0, 1)).toBeGreaterThan(timingMultiplier(0.4, 0.5, 1))
  })
})

describe('signContract', () => {
  const request = { rect: { x: 0, y: 0, w: 2, h: 2 }, constraintId: 'no-flag', multiplierBonus: 0.4 }

  it('throws on an out-of-bounds rect', () => {
    const board = makeBoard(3, 3, [])
    expect(() => signContract(board, [], { ...request, rect: { x: 2, y: 2, w: 2, h: 2 } })).toThrow()
  })

  it('enforces the per-cell nesting cap of 2', () => {
    const board = makeBoard(4, 4, [])
    const first = signContract(board, [], request)
    const second = signContract(board, [first], request)
    expect(second.id).toBe(2)
    expect(() => signContract(board, [first, second], request)).toThrow()
  })

  it('ignores broken/cleared contracts for the nesting cap', () => {
    const board = makeBoard(4, 4, [])
    const first = { ...signContract(board, [], request), status: 'broken' as const }
    const second = { ...signContract(board, [first], request), status: 'cleared' as const }
    expect(() => signContract(board, [first, second], request)).not.toThrow()
  })

  it('fixes the timing multiplier at signing time', () => {
    const fresh = makeBoard(4, 4, [15])
    const early = signContract(fresh, [], request)
    expect(early.signedAtOpenedFraction).toBe(0)
    expect(early.timingMultiplier).toBeCloseTo(0.4)

    // Open a single numbered cell (adjacent to the mine, no flood) so the
    // request rect still holds hidden safe cells after information is revealed.
    const progressed = openCell(fresh, 2, 2)
    const late = signContract(progressed, [], request)
    expect(late.signedAtOpenedFraction).toBeGreaterThan(0)
    expect(late.timingMultiplier).toBeLessThan(early.timingMultiplier)
  })
})

describe('resolveContracts', () => {
  it('clears an active contract once every safe cell in its rect is open', () => {
    const board = makeBoard(4, 4, [0]) // mine at (0,0)
    const contract = makeContract({ rect: { x: 0, y: 0, w: 2, h: 2 } })

    const partial = openCell(openCell(board, 1, 0), 0, 1)
    expect(resolveContracts(partial, [contract])[0].status).toBe('active')

    const full = openCell(partial, 1, 1)
    expect(resolveContracts(full, [contract])[0].status).toBe('cleared')
  })

  it('leaves broken contracts untouched', () => {
    const board = makeBoard(2, 2, [])
    const contract = makeContract({ rect: { x: 0, y: 0, w: 1, h: 1 }, status: 'broken' })
    const opened = openCell(board, 0, 0)
    expect(resolveContracts(opened, [contract])[0].status).toBe('broken')
  })
})

describe('breakContract', () => {
  it('breaks only the targeted active contract', () => {
    const a = makeContract({ id: 1, rect: { x: 0, y: 0, w: 1, h: 1 } })
    const b = makeContract({ id: 2, rect: { x: 1, y: 1, w: 1, h: 1 }, status: 'cleared' })
    const result = breakContract([a, b], 1)
    expect(result[0].status).toBe('broken')
    expect(result[1].status).toBe('cleared')
    expect(breakContract([b], 2)[0].status).toBe('cleared') // cleared can't be broken
  })
})

describe('contractsMultiplier', () => {
  it('is 1 with no contracts and ignores active ones', () => {
    expect(contractsMultiplier([])).toBe(1)
    expect(contractsMultiplier([makeContract({ rect: { x: 0, y: 0, w: 1, h: 1 } })])).toBe(1)
  })

  it('a cleared contract contributes (1 + bonus), a broken one (1 − penalty)', () => {
    const cleared = makeContract({ rect: { x: 0, y: 0, w: 1, h: 1 }, status: 'cleared' })
    expect(contractsMultiplier([cleared])).toBeCloseTo(1.4)
    const broken = makeContract({ rect: { x: 0, y: 0, w: 1, h: 1 }, status: 'broken' })
    expect(contractsMultiplier([broken])).toBeCloseTo(1 - DEFAULT_CONTRACT_PARAMS.breakPenalty)
  })

  it('applies nesting decay to overlapping cleared contracts', () => {
    const a = makeContract({ id: 1, rect: { x: 0, y: 0, w: 2, h: 2 }, status: 'cleared' })
    const b = makeContract({ id: 2, rect: { x: 1, y: 1, w: 2, h: 2 }, status: 'cleared' })
    // each sees 1 overlap → bonus × 0.5 each → (1 + 0.2)²
    expect(contractsMultiplier([a, b])).toBeCloseTo(1.2 * 1.2)
    // disjoint contracts get full bonus
    const c = makeContract({ id: 3, rect: { x: 3, y: 3, w: 1, h: 1 }, status: 'cleared' })
    expect(contractsMultiplier([a, c])).toBeCloseTo(1.4 * 1.4)
  })
})

describe('store integration', () => {
  beforeEach(() => {
    useGameStore.setState({
      board: makeBoard(4, 4, [0]),
      balance: 0,
      bet: 100,
      cashedOut: false,
      contracts: [],
    })
  })

  it('sign → open zone → contract clears via store', () => {
    const store = useGameStore.getState()
    store.signContract({ rect: { x: 2, y: 2, w: 2, h: 2 }, constraintId: 'no-flag', multiplierBonus: 0.4 })
    expect(useGameStore.getState().contracts[0].status).toBe('active')
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]] as const) {
      useGameStore.getState().open(x, y)
    }
    expect(useGameStore.getState().contracts[0].status).toBe('cleared')
  })

  it('invalid sign is a no-op', () => {
    useGameStore.getState().signContract({ rect: { x: 3, y: 3, w: 5, h: 5 }, constraintId: 'no-flag', multiplierBonus: 0.4 })
    expect(useGameStore.getState().contracts).toHaveLength(0)
  })

  it('cashout pays base curve × contract factor', () => {
    const cleared = makeContract({ rect: { x: 1, y: 1, w: 1, h: 1 }, status: 'cleared' })
    // open a numbered cell (adjacent to the mine) — no flood, board stays 'playing'
    const opened = openCell(useGameStore.getState().board, 1, 1)
    useGameStore.setState({ board: opened, contracts: [cleared] })
    useGameStore.getState().cashout()
    const expected = Math.round(100 * cumulativeMultiplier(opened) * 1.4)
    expect(useGameStore.getState().balance).toBe(expected)
    expect(useGameStore.getState().cashedOut).toBe(true)
  })

  it('winning open settles with contract factor', () => {
    const board = makeBoard(2, 1, [0]) // single safe cell at (1,0)
    const cleared = makeContract({ rect: { x: 1, y: 0, w: 1, h: 1 } })
    useGameStore.setState({ board, contracts: [cleared], bet: 100, balance: 0 })
    useGameStore.getState().open(1, 0)
    const finalBoard = useGameStore.getState().board
    expect(finalBoard.status).toBe('won')
    expect(useGameStore.getState().contracts[0].status).toBe('cleared')
    expect(useGameStore.getState().balance).toBe(Math.round(100 * cumulativeMultiplier(finalBoard) * 1.4))
  })
})

describe('signContract risk guard (exploit prevention)', () => {
  it('rejects a rect whose safe cells are already all open', () => {
    let board = makeBoard(5, 1, [4])
    board = openCell(board, 0, 0) // flood opens the zero region
    expect(board.cells[0].state).toBe('open')
    expect(() =>
      signContract(board, [], { rect: { x: 0, y: 0, w: 2, h: 1 }, constraintId: 'no-flag', multiplierBonus: 0.4 }),
    ).toThrow()
  })

  it('rejects an all-mine rect (no safe cells → no instant clear)', () => {
    const board = makeBoard(4, 1, [0, 1])
    expect(() =>
      signContract(board, [], { rect: { x: 0, y: 0, w: 2, h: 1 }, constraintId: 'no-flag', multiplierBonus: 0.4 }),
    ).toThrow()
  })

  it('accepts a rect that still contains hidden safe cells', () => {
    const board = makeBoard(4, 1, [0])
    const contract = signContract(board, [], {
      rect: { x: 0, y: 0, w: 2, h: 1 },
      constraintId: 'no-flag',
      multiplierBonus: 0.4,
    })
    expect(contract.status).toBe('active')
  })
})

describe('extraMines carriage (density-up)', () => {
  it('fixes extraMines on the contract at signing time', () => {
    const board = makeBoard(4, 4, [15])
    const c = signContract(board, [], {
      rect: { x: 0, y: 0, w: 2, h: 2 },
      constraintId: 'density-up',
      multiplierBonus: 0.4,
      extraMines: 2,
    })
    expect(c.extraMines).toBe(2)
    const plain = signContract(board, [], { rect: { x: 2, y: 0, w: 2, h: 2 }, constraintId: 'no-flag', multiplierBonus: 0.4 })
    expect(plain.extraMines).toBeUndefined()
  })
})
