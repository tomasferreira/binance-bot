import { describe, it, expect } from 'vitest'
import { validateConfig, config } from '../../src/config.js'

describe('config validation', () => {
  it('accepts the current config', () => {
    expect(() => validateConfig(config)).not.toThrow()
  })

  it('fails when required trading fields are missing', () => {
    const bad = { trading: { } }
    expect(() => validateConfig(bad)).toThrow(/symbol is required/)
  })

  it('fails when takeProfitPct <= stopLossPct', () => {
    const bad = {
      trading: {
        symbol: 'BTC/USDT',
        timeframe: '15m',
        pollIntervalMs: 60000,
        riskPerTrade: 0.01,
        stopLossPct: 0.02,
        takeProfitPct: 0.01,
        feeRatePct: 0,
        closedTradesHistoryLimit: 500
      }
    }
    expect(() => validateConfig(bad)).toThrow(/takeProfitPct must be greater/)
  })

  it('fails when closedTradesHistoryLimit is outside allowed range', () => {
    const low = {
      trading: {
        symbol: 'BTC/USDT',
        timeframe: '15m',
        pollIntervalMs: 60000,
        riskPerTrade: 0.01,
        stopLossPct: 0.02,
        takeProfitPct: 0.04,
        feeRatePct: 0,
        closedTradesHistoryLimit: 10
      }
    }
    expect(() => validateConfig(low)).toThrow(/closedTradesHistoryLimit/)
  })
})

