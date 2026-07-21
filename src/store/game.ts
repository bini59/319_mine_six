import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { chord, generateBoard, openCell, toggleFlag, type ForcedZone } from '@/lib/engine/board'
import { CONSTRAINTS, isFlagBlockedAt } from '@/lib/engine/constraints'
import {
  breakContract as breakContractEngine,
  contractsMultiplier,
  resolveContracts,
  signContract as signContractEngine,
  type Contract,
  type SignRequest,
} from '@/lib/engine/contract'
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
  contracts: Contract[]
  // Transient: index of the last flag attempt blocked by a no-flag zone (UI flash).
  flagBlockedAt: number | null
  newGame: (params: BoardParams, bet?: number) => void
  placeBet: (amount: number) => void
  open: (x: number, y: number) => void
  flag: (x: number, y: number) => void
  chord: (x: number, y: number) => void
  cashout: () => void
  refill: () => void
  signContract: (request: SignRequest) => void
  breakContract: (id: number) => void
}

function clampBet(amount: number, balance: number): number {
  if (!Number.isFinite(amount)) return 0
  return Math.max(0, Math.min(Math.floor(amount), balance))
}

// Bet is deducted up-front, so a mine click needs no settlement — the loss
// already happened. Win pays like a cashout at full board.
// Payout multiplier = base curve × contract factors (cleared/broken), see contract.ts.
function settle(state: Pick<GameState, 'bet' | 'balance' | 'contracts'>, board: Board): Partial<GameState> {
  const contracts = resolveContracts(board, state.contracts)
  if (board.status === 'won' && state.bet > 0) {
    const payout = Math.round(state.bet * cumulativeMultiplier(board) * contractsMultiplier(contracts))
    return { board, contracts, bet: 0, balance: state.balance + payout }
  }
  if (board.status === 'lost') return { board, contracts, bet: 0 }
  return { board, contracts }
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
      contracts: [],
      flagBlockedAt: null,
      newGame: (params, bet = 0) =>
        set((s) => {
          const b = clampBet(bet, s.balance)
          return {
            board: generateBoard(params),
            params,
            bet: b,
            balance: s.balance - b,
            cashedOut: false,
            contracts: [],
            flagBlockedAt: null,
          }
        }),
      placeBet: (amount) =>
        set((s) => {
          if (openedSafeCount(s.board) > 0 || s.bet > 0 || s.board.status !== 'playing' || s.cashedOut) return s
          const b = clampBet(amount, s.balance)
          return { bet: b, balance: s.balance - b }
        }),
      open: (x, y) =>
        set((s) => {
          if (s.cashedOut) return s
          // Active density-up zones force their extra mines at lazy placement time.
          const zones: ForcedZone[] = s.board.minesPlaced
            ? []
            : s.contracts
                .filter((c) => c.status === 'active' && c.constraintId === 'density-up' && c.extraMines)
                .map((c) => ({ rect: c.rect, count: c.extraMines as number }))
          return { ...settle(s, openCell(s.board, x, y, Math.random, zones)), flagBlockedAt: null }
        }),
      flag: (x, y) =>
        set((s) => {
          if (s.cashedOut) return s
          const index = y * s.board.width + x
          // ponytail: active 계약만 enforce — break/clear는 파생 판정이라 자동 해제
          if (isFlagBlockedAt(index, s.contracts, s.board.width)) return { flagBlockedAt: index }
          return { board: toggleFlag(s.board, x, y), flagBlockedAt: null }
        }),
      chord: (x, y) => set((s) => (s.cashedOut ? s : { ...settle(s, chord(s.board, x, y)), flagBlockedAt: null })),
      cashout: () =>
        set((s) => {
          if (s.board.status !== 'playing' || s.bet <= 0 || s.cashedOut) return s
          // Invariant: contracts are resolved only in settle() (i.e. after board
          // changes). Do NOT resolve here — cashout must pay only already-cleared
          // contracts, or sign-over-open zones would earn at cashout time.
          const payout = Math.round(s.bet * cumulativeMultiplier(s.board) * contractsMultiplier(s.contracts))
          return { balance: s.balance + payout, bet: 0, cashedOut: true }
        }),
      signContract: (request) =>
        set((s) => {
          if (s.board.status !== 'playing' || s.cashedOut) return s
          const def = CONSTRAINTS.find((c) => c.id === request.constraintId)
          if (def?.preStartOnly && s.board.minesPlaced) return s
          try {
            const contract = signContractEngine(s.board, s.contracts, request)
            // mineCount bumps once at signing so the multiplier curve, win check
            // and HUD counter all see the extra mines coherently. Actual placement
            // (and any exemption cap) reconciles mineCount inside openCell.
            const extra = contract.constraintId === 'density-up' ? (contract.extraMines ?? 0) : 0
            return {
              contracts: [...s.contracts, contract],
              board: extra > 0 ? { ...s.board, mineCount: s.board.mineCount + extra } : s.board,
              flagBlockedAt: null,
            }
          } catch {
            // ponytail: invalid sign (out of bounds / nesting cap) is a no-op — UI (#6) pre-validates
            return s
          }
        }),
      breakContract: (id) =>
        set((s) =>
          s.board.status === 'playing' && !s.cashedOut ? { contracts: breakContractEngine(s.contracts, id) } : s,
        ),
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
