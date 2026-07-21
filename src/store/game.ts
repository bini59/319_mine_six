import { create } from 'zustand'
import { chord, generateBoard, openCell, toggleFlag } from '@/lib/engine/board'
import type { Board } from '@/lib/engine/types'
import { BEGINNER, type BoardParams } from '@/lib/engine/presets'

interface GameState {
  board: Board
  params: BoardParams
  newGame: (params: BoardParams) => void
  open: (x: number, y: number) => void
  flag: (x: number, y: number) => void
  chord: (x: number, y: number) => void
}

// generateBoard is deterministic before the first click, so SSR/client hydration matches
export const useGameStore = create<GameState>((set) => ({
  board: generateBoard(BEGINNER),
  params: BEGINNER,
  newGame: (params) => set({ board: generateBoard(params), params }),
  open: (x, y) => set((s) => ({ board: openCell(s.board, x, y) })),
  flag: (x, y) => set((s) => ({ board: toggleFlag(s.board, x, y) })),
  chord: (x, y) => set((s) => ({ board: chord(s.board, x, y) })),
}))
