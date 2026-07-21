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
  // mimic only (#8): the one lying cell and its displayed false value.
  // Assigned lazily after mines are placed (true adjacents must exist first).
  mimicIndex?: number
  mimicValue?: number
  status: ContractStatus
}

export interface ContractParams {
  nestingCap: number
  nestingDecay: number
  breakPenalty: number
  timingDecay: number
  bonusScaleSafeCells: number
}

export const DEFAULT_CONTRACT_PARAMS: ContractParams = {
  nestingCap: 2,
  nestingDecay: 0.5,
  breakPenalty: 0.3,
  timingDecay: 1,
  // M05 tuning: a zone's bonus scales with its (expected) safe-cell count ÷ this.
  // Each risked click gives the house ~3% (houseFactor 0.97), so the per-cell
  // bonus rate must stay well below ln(1/0.97) ≈ 0.0305 or tiny zones print
  // money (measured: 1×1 mimic zone paid EV 2.13 with a flat bonus). Flood
  // chains also clear zone cells without risked clicks, so the denominator is
  // padded ×2 over the naive bound — 100 keeps the measured EV of mechanical
  // zone-grinding under 1 (see simulation.test.ts; 50 measured EV 1.14).
  bonusScaleSafeCells: 100,
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
  const totalCells = board.width * board.height
  const totalSafe = totalCells - board.mineCount
  const openedFraction = totalSafe > 0 ? openedSafeCount(board) / totalSafe : 0
  // M05 tuning: bonus is proportional to the risk actually wagered — the
  // zone's safe cells the player must open. Pre-start (no mines yet) uses the
  // expected count at board density; post-start uses the actual hidden-safe
  // count. Density-up is excluded: its bonus is per forced mine, and the local
  // mine risk already prices it (see simulation.test.ts).
  const zoneSafeEstimate = board.minesPlaced
    ? cells.filter((i) => !board.cells[i].mine && board.cells[i].state !== 'open').length
    : (cells.length * totalSafe) / totalCells
  const sizeScale = extraMines ? 1 : Math.min(1, zoneSafeEstimate / params.bonusScaleSafeCells)
  return {
    id: contracts.reduce((max, c) => Math.max(max, c.id), 0) + 1,
    rect,
    constraintId,
    multiplierBonus,
    signedAtOpenedFraction: openedFraction,
    timingMultiplier: timingMultiplier(multiplierBonus * sizeScale, openedFraction, params.timingDecay),
    ...(extraMines !== undefined && { extraMines }),
    status: 'active',
  }
}

// Called after every board change: an active contract clears the moment
// every safe cell inside its rect is open — AND at least one of them was
// opened at risk. Cells revealed by the exempt first click (board.freeOpened)
// and mines forced into the zone don't count: without this, a zone covered by
// the first click (or filled with density mines) cleared itself for free
// (M05 Monte Carlo exploit).
export function resolveContracts(board: Board, contracts: readonly Contract[]): Contract[] {
  const free = new Set(board.freeOpened ?? [])
  return contracts.map((c) => {
    if (c.status !== 'active') return c
    const cells = rectCells(c.rect, board.width)
    const cleared =
      cells.every((i) => board.cells[i].mine || board.cells[i].state === 'open') &&
      cells.some((i) => !board.cells[i].mine && board.cells[i].state === 'open' && !free.has(i))
    return cleared ? { ...c, status: 'cleared' } : c
  })
}

// Diff for the clear FX (#9): contracts that were active before settle and
// cleared after it. Length = combo count for simultaneous clears.
export function newlyClearedContracts(prev: readonly Contract[], next: readonly Contract[]): Contract[] {
  const wasActive = new Set(prev.filter((c) => c.status === 'active').map((c) => c.id))
  return next.filter((c) => c.status === 'cleared' && wasActive.has(c.id))
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
