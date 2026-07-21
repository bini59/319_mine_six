'use client'

import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { cumulativeMultiplier, openedSafeCount, stepMultiplier } from '@/lib/engine/multiplier'
import { useGameStore } from '@/store/game'

const HOLD_MS = 500

export function Hud() {
  const { board, bet, balance, cashedOut, cashout, refill } = useGameStore()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)

  const current = cumulativeMultiplier(board)
  const remainingSafe = board.width * board.height - board.mineCount - openedSafeCount(board)
  // ponytail: stepMultiplier throws at remainingSafe <= 0 (board won) — show a dash instead
  const next = remainingSafe > 0 ? current * stepMultiplier(remainingSafe, board.mineCount) : null
  const payout = Math.round(bet * current)
  const canCashout = board.status === 'playing' && bet > 0 && !cashedOut

  const cancelHold = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  useEffect(() => cancelHold, [])

  const startHold = () => {
    if (!canCashout || timer.current) return
    setHolding(true)
    timer.current = setTimeout(() => {
      cancelHold()
      cashout()
    }, HOLD_MS)
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-end gap-6 font-mono" aria-live="polite">
        <div className="text-center">
          <div className="text-xs text-gray-500">현재 배율</div>
          <div className="text-2xl font-bold">×{current.toFixed(2)}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">다음 칸 성공 시</div>
          <div className="text-2xl font-bold text-amber-600">{next ? `×${next.toFixed(2)}` : '—'}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">확정 가능</div>
          <div className="text-2xl font-bold text-green-600">{payout}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">잔액</div>
          <div className="text-2xl font-bold">{balance}</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={!canCashout}
          className="relative select-none overflow-hidden"
          // Pointer: hold 0.5s to confirm (timer fires cashout). Keyboard: immediate.
          // No onClick — pointer-up click and keyboard click would double-fire otherwise.
          onPointerDown={startHold}
          onPointerUp={cancelHold}
          onPointerLeave={cancelHold}
          onPointerCancel={cancelHold}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              if (canCashout) cashout()
            }
          }}
        >
          {/* ponytail: CSS transition is the whole progress bar — no JS progress state */}
          <span
            aria-hidden
            className="absolute inset-0 origin-left bg-green-500/50 transition-transform ease-linear"
            style={{ transform: holding ? 'scaleX(1)' : 'scaleX(0)', transitionDuration: holding ? `${HOLD_MS}ms` : '0ms' }}
          />
          <span className="relative">캐시아웃 {payout > 0 ? payout : ''}</span>
        </Button>
        {balance <= 0 && bet === 0 && (
          <Button variant="secondary" onClick={refill}>
            무료 리필
          </Button>
        )}
      </div>
    </div>
  )
}
