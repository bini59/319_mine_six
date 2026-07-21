import { describe, expect, it } from 'vitest'
import { generateBoard, openCell, type ForcedZone } from './board'
import { cumulativeMultiplier, openedSafeCount } from './multiplier'
import {
  contractsMultiplier,
  rectCells,
  resolveContracts,
  signContract,
  type Contract,
  type Rect,
} from './contract'
import { BEGINNER, INTERMEDIATE, type BoardParams } from './presets'
import type { Board } from './types'

// Monte Carlo EV verification (issue #11, PRD 4.7/9). The house edge must hold
// against strategies that need no skill — random play and mechanical exploits.
// Deterministic seeds keep the assertions stable across runs.
//
// These simulations are what motivated the M05 balance fixes:
//  - board.freeOpened: "click once, cash out" had EV ≈ 1.11 (first-click
//    exemption paid as if risky). Now the first click pays ×1 exactly.
//  - zone-size bonus scaling: a 1×1 mimic zone had EV ≈ 2.13 (flat +1.2x for
//    one cell of risk). Now bonus ∝ zone safe cells / bonusScaleSafeCells.
//  - at-risk clear rule + density cap: zones covered by the first click or
//    filled with forced mines cleared themselves for free.

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomHidden(board: Board, rng: () => number, within?: readonly number[]): number {
  const pool = (within ?? board.cells.map((_, i) => i)).filter((i) => board.cells[i].state === 'hidden')
  return pool[Math.floor(rng() * pool.length)]
}

function openIndex(board: Board, i: number, rng: () => number, zones: readonly ForcedZone[] = []): Board {
  return openCell(board, i % board.width, Math.floor(i / board.width), rng, zones)
}

// Random play: exempt first click, then `riskedClicks` random clicks, cash out
// (Infinity = play to win). Returns the payout multiplier.
function playRandom(params: BoardParams, riskedClicks: number, rng: () => number): number {
  let board = generateBoard(params)
  board = openIndex(board, randomHidden(board, rng), rng)
  for (let clicks = 0; ; clicks++) {
    if (board.status === 'lost') return 0
    if (board.status === 'won' || clicks >= riskedClicks) return cumulativeMultiplier(board)
    board = openIndex(board, randomHidden(board, rng), rng)
  }
}

// Zone exploit: sign a contract pre-start, open `firstClick`, then grind only
// the zone until it clears (or nothing hidden remains), cash out immediately.
function playZoneClear(
  params: BoardParams,
  rect: Rect,
  bonus: number,
  firstClick: number,
  rng: () => number,
  forced?: { extraMines: number },
): { payout: number; cleared: boolean } {
  let board = generateBoard(params)
  let contracts: Contract[] = [
    signContract(board, [], { rect, constraintId: forced ? 'density-up' : 'mimic', multiplierBonus: bonus, ...forced }),
  ]
  const zones: ForcedZone[] = forced ? [{ rect, count: forced.extraMines }] : []
  if (forced) board = { ...board, mineCount: board.mineCount + forced.extraMines }
  const zone = rectCells(rect, board.width)

  board = openIndex(board, firstClick, rng, zones)
  contracts = resolveContracts(board, contracts)
  for (;;) {
    if (board.status === 'lost') return { payout: 0, cleared: false }
    const cleared = contracts.some((c) => c.status === 'cleared')
    const hiddenInZone = zone.some((i) => board.cells[i].state === 'hidden')
    if (cleared || !hiddenInZone || board.status === 'won') {
      return { payout: cumulativeMultiplier(board) * contractsMultiplier(contracts), cleared }
    }
    board = openIndex(board, randomHidden(board, rng, zone), rng, zones)
    contracts = resolveContracts(board, contracts)
  }
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length
}

