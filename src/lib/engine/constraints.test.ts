import { beforeEach, describe, expect, it } from 'vitest'
import { activeLayersAt, isFlagBlockedAt, rectFromCorners } from './constraints'
import { rectCells, type Contract, type Rect } from './contract'
import { BEGINNER } from './presets'
import { useGameStore } from '@/store/game'

function contract(rect: Rect, status: Contract['status'] = 'active', id = 1): Contract {
  return {
    id,
    rect,
    constraintId: 'no-flag',
    multiplierBonus: 0.4,
    signedAtOpenedFraction: 0,
    timingMultiplier: 0.4,
    status,
  }
}

describe('rectFromCorners', () => {
  it('normalizes reversed corners', () => {
    expect(rectFromCorners({ x: 3, y: 2 }, { x: 1, y: 0 })).toEqual({ x: 1, y: 0, w: 3, h: 3 })
  })

  it('handles a single cell (same corner twice)', () => {
    expect(rectFromCorners({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual({ x: 2, y: 2, w: 1, h: 1 })
  })
})

describe('activeLayersAt', () => {
  const width = 5
  const a = contract({ x: 0, y: 0, w: 2, h: 2 }, 'active', 1)
  const b = contract({ x: 1, y: 1, w: 2, h: 2 }, 'active', 2)
  const broken = contract({ x: 0, y: 0, w: 5, h: 5 }, 'broken', 3)

  it('counts overlapping active contracts per cell', () => {
    expect(activeLayersAt(0, [a, b], width)).toBe(1) // (0,0) only a
    expect(activeLayersAt(6, [a, b], width)).toBe(2) // (1,1) both
    expect(activeLayersAt(12, [a, b], width)).toBe(1) // (2,2) only b
    expect(activeLayersAt(4, [a, b], width)).toBe(0) // (4,0) neither
  })

  it('ignores non-active contracts', () => {
    expect(activeLayersAt(0, [broken], width)).toBe(0)
  })
})

describe('isFlagBlockedAt', () => {
  const width = 5
  const noFlag = contract({ x: 0, y: 0, w: 2, h: 2 })
  const mimic: Contract = { ...contract({ x: 3, y: 3, w: 2, h: 2 }, 'active', 2), constraintId: 'mimic' }

  it('blocks only inside active no-flag zones', () => {
    expect(isFlagBlockedAt(0, [noFlag, mimic], width)).toBe(true)
    expect(isFlagBlockedAt(4, [noFlag, mimic], width)).toBe(false)
    expect(isFlagBlockedAt(18, [noFlag, mimic], width)).toBe(false) // (3,3) mimic zone — flags fine
  })

  it('lifts the block for broken/cleared contracts', () => {
    expect(isFlagBlockedAt(0, [{ ...noFlag, status: 'broken' }], width)).toBe(false)
    expect(isFlagBlockedAt(0, [{ ...noFlag, status: 'cleared' }], width)).toBe(false)
  })
})

describe('no-flag enforcement (store)', () => {
  beforeEach(() => {
    useGameStore.getState().newGame(BEGINNER)
  })

  it('blocks flags inside an active zone and records feedback index', () => {
    const { signContract, flag } = useGameStore.getState()
    signContract({ rect: { x: 0, y: 0, w: 2, h: 2 }, constraintId: 'no-flag', multiplierBonus: 0.4 })
    flag(0, 0)
    let s = useGameStore.getState()
    expect(s.board.cells[0].state).toBe('hidden')
    expect(s.flagBlockedAt).toBe(0)

    flag(4, 4) // outside the zone → normal flag, transient cleared
    s = useGameStore.getState()
    expect(s.board.cells[4 * 9 + 4].state).toBe('flagged')
    expect(s.flagBlockedAt).toBeNull()
  })

  it('lifts the block once the contract is broken', () => {
    const { signContract, flag } = useGameStore.getState()
    signContract({ rect: { x: 0, y: 0, w: 2, h: 2 }, constraintId: 'no-flag', multiplierBonus: 0.4 })
    useGameStore.getState().breakContract(useGameStore.getState().contracts[0].id)
    flag(0, 0)
    expect(useGameStore.getState().board.cells[0].state).toBe('flagged')
  })
})

describe('density-up enforcement (store)', () => {
  beforeEach(() => {
    useGameStore.getState().newGame(BEGINNER)
  })

  it('bumps mineCount at signing and forces mines into the zone on first open', () => {
    const rect = { x: 0, y: 0, w: 3, h: 3 }
    useGameStore.getState().signContract({ rect, constraintId: 'density-up', multiplierBonus: 0.4, extraMines: 2 })
    expect(useGameStore.getState().board.mineCount).toBe(12)

    useGameStore.getState().open(8, 8) // far from the zone; exemption cannot cap it
    const board = useGameStore.getState().board
    expect(board.minesPlaced).toBe(true)
    expect(board.cells.filter((c) => c.mine).length).toBe(board.mineCount)
    expect(board.mineCount).toBe(12)
    const zoneMines = rectCells(rect, board.width).filter((i) => board.cells[i].mine).length
    expect(zoneMines).toBeGreaterThanOrEqual(2)
  })

  it('cannot be signed once mines are placed', () => {
    useGameStore.getState().open(8, 8)
    useGameStore
      .getState()
      .signContract({ rect: { x: 0, y: 0, w: 2, h: 2 }, constraintId: 'density-up', multiplierBonus: 0.2, extraMines: 1 })
    expect(useGameStore.getState().contracts).toHaveLength(0)
    expect(useGameStore.getState().board.mineCount).toBe(10)
  })
})
