import { CONSTRAINTS } from '@/lib/engine/constraints'
import { rectCells, type Contract, type Rect } from '@/lib/engine/contract'
import { openedSafeCount } from '@/lib/engine/multiplier'
import type { Board } from '@/lib/engine/types'

// One entry per successful, board/round-affecting player choice.
// Defined here (not in the store) so the pure summary layer owns the shape.
export interface RoundEvent {
  type: 'bet' | 'open' | 'flag' | 'chord' | 'sign' | 'break' | 'cashout'
  x?: number
  y?: number
  constraintId?: string
  rect?: Rect
  multiplier?: number
}

export interface DeathSummary {
  killedAt: { x: number; y: number } | null
  totalOpens: number
  peakMultiplier: number
  recentChoices: RoundEvent[]
  signedContracts: { label: string }[]
  killedInContractZone: { label: string } | null
}

export const RECENT_CHOICES = 5

function constraintLabel(id: string | undefined): string {
  return CONSTRAINTS.find((c) => c.id === id)?.label ?? id ?? '계약'
}

// The fatal action's coordinate, cross-checked against the board: an 'open'
// must have hit a mine at that exact cell; a 'chord' must have a mine adjacent
// (chord kills via a wrongly-flagged neighborhood, not the numbered cell itself).
function findKilledAt(board: Board, history: readonly RoundEvent[]): { x: number; y: number } | null {
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]
    if ((e.type !== 'open' && e.type !== 'chord') || e.x === undefined || e.y === undefined) continue
    const cell = board.cells[e.y * board.width + e.x]
    if (!cell) return null
    if (e.type === 'open') return cell.mine ? { x: e.x, y: e.y } : null
    const nearMine = board.cells.some(
      (c, j) =>
        c.mine && Math.abs((j % board.width) - e.x!) <= 1 && Math.abs(Math.floor(j / board.width) - e.y!) <= 1,
    )
    return nearMine ? { x: e.x, y: e.y } : null
  }
  return null
}

// Pure summary of "which choices led to this death" (PRD 5 — 납득 원칙).
// Defensive: empty history or unidentifiable kill returns a minimal summary.
export function summarizeDeath(
  board: Board,
  history: readonly RoundEvent[],
  contracts: readonly Contract[],
): DeathSummary {
  const killedAt = findKilledAt(board, history)

  const multipliers = history
    .filter((e) => (e.type === 'open' || e.type === 'chord') && e.multiplier !== undefined)
    .map((e) => e.multiplier as number)
  const peakMultiplier = multipliers.length > 0 ? Math.max(...multipliers) : 1

  const signedContracts = history
    .filter((e) => e.type === 'sign')
    .map((e) => ({ label: constraintLabel(e.constraintId) }))

  let killedInContractZone: { label: string } | null = null
  if (killedAt) {
    const index = killedAt.y * board.width + killedAt.x
    const covering = contracts.filter((c) => rectCells(c.rect, board.width).includes(index))
    // density-up first — "you died inside the zone you added mines to" is THE insight.
    const pick = covering.find((c) => c.constraintId === 'density-up') ?? covering[0]
    if (pick) killedInContractZone = { label: constraintLabel(pick.constraintId) }
  }

  return {
    killedAt,
    totalOpens: openedSafeCount(board),
    peakMultiplier,
    recentChoices: history.slice(-RECENT_CHOICES),
    signedContracts,
    killedInContractZone,
  }
}
