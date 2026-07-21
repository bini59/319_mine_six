import { rectCells, type Contract, type Rect } from './contract'
import type { Board, Cell } from './types'

export interface ConstraintDef {
  id: string
  label: string
  bonus: number
  // Enforcement metadata (#7): signable only before the first cell opens.
  preStartOnly?: boolean
  // Flags are blocked inside active zones with this constraint.
  noFlag?: boolean
  // density-up: bonus per forced extra mine (base `bonus` stays 0).
  extraMinesBonus?: number
}

// PRD 4.4 catalog — bonuses are the manual-tuning knobs (PRD 4.7 is P2).
export const CONSTRAINTS: ConstraintDef[] = [
  { id: 'no-flag', label: '무깃발', bonus: 0.4, noFlag: true },
  { id: 'blind-number', label: '블라인드 숫자', bonus: 0.5 },
  { id: 'mimic', label: '미믹', bonus: 1.2 },
  { id: 'density-up', label: '지뢰 밀도 업', bonus: 0, preStartOnly: true, extraMinesBonus: 0.2 },
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

function covers(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

// How many ACTIVE contracts cover this cell — drives the purple ring depth (nestingCap 2).
export function activeLayersAt(index: number, contracts: readonly Contract[], boardWidth: number): number {
  const x = index % boardWidth
  const y = Math.floor(index / boardWidth)
  return contracts.filter((c) => c.status === 'active' && covers(c.rect, x, y)).length
}

// 무깃발 enforcement: a cell inside any ACTIVE no-flag zone rejects flags.
// break/clear lifts the block automatically — this is a pure derivation.
export function isFlagBlockedAt(index: number, contracts: readonly Contract[], boardWidth: number): boolean {
  const x = index % boardWidth
  const y = Math.floor(index / boardWidth)
  return contracts.some((c) => c.status === 'active' && c.constraintId === 'no-flag' && covers(c.rect, x, y))
}

// 블라인드 숫자: numbers inside active zones fade out after this delay.
// PRD open question — 3s is the tuning knob, not a law.
export const BLIND_FADE_MS = 3000

// 미믹 최대 구역 크기 (PRD 4.4, parameterized).
export const MIMIC_MAX_RECT = 6

export function isBlindAt(index: number, contracts: readonly Contract[], boardWidth: number): boolean {
  const x = index % boardWidth
  const y = Math.floor(index / boardWidth)
  return contracts.some((c) => c.status === 'active' && c.constraintId === 'blind-number' && covers(c.rect, x, y))
}

export function mimicRectTooLarge(rect: Rect): boolean {
  return rect.w > MIMIC_MAX_RECT || rect.h > MIMIC_MAX_RECT
}

// Pick the one lying cell: a hidden safe cell in the zone plus a false value
// (0–8, never the truth). Deterministic via injected rng.
// ponytail: no candidates (zone flood-opened / all mines) → null, caller retries
// on the next board change.
export function pickMimic(
  board: Board,
  rect: Rect,
  rng: () => number,
): { mimicIndex: number; mimicValue: number } | null {
  const candidates = rectCells(rect, board.width).filter(
    (i) => !board.cells[i].mine && board.cells[i].state !== 'open',
  )
  if (candidates.length === 0) return null
  const mimicIndex = candidates[Math.floor(rng() * candidates.length)]
  const truth = board.cells[mimicIndex].adjacent
  // 0–8 minus the truth = 8 options; shift picks past the truth to skip it.
  const pick = Math.floor(rng() * 8)
  const mimicValue = pick >= truth ? pick + 1 : pick
  return { mimicIndex, mimicValue }
}

// Assign the lie to active mimic contracts that don't have one yet.
// Only meaningful after mines are placed (true adjacents exist).
export function resolveMimics(board: Board, contracts: readonly Contract[], rng: () => number): Contract[] {
  if (!board.minesPlaced) return [...contracts]
  return contracts.map((c) => {
    if (c.status !== 'active' || c.constraintId !== 'mimic' || c.mimicIndex !== undefined) return c
    const picked = pickMimic(board, c.rect, rng)
    return picked ? { ...c, ...picked } : c
  })
}

// Display-layer indirection: the lie exists only here, and only while the
// contract is active — break/clear reveals the truth. Out-of-zone numbers
// always come straight from the engine (100% truthful, PRD 1.3).
// ponytail: chord still uses the engine's true adjacent, so chording the mimic
// cell leaks the truth — accepted mechanic; revisit in M05 balance tuning.
export function displayAdjacentAt(index: number, cell: Cell, contracts: readonly Contract[]): number {
  const mimic = contracts.find((c) => c.status === 'active' && c.constraintId === 'mimic' && c.mimicIndex === index)
  return mimic?.mimicValue ?? cell.adjacent
}