describe('Monte Carlo EV verification (house edge holds for skill-free play)', () => {
  it('random play, cash out after 3 risked clicks (BEGINNER): EV < 1', () => {
    const rng = mulberry32(1)
    const ev = mean(Array.from({ length: 4000 }, () => playRandom(BEGINNER, 3, rng)))
    // Expected ≈ houseFactor³ ≈ 0.913 — each risked click pays 0.97 in EV.
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThan(1)
    expect(ev, `EV=${ev.toFixed(4)} — over-nerfed?`).toBeGreaterThan(0.8)
  })

  it('random play, cash out after 10 risked clicks (INTERMEDIATE): EV < 1', () => {
    const rng = mulberry32(2)
    const ev = mean(Array.from({ length: 2000 }, () => playRandom(INTERMEDIATE, 10, rng)))
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThan(1)
  })

  it('random play to full clear (BEGINNER): EV < 1', () => {
    const rng = mulberry32(3)
    const ev = mean(Array.from({ length: 800 }, () => playRandom(BEGINNER, Infinity, rng)))
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThan(1)
  })

  it('exploit: first click only, then cash out — pays exactly ×1', () => {
    const rng = mulberry32(4)
    const payouts = Array.from({ length: 300 }, () => playRandom(BEGINNER, 0, rng))
    // The exempt first click (and its flood) is never charged.
    expect(new Set(payouts)).toEqual(new Set([1]))
  })

  it('exploit: 1×1 mimic zone on the first click — never clears, EV ≤ 1', () => {
    const rng = mulberry32(5)
    const center = 4 * 9 + 4
    const runs = Array.from({ length: 300 }, () =>
      playZoneClear(BEGINNER, { x: 4, y: 4, w: 1, h: 1 }, 1.2, center, rng),
    )
    expect(runs.every((r) => !r.cleared)).toBe(true)
    const ev = mean(runs.map((r) => r.payout))
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThanOrEqual(1)
  })

  // Known, accepted bound: mechanically grinding a fixed corner zone next to
  // flood boundaries earns ~+5-6% EV even with NO contract (measured 1.058).
  // Count-based pricing cannot see revealed numbers, and deduction beating the
  // counts is the game's intended skill channel (PRD 1.3) — a human always has
  // this edge. What the contract system must NOT do is amplify it: the bonus
  // lift has to stay within the per-click house margin.
  it('bounded: 2×2 corner zone grind — contract bonus adds less than the house margin', () => {
    const rect = { x: 0, y: 0, w: 2, h: 2 }
    const run = (bonus: number, seed: number) => {
      const rng = mulberry32(seed)
      return mean(
        Array.from({ length: 10000 }, () => playZoneClear(BEGINNER, rect, bonus, 6 * 9 + 6, rng).payout),
      )
    }
    const withBonus = run(1.2, 6)
    const withoutBonus = run(0, 6)
    // Risk-scaled bonus: the lift from a 2×2 zone's full mimic bonus is tiny.
    expect(withBonus - withoutBonus, `lift=${(withBonus - withoutBonus).toFixed(4)}`).toBeLessThan(0.05)
    // And the whole pump (info edge + bonus) stays bounded.
    expect(withBonus, `EV=${withBonus.toFixed(4)}`).toBeLessThan(1.12)
  })

  it('exploit: 6×6 mimic zone fed by the first-click flood: EV < 1', () => {
    const rng = mulberry32(7)
    const runs = Array.from({ length: 4000 }, () =>
      playZoneClear(BEGINNER, { x: 1, y: 1, w: 6, h: 6 }, 1.2, 4 * 9 + 4, rng),
    )
    const ev = mean(runs.map((r) => r.payout))
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThan(1)
  })

  it('exploit: density-up 2×2 +3 mines, grind the zone: EV < 1', () => {
    const rng = mulberry32(8)
    // Store semantics: extraMines capped at rect cells − 1 → 3, bonus 3 × 0.2.
    const runs = Array.from({ length: 4000 }, () =>
      playZoneClear(BEGINNER, { x: 0, y: 0, w: 2, h: 2 }, 0.6, 6 * 9 + 6, rng, { extraMines: 3 }),
    )
    const ev = mean(runs.map((r) => r.payout))
    expect(ev, `EV=${ev.toFixed(4)}`).toBeLessThan(1)
  })
})
