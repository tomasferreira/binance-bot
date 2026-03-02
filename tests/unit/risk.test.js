import { describe, it, expect } from 'vitest'
import { calculatePositionSize } from '../../src/risk.js'

// Simple logger stub is already used inside the module via real logger, we only test return values.

describe('calculatePositionSize', () => {
  it('returns 0 for invalid inputs', () => {
    expect(calculatePositionSize({ balanceQuote: 0, entryPrice: 100, stopLossPrice: 95, riskPerTrade: 0.01 })).toBe(0)
    expect(calculatePositionSize({ balanceQuote: 1000, entryPrice: 0, stopLossPrice: 95, riskPerTrade: 0.01 })).toBe(0)
    expect(calculatePositionSize({ balanceQuote: 1000, entryPrice: 100, stopLossPrice: 0, riskPerTrade: 0.01 })).toBe(0)
    expect(calculatePositionSize({ balanceQuote: 1000, entryPrice: 100, stopLossPrice: 95, riskPerTrade: 0 })).toBe(0)
  })

  it('computes a positive position size and rounds down', () => {
    const size = calculatePositionSize({
      balanceQuote: 1000,
      entryPrice: 100,
      stopLossPrice: 95,
      riskPerTrade: 0.01,
      feeRatePct: 0.001
    })
    expect(size).toBeGreaterThan(0)
    // 6 decimal places max
    const decimals = String(size).split('.')[1] || ''
    expect(decimals.length).toBeLessThanOrEqual(6)
  })
})

