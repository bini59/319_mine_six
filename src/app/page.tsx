'use client'

import { useState } from 'react'
import { GameBoard } from '@/components/game/board'
import { Button } from '@/components/ui/button'
import { BEGINNER, EXPERT, INTERMEDIATE, custom, type BoardParams } from '@/lib/engine/presets'
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
      <input className={inputClass} value={w} onChange={(e) => setW(e.target.value)} aria-label="가로" />
      <span>×</span>
      <input className={inputClass} value={h} onChange={(e) => setH(e.target.value)} aria-label="세로" />
      <input className={inputClass} value={m} onChange={(e) => setM(e.target.value)} aria-label="지뢰 수" />
      <Button type="submit" variant="secondary" size="sm">
        커스텀 시작
      </Button>
      {error && <span className="text-sm text-red-600">{error}</span>}
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

      <div className="font-mono text-lg" aria-live="polite">
        💣 {board.mineCount - flags}
      </div>

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
