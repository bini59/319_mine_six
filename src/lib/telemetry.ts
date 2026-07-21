// Telemetry schema (PRD 4.7): types only.
// ponytail: transport, batching and dynamic balancing are P2 — nothing here
// sends anything. The schema exists so P2 can plug in without reshaping events.

interface Base {
  ts: number
}

export type TelemetryEvent =
  | (Base & { type: 'round_start'; width: number; height: number; mineCount: number; bet: number })
  | (Base & { type: 'round_end'; outcome: 'won' | 'lost' | 'cashout'; multiplier: number; opens: number })
  | (Base & { type: 'contract_sign'; constraintId: string; zoneCells: number; timingMultiplier: number })
  | (Base & { type: 'contract_clear'; constraintId: string; combo: number })
  | (Base & { type: 'contract_break'; constraintId: string })
  | (Base & { type: 'refill' })
