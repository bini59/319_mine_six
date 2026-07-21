import { beforeEach, describe, expect, it } from 'vitest'
import {
  MIMIC_MAX_RECT,
  activeLayersAt,
  displayAdjacentAt,
  isFlagBlockedAt,
  mimicRectTooLarge,
  pickMimic,
  rectFromCorners,
  resolveMimics,
} from './constraints'
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

// Deterministic rng: returns the given values in order (cycled).
function rngOf(...vals: number[]): () => number {
  let i = 0
  return () => vals[i++ % vals.length]
}

// Crafted board with mines placed — deterministic mimic scenarios.
function makeBoard(width: number, height: number, mineIndices: number[]): import('./types').Board {
  const mines = new Set(mineIndices)
  const adjacentOf = (index: number): number => {
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
  return {
    width,
    height,
    mineCount: mineIndices.length,
    cells: Array.from({ length: width * height }, (_, i) => ({
      mine: mines.has(i),
      adjacent: adjacentOf(i),
      state: 'hidden' as const,
    })),
    status: 'playing' as const,
    minesPlaced: true,
  }
}

describe('mimicRectTooLarge', () => {
  it('rejects rects wider or taller than the cap, accepts the cap itself', () => {
    expect(mimicRectTooLarge({ x: 0, y: 0, w: MIMIC_MAX_RECT + 1, h: 1 })).toBe(true)
    expect(mimicRectTooLarge({ x: 0, y: 0, w: 1, h: MIMIC_MAX_RECT + 1 })).toBe(true)
    expect(mimicRectTooLarge({ x: 0, y: 0, w: MIMIC_MAX_RECT, h: MIMIC_MAX_RECT })).toBe(false)
  })
})

describe('pickMimic', () => {
  const board = makeBoard(5, 5, [12]) // mine at center (2,2)

  it('picks a hidden safe cell in the rect with a lie that differs from the truth', () => {
    const rect = { x: 0, y: 0, w: 2, h: 2 }
    const picked = pickMimic(board, rect, rngOf(0, 0))
    expect(picked).not.toBeNull()
    expect(rectCells(rect, board.width)).toContain(picked!.mimicIndex)
    expect(board.cells[picked!.mimicIndex].mine).toBe(false)
    expect(picked!.mimicValue).not.toBe(board.cells[picked!.mimicIndex].adjacent)
    expect(picked!.mimicValue).toBeGreaterThanOrEqual(0)
    expect(picked!.mimicValue).toBeLessThanOrEqual(8)
  })

  it('never returns the truth for any rng value', () => {
    for (let k = 0; k < 8; k++) {
      const picked = pickMimic(board, { x: 1, y: 1, w: 1, h: 1 }, rngOf(0, k / 8))
      expect(picked!.mimicValue).not.toBe(board.cells[6].adjacent)
    }
  })

  it('returns null when the rect has no hidden safe cells', () => {
    expect(pickMimic(board, { x: 2, y: 2, w: 1, h: 1 }, rngOf(0))).toBeNull() // mine only
    const opened = {
      ...board,
      cells: board.cells.map((c, i) => (i === 0 ? { ...c, state: 'open' as const } : c)),
    }
    expect(pickMimic(opened, { x: 0, y: 0, w: 1, h: 1 }, rngOf(0))).toBeNull() // already open
  })
})

describe('resolveMimics + displayAdjacentAt', () => {
  const board = makeBoard(5, 5, [12])
  const mimicContract: Contract = {
    ...contract({ x: 0, y: 0, w: 2, h: 2 }, 'active', 1),
    constraintId: 'mimic',
  }

  it('assigns exactly one lie per active mimic and leaves others untouched', () => {
    const noFlag = contract({ x: 3, y: 3, w: 2, h: 2 }, 'active', 2)
    const resolved = resolveMimics(board, [mimicContract, noFlag], rngOf(0, 0))
    expect(resolved[0].mimicIndex).toBeDefined()
    expect(resolved[0].mimicValue).toBeDefined()
    expect(resolved[1]).toBe(noFlag)

    // Idempotent: an assigned mimic is not re-picked.
    const again = resolveMimics(board, resolved, rngOf(0.9, 0.9))
    expect(again[0].mimicIndex).toBe(resolved[0].mimicIndex)
    expect(again[0].mimicValue).toBe(resolved[0].mimicValue)
  })

  it('does nothing before mines are placed', () => {
    const pre = { ...board, minesPlaced: false }
    const resolved = resolveMimics(pre, [mimicContract], rngOf(0))
    expect(resolved[0].mimicIndex).toBeUndefined()
  })

  it('lies only at the mimic cell while active — everywhere else stays truthful', () => {
    const resolved = resolveMimics(board, [mimicContract], rngOf(0, 0))
    const lie = resolved[0]
    for (let i = 0; i < board.cells.length; i++) {
      const displayed = displayAdjacentAt(i, board.cells[i], resolved)
      if (i === lie.mimicIndex) expect(displayed).toBe(lie.mimicValue)
      else expect(displayed).toBe(board.cells[i].adjacent)
    }
  })

  it('break/clear reveals the truth', () => {
    const resolved = resolveMimics(board, [mimicContract], rngOf(0, 0))
    const lie = resolved[0]
    for (const status of ['broken', 'cleared'] as const) {
      const displayed = displayAdjacentAt(lie.mimicIndex!, board.cells[lie.mimicIndex!], [{ ...lie, status }])
      expect(displayed).toBe(board.cells[lie.mimicIndex!].adjacent)
    }
  })
})

describe('mimic enforcement (store)', () => {
  beforeEach(() => {
    useGameStore.getState().newGame(BEGINNER)
  })

  it('rejects rects larger than the cap', () => {
    useGameStore
      .getState()
      .signContract({ rect: { x: 0, y: 0, w: 7, h: 2 }, constraintId: 'mimic', multiplierBonus: 1.2 })
    expect(useGameStore.getState().contracts).toHaveLength(0)
  })

  it('defers the lie pick until mines are placed on first open', () => {
    const rect = { x: 4, y: 4, w: 4, h: 4 }
    useGameStore.getState().signContract({ rect, constraintId: 'mimic', multiplierBonus: 1.2 })
    expect(useGameStore.getState().contracts[0].mimicIndex).toBeUndefined()

    useGameStore.getState().open(0, 0)
    const s = useGameStore.getState()
    expect(s.board.minesPlaced).toBe(true)
    const c = s.contracts[0]
    const zone = rectCells(rect, s.board.width)
    const hasHiddenSafe = zone.some((i) => !s.board.cells[i].mine && s.board.cells[i].state !== 'open')
    if (c.mimicIndex !== undefined) {
      expect(zone).toContain(c.mimicIndex)
      expect(s.board.cells[c.mimicIndex].mine).toBe(false)
      expect(c.mimicValue).not.toBe(s.board.cells[c.mimicIndex].adjacent)
    } else {
      // ponytail: flood may have opened the whole zone — pick legitimately impossible
      expect(hasHiddenSafe).toBe(false)
    }
  })
})
