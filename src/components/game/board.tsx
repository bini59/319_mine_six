'use client'

import { useGameStore } from '@/store/game'
import type { Cell } from '@/lib/engine/types'

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

function cellContent(cell: Cell, lost: boolean): string {
  if (cell.state === 'flagged') return '🚩'
  if (cell.state === 'hidden') return ''
  if (cell.mine) return lost ? '💥' : '💣'
  return cell.adjacent > 0 ? String(cell.adjacent) : ''
}

export function GameBoard() {
  const { board, open, flag, chord } = useGameStore()
  const lost = board.status === 'lost'

  return (
    <div
      className="grid w-fit max-w-full select-none gap-px overflow-auto bg-gray-400 p-px dark:bg-gray-600"
      style={{ gridTemplateColumns: `repeat(${board.width}, minmax(0, 1fr))` }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {board.cells.map((cell, i) => {
        const x = i % board.width
        const y = Math.floor(i / board.width)
        const isOpen = cell.state === 'open'
        return (
          <button
            key={i}
            type="button"
            aria-label={`cell ${x},${y} ${cell.state}`}
            className={`flex size-7 items-center justify-center text-sm font-bold sm:size-8 ${
              isOpen
                ? cell.mine
                  ? 'bg-red-300'
                  : `bg-gray-200 dark:bg-gray-700 ${NUMBER_COLORS[cell.adjacent]}`
                : 'bg-gray-300 hover:bg-gray-200 active:bg-gray-100 dark:bg-gray-500 dark:hover:bg-gray-400'
            }`}
            onClick={() => (isOpen && cell.adjacent > 0 ? chord(x, y) : open(x, y))}
            onContextMenu={() => flag(x, y)}
            onKeyDown={(e) => {
              if (e.key === 'f' || (e.shiftKey && e.key === 'Enter')) {
                e.preventDefault()
                flag(x, y)
              }
            }}
          >
            {cellContent(cell, lost)}
          </button>
        )
      })}
    </div>
  )
}
