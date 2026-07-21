import type { Contract, Rect } from './contract'

export interface ConstraintDef {
  id: string
  label: string
  bonus: number
}

// PRD 4.4 catalog — the picker only needs id/label/bonus; enforcement lands in #7/#8.
// ponytail: 지뢰 밀도 업(+0.2x/개, 시작 전 전용) is excluded until #7 wires the
// pre-start-only rule; add it here with a `preStartOnly` flag when that lands.
export const CONSTRAINTS: ConstraintDef[] = [
  { id: 'no-flag', label: '무깃발', bonus: 0.4 },
  { id: 'blind-number', label: '블라인드 숫자', bonus: 0.5 },
  { id: 'mimic', label: '미믹', bonus: 1.2 },
]

export interface Corner {
  x: number
  y: number
}

// Two corners in any order → normalized inclusive Rect.
export function rectFromCorners(a: Corner, b: Corner): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x) + 1,
    h: Math.abs(a.y - b.y) + 1,
  }
}

// How many ACTIVE contracts cover this cell — drives the purple ring depth (nestingCap 2).
export function activeLayersAt(index: number, contracts: readonly Contract[], boardWidth: number): number {
  const x = index % boardWidth
  const y = Math.floor(index / boardWidth)
  return contracts.filter(
    (c) =>
      c.status === 'active' &&
      x >= c.rect.x &&
      x < c.rect.x + c.rect.w &&
      y >= c.rect.y &&
      y < c.rect.y + c.rect.h,
  ).length
}
