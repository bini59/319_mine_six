'use client'

import { useGameStore } from '@/store/game'
import { BLIND_FADE_MS, activeLayersAt, displayAdjacentAt, isBlindAt, type Corner } from '@/lib/engine/constraints'
import type { Rect } from '@/lib/engine/contract'
import type { Cell } from '@/lib/engine/types'
import { ClearFx } from './clear-fx'

// Classic minesweeper number palette (1–8)
const NUMBER_COLORS = [
  '',
  'text-blue-600',
  'text-green-600',
  'text-red-600',
  'text-blue-900',
  'text-red-900',
  'text-cyan-700',
  'text-black',
  'text-gray-600',
]

// Purple zone rings: 1 layer vs 2 layers (nestingCap) must read differently.
const ZONE_RINGS = ['', 'ring-2 ring-inset ring-purple-500', 'ring-2 ring-inset ring-purple-800 bg-purple-500/20']

// `displayed` may be a mimic lie — the truth never reaches the view here.
function cellContent(cell: Cell, lost: boolean, displayed: number): string {
  if (cell.state === 'flagged') return '🚩'
  if (cell.state === 'hidden') return ''
  if (cell.mine) return lost ? '💥' : '💣'
  return displayed > 0 ? String(displayed) : ''
}

function inRect(rect: Rect | null, x: number, y: number): boolean {
  return !!rect && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h
}

export interface ContractSelection {
  contractMode: boolean
  preview: Rect | null
  onCellPointerDown: (c: Corner) => void
  onCellPointerEnter: (c: Corner) => void
  onCellPointerUp: (c: Corner) => void
}

// Golden wave (#9): delay grows with distance from the cleared rect's origin.
function goldDelay(rects: readonly Rect[], x: number, y: number): number | null {
  for (const r of rects) {
    if (inRect(r, x, y)) return ((x - r.x) + (y - r.y)) * 40
  }
  return null
}

export function GameBoard({ selection }: { selection?: ContractSelection }) {
  const { board, contracts, flagBlockedAt, lastClear, open, flag, chord } = useGameStore()
  const lost = board.status === 'lost'
  const contractMode = selection?.contractMode ?? false

  return (
    <div className="relative">
      {/* ponytail: transient store field is the whole feedback state — cleared on the next action */}
      <p aria-live="polite" className="sr-only">
        {flagBlockedAt !== null ? '이 구역은 깃발을 꽂을 수 없습니다' : ''}
      </p>
      <div
      // ponytail: back-to-back clears don't restart this pulse (no key remount —
      // rekeying would drop 480 buttons and focus). Pop/wave still restart via `at`.
      className={`grid w-fit max-w-full select-none gap-px overflow-auto bg-gray-400 p-px dark:bg-gray-600 ${
        lastClear ? 'board-slowmo' : ''
      }`}
      // ponytail: touch drag-select is not supported — touch users tap two corners.
      style={{ gridTemplateColumns: `repeat(${board.width}, minmax(0, 1fr))`, touchAction: contractMode ? 'none' : undefined }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {board.cells.map((cell, i) => {
        const x = i % board.width
        const y = Math.floor(i / board.width)
        const isOpen = cell.state === 'open'
        const displayed = displayAdjacentAt(i, cell, contracts)
        // Blind zone: opened numbers fade out after BLIND_FADE_MS (CSS-only,
        // no per-cell timers). break/clear drops the class → truth returns.
        const blind = isOpen && !cell.mine && displayed > 0 && isBlindAt(i, contracts, board.width)
        const layers = Math.min(activeLayersAt(i, contracts, board.width), ZONE_RINGS.length - 1)
        const previewing = contractMode && inRect(selection?.preview ?? null, x, y)
        // ponytail: same-cell re-clear at a different `at` won't restart the CSS
        // animation (class unchanged) — acceptable, distinct zones dominate.
        const gold = lastClear ? goldDelay(lastClear.rects, x, y) : null
        return (
          <button
            key={i}
            type="button"
            aria-label={`cell ${x},${y} ${cell.state}`}
            style={gold !== null ? { animationDelay: `${gold}ms` } : undefined}
            className={`flex size-7 items-center justify-center text-sm font-bold sm:size-8 ${
              isOpen
                ? cell.mine
                  ? 'bg-red-300'
                  : `bg-gray-200 dark:bg-gray-700 ${NUMBER_COLORS[displayed] ?? ''}`
                : 'bg-gray-300 hover:bg-gray-200 active:bg-gray-100 dark:bg-gray-500 dark:hover:bg-gray-400'
            } ${previewing ? 'bg-purple-400/60 dark:bg-purple-400/60' : ZONE_RINGS[layers]} ${
              flagBlockedAt === i ? 'animate-pulse ring-2 ring-inset ring-red-500' : ''
            } ${gold !== null ? 'gold-pulse' : ''}`}
            onClick={() => {
              if (contractMode) return
              if (isOpen && cell.adjacent > 0) chord(x, y)
              else open(x, y)
            }}
            onContextMenu={() => {
              if (!contractMode) flag(x, y)
            }}
            onKeyDown={(e) => {
              if (contractMode) return
              if (e.key === 'f' || (e.shiftKey && e.key === 'Enter')) {
                e.preventDefault()
                flag(x, y)
              }
            }}
            onPointerDown={() => contractMode && selection?.onCellPointerDown({ x, y })}
            onPointerEnter={() => contractMode && selection?.onCellPointerEnter({ x, y })}
            onPointerUp={() => contractMode && selection?.onCellPointerUp({ x, y })}
          >
            {blind ? (
              <span className="blind-fade" style={{ animationDelay: `${BLIND_FADE_MS}ms` }}>
                {cellContent(cell, lost, displayed)}
              </span>
            ) : (
              cellContent(cell, lost, displayed)
            )}
          </button>
        )
      })}
      </div>
      <ClearFx />
    </div>
  )
}
