'use client'

import { useEffect, useState } from 'react'
import { GameBoard, type ContractSelection } from '@/components/game/board'
import { ContractHud } from '@/components/game/contract-hud'
import { DeathSummary } from '@/components/game/death-summary'
import { Hud } from '@/components/game/hud'
import { Button } from '@/components/ui/button'
import { BEGINNER, EXPERT, INTERMEDIATE, custom, type BoardParams } from '@/lib/engine/presets'
import { scanCost } from '@/lib/engine/board'
import { openedSafeCount } from '@/lib/engine/multiplier'
import {
  activeLayersAt,
  mimicRectTooLarge,
  rectFromCorners,
  CONSTRAINTS,
  MIMIC_MAX_RECT,
  type Corner,
} from '@/lib/engine/constraints'
import { DEFAULT_CONTRACT_PARAMS, rectCells, rectInBounds, type Rect } from '@/lib/engine/contract'
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
      <Button
        type="submit"
        size="sm"
        disabled={balance <= 0 || !Number.isFinite(Number(amount)) || Number(amount) <= 0}
      >
        베팅
      </Button>
    </form>
  )
}

// Drag and two-corner tap share one state machine: down anchors, enter previews,
// up on a different cell (or a second tap) confirms. `armed` distinguishes the
// anchor tap's own pointerup from a second same-cell tap (1×1 zone).
function useZoneSelection(onRect: (rect: Rect) => void) {
  const [anchor, setAnchor] = useState<Corner | null>(null)
  const [armed, setArmed] = useState(false)
  const [preview, setPreview] = useState<Rect | null>(null)

  const reset = () => {
    setAnchor(null)
    setArmed(false)
    setPreview(null)
  }
  const confirm = (b: Corner) => {
    if (anchor) onRect(rectFromCorners(anchor, b))
    reset()
  }

  return {
    preview,
    reset,
    onCellPointerDown: (c: Corner) => {
      // Re-anchor unless a two-tap selection is armed: recovers from a drag
      // whose pointerup landed outside the grid (dangling anchor).
      if (!anchor || !armed) {
        setAnchor(c)
        setArmed(false)
        setPreview(rectFromCorners(c, c))
      } else {
        setPreview(rectFromCorners(anchor, c))
      }
    },
    onCellPointerEnter: (c: Corner) => {
      if (anchor) setPreview(rectFromCorners(anchor, c))
    },
    onCellPointerUp: (c: Corner) => {
      if (!anchor) return
      if (c.x === anchor.x && c.y === anchor.y && !armed) setArmed(true)
      else confirm(c)
    },
  }
}

