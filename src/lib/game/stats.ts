// Persisted play statistics (PRD 4.7 / issue #11). Pure reducers — the store
// wires them into settle/cashout/sign and persists via partialize.

export interface Stats {
  rounds: number
  wins: number
  losses: number
  cashouts: number
  contractsSigned: number
  // ponytail: capped recent samples instead of a bucketed histogram —
  // promote to buckets when a real distribution chart exists.
  cashoutMultipliers: number[]
}

export const CASHOUT_SAMPLES_CAP = 100

export function emptyStats(): Stats {
  return { rounds: 0, wins: 0, losses: 0, cashouts: 0, contractsSigned: 0, cashoutMultipliers: [] }
}

export function recordSettle(stats: Stats, outcome: 'won' | 'lost'): Stats {
  return {
    ...stats,
    rounds: stats.rounds + 1,
    wins: stats.wins + (outcome === 'won' ? 1 : 0),
    losses: stats.losses + (outcome === 'lost' ? 1 : 0),
  }
}

// A cashout ends the round for the bettor (input freezes), so it counts as a round.
export function recordCashout(stats: Stats, multiplier: number): Stats {
  return {
    ...stats,
    rounds: stats.rounds + 1,
    cashouts: stats.cashouts + 1,
    cashoutMultipliers: [...stats.cashoutMultipliers, multiplier].slice(-CASHOUT_SAMPLES_CAP),
  }
}

export function recordSign(stats: Stats): Stats {
  return { ...stats, contractsSigned: stats.contractsSigned + 1 }
}
