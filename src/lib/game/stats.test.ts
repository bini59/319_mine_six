import { describe, expect, it } from 'vitest'
import { CASHOUT_SAMPLES_CAP, emptyStats, recordCashout, recordSettle, recordSign } from './stats'

describe('stats reducers', () => {
  it('counts wins and losses as rounds', () => {
    let s = recordSettle(emptyStats(), 'won')
    s = recordSettle(s, 'lost')
    expect(s).toMatchObject({ rounds: 2, wins: 1, losses: 1, cashouts: 0 })
  })

  it('counts cashouts as rounds and samples the multiplier', () => {
    const s = recordCashout(emptyStats(), 1.5)
    expect(s).toMatchObject({ rounds: 1, cashouts: 1, cashoutMultipliers: [1.5] })
  })

  it('caps the cashout sample array', () => {
    let s = emptyStats()
    for (let i = 0; i < CASHOUT_SAMPLES_CAP + 10; i++) s = recordCashout(s, i)
    expect(s.cashoutMultipliers).toHaveLength(CASHOUT_SAMPLES_CAP)
    expect(s.cashoutMultipliers[0]).toBe(10)
  })

  it('counts contract signs without touching rounds', () => {
    const s = recordSign(emptyStats())
    expect(s).toMatchObject({ contractsSigned: 1, rounds: 0 })
  })

  it('never mutates its input', () => {
    const before = emptyStats()
    recordSettle(before, 'won')
    recordCashout(before, 2)
    recordSign(before)
    expect(before).toEqual(emptyStats())
  })
})
