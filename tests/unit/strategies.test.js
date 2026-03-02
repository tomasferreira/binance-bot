import { describe, it, expect } from 'vitest'
import { STRATEGY_IDS, getStrategy } from '../../src/strategies/registry.js'

function makeFlatOhlcv (len) {
  const res = []
  for (let i = 0; i < len; i++) {
    const t = i * 60_000
    const close = 100
    res.push([t, close, close + 1, close - 1, close, 100])
  }
  return res
}

describe('strategies evaluate on basic input', () => {
  it('all strategies export an evaluate function', () => {
    for (const id of STRATEGY_IDS) {
      const strat = getStrategy(id)
      expect(strat, `strategy ${id} missing`).toBeTruthy()
      expect(typeof strat.evaluate, `strategy ${id} has no evaluate`).toBe('function')
    }
  })

  it('all strategies can evaluate a simple OHLCV series without throwing', () => {
    const ohlcv = makeFlatOhlcv(300)
    const state = { openPosition: null }
    for (const id of STRATEGY_IDS) {
      const strat = getStrategy(id)
      const res = strat.evaluate(ohlcv, state)
      expect(res).toBeTruthy()
      expect(typeof res.action).toBe('string')
    }
  })
})

