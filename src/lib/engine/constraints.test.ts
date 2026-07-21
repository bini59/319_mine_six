import { describe, expect, it } from 'vitest'
import { activeLayersAt, rectFromCorners } from './constraints'
import type { Contract, Rect } from './contract'

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
