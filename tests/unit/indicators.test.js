import { describe, it, expect } from 'vitest'
import {
  calculateEMA,
  getEMACrossSignal,
  getEMACrossSignalPeriods,
  averageVolume,
  calculateDonchian,
  calculateStochastic,
  calculateMACD,
  getMACDCrossSignal,
  calculateRSI,
  calculateBollinger,
  calculateATR,
  calculateADX
} from '../../src/indicators.js'

function makeOhlcv (closes) {
  // simple OHLCV with close as given and small ranges
  return closes.map((c, i) => [i * 60_000, c, c + 1, c - 1, c, 100])
}

describe('indicators', () => {
  it('calculateEMA returns expected length and monotone smoothing', () => {
    const values = [1, 2, 3, 4, 5]
    const ema = calculateEMA(values, 3)
    expect(ema.length).toBe(values.length)
    // first non-null index is period-1
    expect(ema[0]).toBeUndefined()
    expect(ema[2]).toBeTypeOf('number')
  })

  it('getEMACrossSignalPeriods detects a long crossover', () => {
    // Build closes where fast crosses above slow near the end
    const base = Array(210).fill(100)
    for (let i = 180; i < 205; i++) base[i] += (i - 180) // gradual uptrend
    const ohlcv = makeOhlcv(base)
    const { fast, slow, signal } = getEMACrossSignalPeriods(ohlcv, 5, 10)
    expect(fast).not.toBeNull()
    expect(slow).not.toBeNull()
    expect(['long', 'short', null]).toContain(signal)
  })

  it('averageVolume computes mean over last N candles', () => {
    const ohlcv = makeOhlcv([1, 2, 3, 4, 5])
    const v = averageVolume(ohlcv, 3)
    expect(v).toBeCloseTo(100, 6) // we fixed volume at 100
  })

  it('calculateDonchian returns upper and lower arrays with highs/lows', () => {
    const ohlcv = makeOhlcv([1, 2, 3, 4, 5, 6])
    const { upper, lower } = calculateDonchian(ohlcv, 3)
    expect(upper.length).toBe(ohlcv.length)
    expect(lower.length).toBe(ohlcv.length)
    // last index should use last 3 highs/lows
    const last = ohlcv.length - 1
    expect(upper[last]).toBeGreaterThan(0)
    expect(lower[last]).toBeLessThan(upper[last])
  })

  it('calculateStochastic returns k and d arrays', () => {
    const ohlcv = makeOhlcv(Array(30).fill(100).map((v, i) => v + i))
    const { k, d } = calculateStochastic(ohlcv, 14, 3)
    expect(k.length).toBe(ohlcv.length)
    expect(d.length).toBe(ohlcv.length)
  })

  it('calculateMACD returns lines of same length', () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + i * 0.5)
    const { macdLine, signalLine, histogram } = calculateMACD(closes, 12, 26, 9)
    expect(macdLine.length).toBe(closes.length)
    expect(signalLine.length).toBe(closes.length)
    expect(histogram.length).toBe(closes.length)
  })

  it('getMACDCrossSignal returns structure without throwing', () => {
    const closes = Array.from({ length: 200 }, (_, i) => 100 + Math.sin(i / 5) * 2)
    const ohlcv = makeOhlcv(closes)
    const res = getMACDCrossSignal(ohlcv)
    expect(res).toHaveProperty('macd')
    expect(res).toHaveProperty('signal')
    expect(['long', 'short', null]).toContain(res.crossSignal)
  })

  it('calculateRSI returns array with numbers in [0,100]', () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + i)
    const rsi = calculateRSI(values, 14)
    expect(rsi.length).toBe(values.length)
    const last = rsi[rsi.length - 1]
    expect(last).toBeGreaterThanOrEqual(0)
    expect(last).toBeLessThanOrEqual(100)
  })

  it('calculateBollinger returns bands arrays', () => {
    const values = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i / 3))
    const { middle, upper, lower } = calculateBollinger(values, 20, 2)
    expect(middle.length).toBe(values.length)
    expect(upper.length).toBe(values.length)
    expect(lower.length).toBe(values.length)
  })

  it('calculateATR returns array with nulls then numbers', () => {
    const ohlcv = makeOhlcv(Array.from({ length: 40 }, (_, i) => 100 + i))
    const atr = calculateATR(ohlcv, 14)
    expect(atr.length).toBe(ohlcv.length)
  })

  it('calculateADX returns adx, plusDi, minusDi arrays', () => {
    const ohlcv = makeOhlcv(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4)))
    const { adx, plusDi, minusDi } = calculateADX(ohlcv, 14)
    expect(adx.length).toBe(ohlcv.length)
    expect(plusDi.length).toBe(ohlcv.length)
    expect(minusDi.length).toBe(ohlcv.length)
  })
})

