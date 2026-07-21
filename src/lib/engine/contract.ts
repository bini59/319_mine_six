import type { Board } from './types'
import { openedSafeCount } from './multiplier'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export type ContractStatus = 'active' | 'cleared' | 'broken'

export interface Contract {
  id: number
  rect: Rect
  // Constraint enforcement (no-flag, blind numbers, mimic, density-up) lives in
  // later issues — here a constraint is just an id plus its catalog bonus.
  constraintId: string
  multiplierBonus: number
  signedAtOpenedFraction: number
  // Effective bonus fixed at signing time (timing curve applied once, never recomputed).
  timingMultiplier: number
  // density-up only: forced extra mines in the zone, fixed at signing (#7).
  extraMines?: number
  status: ContractStatus
}

export interface ContractParams {
  nestingCap: number
  nestingDecay: number
  breakPenalty: number
  timingDecay: number
}

export const DEFAULT_CONTRACT_PARAMS: ContractParams = {
  nestingCap: 2,
  nestingDecay: 0.5,
  breakPenalty: 0.3,
  timingDecay: 1,
}

export function rectInBounds(board: Board, rect: Rect): boolean {
  return (
    rect.x >= 0 &&
    rect.y >= 0 &&
    rect.w >= 1 &&
    rect.h >= 1 &&
    rect.x + rect.w <= board.width &&
    rect.y + rect.h <= board.height
  )
}

export function rectCells(rect: Rect, boardWidth: number): number[] {
  const cells: number[] = []
  for (let dy = 0; dy < rect.h; dy++) {
    for (let dx = 0; dx < rect.w; dx++) {
      cells.push((rect.y + dy) * boardWidth + rect.x + dx)
    }
  }
  return cells
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

// ponytail: linear timing curve — signing with more revealed info pays less.
// Swap for a log curve here if balance tuning (M05) demands; callers are agnostic.
export function timingMultiplier(bonus: number, openedFraction: number, timingDecay: number): number {
  return bonus * (1 - openedFraction * timingDecay)
}

export interface SignRequest {
  rect: Rect
  constraintId: string
  multiplierBonus: number
  extraMines?: number
}

// Trust boundary for contract creation: bounds + per-cell nesting cap enforced here.
export function signContract(
  board: Board,
  contracts: readonly Contract[],
  { rect, constraintId, multiplierBonus, extraMines }: SignRequest,
  params: ContractParams = DEFAULT_CONTRACT_PARAMS,
): Contract {
  if (!rectInBounds(board, rect)) throw new Error('계약 구역이 보드 범위를 벗어났습니다')
  const live = contracts.filter((c) => c.status === 'active')
  for (const index of rectCells(rect, board.width)) {
    const layers = live.filter((c) => rectCells(c.rect, board.width).includes(index)).length
    if (layers + 1 > params.nestingCap) {
      throw new Error(`중첩 상한(${params.nestingCap})을 초과하는 구역입니다`)
    }
  }
  // A contract must carry risk: at least one hidden safe cell inside the rect.
  // Rejects fully-open rects, all-mine rects, and re-signs over cleared zones.
  const cells = rectCells(rect, board.width)
  if (!cells.some((i) => !board.cells[i].mine && board.cells[i].state !== 'open')) {
    throw new Error('이미 공개되었거나 안전 칸이 없는 구역입니다')
  }
  const totalSafe = board.width * board.height - board.mineCount
  const openedFraction = totalSafe > 0 ? openedSafeCount(board) / totalSafe : 0
  return {
    id: contracts.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    rect,
    constraintId,
    multiplierBonus,
    signedAtOpenedFraction: openedFraction,
    timingMultiplier: timingMultiplier(multiplierBonus, openedFraction, params.timingDecay),
    ...(extraMines !== undefined && { extraMines }),
    status: 'active',
  }
}

// Called after every board change: an active contract clears the moment
// every safe cell inside its rect is open.
export function resolveContracts(board: Board, contracts: readonly Contract[]): Contract[] {
  return contracts.map((c) => {
    if (c.status !== 'active') return c
    const cleared = rectCells(c.rect, board.width).every((i) => {
      const cell = board.cells[i]
      return cell.mine || cell.state === 'open'
    })
    return cleared ? { ...c, status: 'cleared' } : c
  })
}

export function breakContract(contracts: readonly Contract[], id: number): Contract[] {
  return contracts.map((c) => (c.id === id && c.status === 'active' ? { ...c, status: 'broken' } : c))
}

// Composition policy (pinned by tests):
//   total = Π cleared (1 + timingMultiplier × nestingDecay^overlaps) × Π broken (1 − breakPenalty)
// where `overlaps` counts OTHER non-broken contracts sharing area with the cleared one.
// Decay is applied to each cleared bonus BEFORE the (1 + b) product — nesting dampens
// reward, never the base game multiplier. Active contracts contribute nothing.
export function contractsMultiplier(
  contracts: readonly Contract[],
  params: ContractParams = DEFAULT_CONTRACT_PARAMS,
): number {
  return contracts.reduce((total, c) => {
    if (c.status === 'broken') return total * (1 - params.breakPenalty)
    if (c.status !== 'cleared') return total
    const overlaps = contracts.filter(
      (other) => other.id !== c.id && other.status !== 'broken' && rectsOverlap(c.rect, other.rect),
    ).length
    return total * (1 + c.timingMultiplier * params.nestingDecay ** overlaps)
  }, 1)
}
