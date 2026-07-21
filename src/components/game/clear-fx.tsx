'use client'

import { useEffect, useRef } from 'react'
import { playClearSound } from '@/lib/sound'
import { useGameStore } from '@/store/game'

// Overlay for the contract clear moment (#9): multiplier pop + combo badge + sound.
// The golden wave lives on the board cells (gold-pulse class); this component only
// renders the centered pop. Store's next action resets lastClear — no local timers.
export function ClearFx() {
  const lastClear = useGameStore((s) => s.lastClear)
  const playedAt = useRef(0)

  useEffect(() => {
    if (!lastClear) return
    // Strict-mode double effects and re-renders replay the same `at` — play once.
    if (playedAt.current === lastClear.at) return
    playedAt.current = lastClear.at
    playClearSound(lastClear.combo)
  }, [lastClear])

  if (!lastClear) return null
  return (
    <div
      // key restarts the CSS pop when the same zone clears again (at changes)
      key={lastClear.at}
      className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center"
      aria-live="polite"
    >
      <div className="clear-pop flex flex-col items-center rounded-lg bg-black/70 px-4 py-2 text-center">
        <span className="text-2xl font-bold text-amber-300">파훼! ×{lastClear.multiplier.toFixed(2)}</span>
        {lastClear.combo >= 2 && <span className="text-lg font-bold text-amber-400">콤보 ×{lastClear.combo}</span>}
      </div>
    </div>
  )
}
