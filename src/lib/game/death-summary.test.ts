import { describe, expect, it } from 'vitest'
import { summarizeDeath, RECENT_CHOICES, type RoundEvent } from './death-summary'
import type { Contract } from '@/lib/engine/contract'
import type { Board, Cell } from '@/lib/engine/types'

// Hand-crafted board with mines placed — same pattern as the other engine tests.
function makeBoard(width: number, height: number, mineIndices: number[], openIndices: number[] = []): Board {
  const mines = new Set(mineIndices)
  const opens = new Set(openIndices)
  const cells: Cell[] = Array.from({ length: width * height }, (_, i) => ({
    mine: mines.has(i),
    adjacent: 0, // adjacency irrelevant for the summary
    state: opens.has(i) ? 'open' : 'hidden',
  }))
  return { width, height, mineCount: mineIndices.length, cells, status: 'lost', minesPlaced: true }
}

function contract(partial: Partial<Contract>): Contract {
  return {
    id: 1,
    rect: { x: 0, y: 0, w: 2, h: 2 },
    constraintId: 'no-flag',
    multiplierBonus: 0.4,
    signedAtOpenedFraction: 0,
    timingMultiplier: 0.4,
    status: 'active',
    ...partial,
  }
}

describe('summarizeDeath', () => {
  it('extracts the killing open and flags a density-up zone death', () => {
    // 4x4, mine at (1,1)=5, player opened safe cells 0-th row then hit the mine.
    const board = makeBoard(4, 4, [5], [0, 1, 5])
    const history: RoundEvent[] = [
      { type: 'bet' },
      { type: 'open', x: 0, y: 0, multiplier: 1.1 },
      { type: 'sign', constraintId: 'density-up', rect: { x: 0, y: 0, w: 2, h: 2 } },
      { type: 'open', x: 1, y: 1, multiplier: 1.25 },
    ]
    const contracts = [contract({ constraintId: 'density-up', rect: { x: 0, y: 0, w: 2, h: 2 } })]

    const s = summarizeDeath(board, history, contracts)
    expect(s.killedAt).toEqual({ x: 1, y: 1 })
    expect(s.killedInContractZone).toEqual({ label: '지뢰 밀도 업' })
    expect(s.signedContracts).toEqual([{ label: '지뢰 밀도 업' }])
  })

  it('computes peak multiplier from open/chord events only', () => {
    const board = makeBoard(3, 3, [8], [8])
    const history: RoundEvent[] = [
      { type: 'open', x: 0, y: 0, multiplier: 1.2 },
      { type: 'cashout', multiplier: 99 },
      { type: 'chord', x: 1, y: 1, multiplier: 1.5 },
      { type: 'open', x: 2, y: 2, multiplier: 1.3 },
    ]
    expect(summarizeDeath(board, history, []).peakMultiplier).toBe(1.5)
  })

  it('truncates recentChoices to the last N', () => {
    const board = makeBoard(3, 3, [0], [0])
    const history: RoundEvent[] = Array.from({ length: 9 }, (_, i) => ({ type: 'flag' as const, x: i, y: 0 }))
    const s = summarizeDeath(board, history, [])
    expect(s.recentChoices).toHaveLength(RECENT_CHOICES)
    expect(s.recentChoices[0].x).toBe(9 - RECENT_CHOICES)
  })

  it('survives an empty history with a minimal summary', () => {
    const board = makeBoard(3, 3, [4], [4])
    const s = summarizeDeath(board, [], [])
    expect(s.killedAt).toBeNull()
    expect(s.peakMultiplier).toBe(1)
    expect(s.recentChoices).toEqual([])
    expect(s.killedInContractZone).toBeNull()
  })

  it('cross-checks killedAt against the board (non-mine last open → null)', () => {
    const board = makeBoard(3, 3, [8], [0])
    const history: RoundEvent[] = [{ type: 'open', x: 0, y: 0, multiplier: 1.1 }]
    expect(summarizeDeath(board, history, []).killedAt).toBeNull()
  })

  it('accepts a fatal chord when a mine is adjacent to the chorded cell', () => {
    const board = makeBoard(3, 3, [4], [0])
    const history: RoundEvent[] = [{ type: 'chord', x: 1, y: 0, multiplier: 1.2 }]
    expect(summarizeDeath(board, history, []).killedAt).toEqual({ x: 1, y: 0 })
  })
})
