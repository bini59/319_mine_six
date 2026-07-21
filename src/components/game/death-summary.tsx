'use client'

import { summarizeDeath, type RoundEvent } from '@/lib/game/death-summary'
import { useGameStore } from '@/store/game'

const EVENT_LABEL: Record<RoundEvent['type'], string> = {
  bet: '베팅',
  open: '오픈',
  flag: '깃발',
  chord: '코드 오픈',
  sign: '계약 체결',
  break: '계약 파기',
  cashout: '캐시아웃',
}

function choiceLine(e: RoundEvent): string {
  const at = e.x !== undefined ? ` (${e.x},${e.y})` : ''
  const mult = e.multiplier !== undefined ? ` ×${e.multiplier.toFixed(2)}` : ''
  return `${EVENT_LABEL[e.type]}${at}${mult}`
}

// Death replay summary (PRD 5): which choices led here. Rendered only on loss.
export function DeathSummary() {
  const { board, history, contracts } = useGameStore()
  if (board.status !== 'lost') return null

  const s = summarizeDeath(board, history, contracts)
  return (
    <div
      aria-live="polite"
      className="max-w-xs rounded-lg bg-white/95 p-4 text-left text-sm text-gray-900 shadow dark:bg-gray-800/95 dark:text-gray-100"
    >
      <p className="font-bold">
        {s.killedAt ? `(${s.killedAt.x},${s.killedAt.y})에서 사망` : '지뢰를 밟았습니다'}
        {s.killedInContractZone && ` — ${s.killedInContractZone.label} 계약 구역`}
      </p>
      <p className="mt-1 text-gray-600 dark:text-gray-300">
        안전 칸 {s.totalOpens}개 오픈 · 최고 배율 ×{s.peakMultiplier.toFixed(2)} (청산 0)
      </p>
      {s.signedContracts.length > 0 && (
        <p className="mt-1 text-gray-600 dark:text-gray-300">
          체결한 계약: {s.signedContracts.map((c) => c.label).join(', ')}
        </p>
      )}
      {s.recentChoices.length > 0 && (
        <ol className="mt-2 list-inside list-decimal text-gray-500 dark:text-gray-400">
          {s.recentChoices.map((e, i) => (
            <li key={i}>{choiceLine(e)}</li>
          ))}
        </ol>
      )}
    </div>
  )
}
