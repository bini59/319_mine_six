'use client'

import { Button } from '@/components/ui/button'
import { CONSTRAINTS } from '@/lib/engine/constraints'
import { DEFAULT_CONTRACT_PARAMS, rectCells, type Contract } from '@/lib/engine/contract'
import type { Board } from '@/lib/engine/types'
import { useGameStore } from '@/store/game'

function constraintLabel(id: string): string {
  return CONSTRAINTS.find((c) => c.id === id)?.label ?? id
}

function remainingSafe(board: Board, contract: Contract): number {
  return rectCells(contract.rect, board.width).filter((i) => !board.cells[i].mine && board.cells[i].state !== 'open')
    .length
}

function ContractRow({ contract }: { contract: Contract }) {
  const { board, breakContract } = useGameStore()
  const zone = `(${contract.rect.x},${contract.rect.y}) ${contract.rect.w}×${contract.rect.h}`

  if (contract.status === 'cleared') {
    return (
      // ponytail: inline flash only — the slow-mo/golden-wave 파훼 연출 is M04 (#9)
      <li className="flex items-center gap-2 rounded border border-yellow-500 bg-yellow-100 px-2 py-1 text-sm dark:bg-yellow-900/40">
        <span className="font-bold text-yellow-700 dark:text-yellow-300">파훼!</span>
        <span>{constraintLabel(contract.constraintId)}</span>
        <span className="font-mono">×{(1 + contract.timingMultiplier).toFixed(2)}</span>
        <span className="text-xs text-gray-500">{zone}</span>
      </li>
    )
  }

  if (contract.status === 'broken') {
    return (
      <li className="flex items-center gap-2 rounded border px-2 py-1 text-sm text-gray-400 line-through">
        <span>{constraintLabel(contract.constraintId)}</span>
        <span className="font-mono no-underline">−{Math.round(DEFAULT_CONTRACT_PARAMS.breakPenalty * 100)}%</span>
        <span className="text-xs">{zone}</span>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2 rounded border border-purple-500 px-2 py-1 text-sm">
      <span className="font-medium text-purple-700 dark:text-purple-300">{constraintLabel(contract.constraintId)}</span>
      <span className="font-mono">+{contract.timingMultiplier.toFixed(2)}x</span>
      <span className="text-xs text-gray-500">{zone}</span>
      <span className="text-xs">남은 안전 칸 {remainingSafe(board, contract)}</span>
      <Button size="sm" variant="ghost" className="h-6 px-2 text-red-600" onClick={() => breakContract(contract.id)}>
        파기
      </Button>
    </li>
  )
}

export function ContractHud() {
  const contracts = useGameStore((s) => s.contracts)
  if (contracts.length === 0) return null

  return (
    <ul className="flex w-fit max-w-full flex-col gap-1" aria-label="계약 목록">
      {contracts.map((c) => (
        <ContractRow key={c.id} contract={c} />
      ))}
    </ul>
  )
}
