'use client'

import { useState } from 'react'
import { GameBoard } from '@/components/game/board'
import { Hud } from '@/components/game/hud'
import { Button } from '@/components/ui/button'
import { BEGINNER, EXPERT, INTERMEDIATE, custom, type BoardParams } from '@/lib/engine/presets'
import { openedSafeCount } from '@/lib/engine/multiplier'
import { useGameStore } from '@/store/game'

const PRESETS: { label: string; params: BoardParams }[] = [
  { label: '초급 9×9', params: BEGINNER },
  { label: '중급 16×16', params: INTERMEDIATE },
  { label: '고급 30×16', params: EXPERT },
]

function CustomForm({ onStart }: { onStart: (params: BoardParams) => void }) {
  const [w, setW] = useState('9')
  const [h, setH] = useState('9')
  const [m, setM] = useState('10')
  const [error, setError] = useState('')

  const inputClass = 'w-16 rounded border px-2 py-1 text-sm dark:bg-gray-800'
  return (
    <form
      className="flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        try {
          onStart(custom(Number(w), Number(h), Number(m)))
          setError('')
        } catch (err) {
          setError(err instanceof Error ? err.message : '잘못된 설정')
        }
      }}
    >
      <input className={inputClass} inputMode="numeric" value={w} onChange={(e) => setW(e.target.value)} aria-label="가로" />
      <span>×</span>
      <input className={inputClass} inputMode="numeric" value={h} onChange={(e) => setH(e.target.value)} aria-label="세로" />
      <input className={inputClass} inputMode="numeric" value={m} onChange={(e) => setM(e.target.value)} aria-label="지뢰 수" />
      <Button type="submit" variant="secondary" size="sm">
        커스텀 시작
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </form>
  )
}

function BetForm() {
  const { board, bet, balance, cashedOut, placeBet } = useGameStore()
  const [amount, setAmount] = useState('100')
  // Bets are only placeable before the first cell is opened
  if (openedSafeCount(board) > 0 || bet > 0 || board.status !== 'playing' || cashedOut) return null

  return (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        placeBet(Number(amount))
      }}
    >
      <input
        className="w-24 rounded border px-2 py-1 text-sm dark:bg-gray-800"
        inputMode="numeric"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="베팅액"
      />
      <Button type="submit" size="sm" disabled={balance <= 0}>
        베팅
      </Button>
    </form>
  )
}

export default function Home() {
  const { board, params, newGame } = useGameStore()
  const flags = board.cells.filter((c) => c.state === 'flagged').length
  const finished = board.status !== 'playing'

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">지뢰찾기</h1>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {PRESETS.map(({ label, params: p }) => (
          <Button key={label} variant="outline" size="sm" onClick={() => newGame(p)}>
            {label}
          </Button>
        ))}
      </div>
      <CustomForm onStart={newGame} />

      <div className="font-mono text-lg">
        <span aria-hidden>💣</span>{' '}
        <span aria-live="polite" aria-label="남은 지뢰">
          {board.mineCount - flags}
        </span>
      </div>

      <BetForm />
      <Hud />

      <div className="relative">
        <GameBoard />
        {finished && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60">
            <p className="text-3xl font-bold text-white">{board.status === 'won' ? '🎉 승리!' : '💥 패배'}</p>
            <Button onClick={() => newGame(params)}>다시하기</Button>
          </div>
        )}
      </div>
    </main>
  )
}