export default function Home() {
  const { board, params, contracts, bet, balance, cashedOut, newGame, signContract } = useGameStore()
  const flags = board.cells.filter((c) => c.state === 'flagged').length
  const finished = board.status !== 'playing'

  const [contractMode, setContractMode] = useState(false)
  const [scanMode, setScanMode] = useState(false)
  const [pendingRect, setPendingRect] = useState<Rect | null>(null)
  const [contractError, setContractError] = useState('')
  const zone = useZoneSelection((rect) => {
    setContractError('')
    setPendingRect(rect)
  })

  const exitContractMode = () => {
    setContractMode(false)
    setPendingRect(null)
    setContractError('')
    zone.reset()
  }

  // A new board invalidates any in-flight selection — reset before starting.
  const startGame = (p: BoardParams) => {
    exitContractMode()
    setScanMode(false)
    newGame(p)
  }

  // Modes are mutually exclusive: entering one exits the other.
  const cost = scanCost(board, bet)
  const canScan = !finished && board.minesPlaced && !cashedOut && balance >= cost

  // Instant retry: Enter restarts with the same params once the round ends
  // (PRD 5 — 사망 후 30초 내 리트라이 목표). Re-registering per render is cheap.
  useEffect(() => {
    if (!finished) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat) startGame(params)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Pre-validate so the store's silent no-op never leaves the user without feedback.
  const validateRect = (rect: Rect): string => {
    if (!rectInBounds(board, rect)) return '구역이 보드 범위를 벗어났습니다'
    const cells = rectCells(rect, board.width)
    if (!cells.some((i) => !board.cells[i].mine && board.cells[i].state !== 'open'))
      return '이미 공개되었거나 안전 칸이 없는 구역입니다'
    if (cells.some((i) => activeLayersAt(i, contracts, board.width) + 1 > DEFAULT_CONTRACT_PARAMS.nestingCap))
      return `중첩 상한(${DEFAULT_CONTRACT_PARAMS.nestingCap})을 초과합니다`
    return ''
  }

  const sign = (constraintId: string, multiplierBonus: number, extraMines?: number) => {
    if (!pendingRect) return
    const def = CONSTRAINTS.find((c) => c.id === constraintId)
    const error =
      def?.preStartOnly && board.minesPlaced
        ? '판 시작 전에만 체결 가능합니다'
        : constraintId === 'mimic' && mimicRectTooLarge(pendingRect)
          ? `미믹 구역은 최대 ${MIMIC_MAX_RECT}×${MIMIC_MAX_RECT}까지 가능합니다`
          : validateRect(pendingRect)
    if (error) {
      setContractError(error)
      setPendingRect(null)
      return
    }
    signContract({ rect: pendingRect, constraintId, multiplierBonus, extraMines })
    exitContractMode()
  }

  const selection: ContractSelection = {
    contractMode,
    ...zone,
    preview: pendingRect ?? zone.preview,
  }

  return (
    <main className="flex min-h-screen flex-col items-center gap-4 p-4 sm:p-8">
      <h1 className="text-2xl font-bold">지뢰찾기</h1>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {PRESETS.map(({ label, params: p }) => (
          <Button key={label} variant="outline" size="sm" onClick={() => startGame(p)}>
            {label}
          </Button>
        ))}
      </div>
      <CustomForm onStart={startGame} />

      <div className="font-mono text-lg">
        <span aria-hidden>💣</span>{' '}
        <span aria-live="polite" aria-label="남은 지뢰">
          {board.mineCount - flags}
        </span>
      </div>

      <BetForm />
      <Hud />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          variant={contractMode ? 'default' : 'outline'}
          size="sm"
          disabled={finished}
          onClick={() => {
            if (contractMode) exitContractMode()
            else {
              setScanMode(false)
              setContractMode(true)
            }
          }}
        >
          {contractMode ? '계약 모드 종료' : '구역 계약'}
        </Button>
        <Button
          variant={scanMode ? 'default' : 'outline'}
          size="sm"
          disabled={!scanMode && !canScan}
          title={!board.minesPlaced ? '첫 오픈 이후 사용 가능' : undefined}
          onClick={() => {
            if (scanMode) setScanMode(false)
            else {
              exitContractMode()
              setScanMode(true)
            }
          }}
        >
          {scanMode ? '스캔 모드 종료' : `정밀 스캔 (${cost}P)`}
        </Button>
        {scanMode && <span className="text-sm text-gray-500">칸을 클릭하면 {cost}P로 지뢰 여부를 확인합니다</span>}
        {contractMode && !pendingRect && (
          <span className="text-sm text-gray-500">드래그 또는 두 모서리 탭으로 구역 지정</span>
        )}
        {contractMode &&
          pendingRect &&
          CONSTRAINTS.flatMap((c) =>
            c.id === 'density-up'
              ? [1, 2, 3].map((n) => (
                  <Button
                    key={`${c.id}-${n}`}
                    size="sm"
                    variant="secondary"
                    disabled={board.minesPlaced}
                    title={board.minesPlaced ? '판 시작 전에만 체결 가능' : undefined}
                    onClick={() => sign(c.id, n * (c.extraMinesBonus ?? 0.2), n)}
                  >
                    {c.label} +{n} (+{(n * (c.extraMinesBonus ?? 0.2)).toFixed(1)}x)
                  </Button>
                ))
              : [
                  <Button key={c.id} size="sm" variant="secondary" onClick={() => sign(c.id, c.bonus)}>
                    {c.label} +{c.bonus}x
                  </Button>,
                ],
          )}
        {contractMode && pendingRect && (
          <Button size="sm" variant="ghost" onClick={exitContractMode}>
            취소
          </Button>
        )}
        {contractError && <span className="text-sm text-red-600">{contractError}</span>}
      </div>

      <ContractHud />

      <div className="relative">
        <GameBoard selection={selection} scanMode={scanMode} />
        {finished && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-black/60 p-2">
            <p className="text-3xl font-bold text-white">{board.status === 'won' ? '🎉 승리!' : '💥 패배'}</p>
            <DeathSummary />
            <Button onClick={() => startGame(params)}>다시하기 (Enter)</Button>
          </div>
        )}
      </div>
    </main>
  )
}
