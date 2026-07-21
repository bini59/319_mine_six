import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chord, generateBoard, openCell, toggleFlag } from '@/lib/engine/board'
import { cumulativeMultiplier, openedSafeCount } from '@/lib/engine/multiplier'
import type { Board } from '@/lib/engine/types'
import { BEGINNER, type BoardParams } from '@/lib/engine/presets'

export const START_BALANCE = 1000

interface GameState {
  board: Board
  params: BoardParams
  balance: number
  bet: number
  cashedOut: boolean
  newGame: (params: BoardParams, bet?: number) => void
  placeBet: (amount: number) => void
  open: (x: number, y: number) => void
  flag: (x: number, y: number) => void
  chord: (x: number, y: number) => void
  cashout: () => void
  refill: () => void
}

function clampBet(amount: number, balance: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.min(Math.floor(amount), balance))
}

// Bet is deducted up-front, so a mine click needs no settlement — the loss
// already happened. Win pays like a cashout at full board.
function settle(state: Pick<GameState, 'bet' | 'balance'>, board: Board): Partial<GameState> {
  if (board.status === 'won' && state.bet > 0) {
    return { board, bet: 0, balance: state.balance + Math.round(state.bet * cumulativeMultiplier(board)) }
  }
  if (board.status === 'lost') return { board, bet: 0 }
  return { board }
}

// Refund an unresolved mid-round stake on reload: the board isn't persisted,
// so a persisted bet has no round to resolve into — give it back.
export function mergePersisted<T extends { balance: number; bet: number }>(persisted: unknown, current: T): T {
  const p = (persisted ?? {}) as Partial<Pick<T, 'balance' | 'bet'>>
  const balance = typeof p.balance === 'number' ? p.balance : current.balance
  const bet = typeof p.bet === 'number' ? p.bet : 0
  return { ...current, balance: balance + bet, bet: 0 }
}

// generateBoard is deterministic before the first click, so SSR/client hydration matches
export const useGameStore = create<GameState>()(
  persist(
    (set) => ({
      board: generateBoard(BEGINNER),
      params: BEGINNER,
      balance: START_BALANCE,
      bet: 0,
      cashedOut: false,
      newGame: (params, bet = 0) =>
        set((s) => {
          const b = clampBet(bet, s.balance)
          return { board: generateBoard(params), params, bet: b, balance: s.balance - b, cashedOut: false }
        }),
      placeBet: (amount) =>
        set((s) => {
          if (openedSafeCount(s.board) > 0 || s.bet > 0 || s.board.status !== 'playing' || s.cashedOut) return s
          const b = clampBet(amount, s.balance)
          return { bet: b, balance: s.balance - b }
        }),
      open: (x, y) => set((s) => (s.cashedOut ? s : settle(s, openCell(s.board, x, y)))),
      flag: (x, y) => set((s) => (s.cashedOut ? s : { board: toggleFlag(s.board, x, y) })),
      chord: (x, y) => set((s) => (s.cashedOut ? s : settle(s, chord(s.board, x, y)))),
      cashout: () =>
        set((s) => {
          if (s.board.status !== 'playing' || s.bet <= 0 || s.cashedOut) return s
          return { balance: s.balance + Math.round(s.bet * cumulativeMultiplier(s.board)), bet: 0, cashedOut: true }
        }),
      // ponytail: free refill, no cooldown — virtual points only (PRD 2.2)
      refill: () => set((s) => (s.balance <= 0 && s.bet === 0 ? { balance: START_BALANCE } : s)),
    }),
    {
      name: 'mine-six-points',
      // Persist the bet too: the board isn't persisted, so an unresolved
      // mid-round stake is refunded on reload instead of silently burned.
      partialize: (s) => ({ balance: s.balance, bet: s.bet }),
      merge: mergePersisted,
    },
  ),
)
