import { describe, it, expect, vi, afterEach } from 'vitest'
import * as indicators from '../../src/indicators.js'
import * as emaFastCrossover from '../../src/strategies/emaFastCrossover.js'
import * as macdStrategy from '../../src/strategies/macd.js'
import * as macdHistogramLong from '../../src/strategies/macdHistogramLong.js'
import * as atrTrend from '../../src/strategies/atrTrend.js'
import * as atrBreakout from '../../src/strategies/atrBreakout.js'
import * as bollingerMeanRevert from '../../src/strategies/bollingerMeanRevert.js'
import * as bollingerSqueeze from '../../src/strategies/bollingerSqueeze.js'

function makeFlatOhlcv (len, close = 100) {
  const out = []
  for (let i = 0; i < len; i++) {
    const t = i * 60_000
    out.push([t, close, close + 1, close - 1, close, 100])
  }
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

// ema_fast_crossover

describe('ema_fast_crossover behavior', () => {
  it('enters long when fast EMA crosses above slow and no open position', () => {
    vi.spyOn(indicators, 'getEMACrossSignalPeriods').mockReturnValue({ fast: 9, slow: 8, signal: 'long' })
    const ohlcv = makeFlatOhlcv(30)
    const res = emaFastCrossover.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when already in a position even if fast crossover is long', () => {
    vi.spyOn(indicators, 'getEMACrossSignalPeriods').mockReturnValue({ fast: 9, slow: 8, signal: 'long' })
    const ohlcv = makeFlatOhlcv(30)
    const res = emaFastCrossover.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('hold')
  })
})

// macd

describe('macd behavior', () => {
  it('enters long when MACD crossSignal is long and no open position', () => {
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({
      macd: 1,
      signal: 0.5,
      histogram: 0.5,
      crossSignal: 'long'
    })
    const ohlcv = makeFlatOhlcv(200)
    const res = macdStrategy.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when MACD crossSignal is long but already in a position', () => {
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({
      macd: 1,
      signal: 0.5,
      histogram: 0.5,
      crossSignal: 'long'
    })
    const ohlcv = makeFlatOhlcv(200)
    const res = macdStrategy.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('hold')
  })
})

// macd_histogram_long

describe('macd_histogram_long behavior', () => {
  it('enters long when histogram crosses up from negative and price is above EMA 200', () => {
    const len = 300
    const hist = Array(len).fill(0)
    hist[len - 2] = -0.5
    hist[len - 1] = 0.2
    vi.spyOn(indicators, 'calculateMACD').mockReturnValue({
      macdLine: Array(len).fill(0),
      signalLine: Array(len).fill(0),
      histogram: hist
    })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValueOnce(Array(len).fill(99)) // ema200 below price
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = macdHistogramLong.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when histogram cross up occurs but price is below EMA 200', () => {
    const len = 300
    const hist = Array(len).fill(0)
    hist[len - 2] = -0.5
    hist[len - 1] = 0.2
    vi.spyOn(indicators, 'calculateMACD').mockReturnValue({
      macdLine: Array(len).fill(0),
      signalLine: Array(len).fill(0),
      histogram: hist
    })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValueOnce(Array(len).fill(120)) // ema200 above price
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = macdHistogramLong.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// atr_trend

describe('atr_trend behavior', () => {
  it('enters long when EMA cross is long and ATR relative is above threshold', () => {
    const len = 300
    const ohlcv = makeFlatOhlcv(len, 100)
    vi.spyOn(indicators, 'calculateATR').mockReturnValue(Array(len).fill(2)) // atrRel = 2/100 = 0.02 > 0.004
    vi.spyOn(indicators, 'getEMACrossSignal').mockReturnValue({ fast: 110, slow: 100, signal: 'long' })
    const res = atrTrend.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when ATR is below threshold even if EMA cross is long', () => {
    const len = 300
    const ohlcv = makeFlatOhlcv(len, 100)
    vi.spyOn(indicators, 'calculateATR').mockReturnValue(Array(len).fill(0.1)) // atrRel too small
    vi.spyOn(indicators, 'getEMACrossSignal').mockReturnValue({ fast: 110, slow: 100, signal: 'long' })
    const res = atrTrend.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// atr_breakout

describe('atr_breakout behavior', () => {
  it('enters long when price breaks above recent high and ATR is rising', () => {
    const len = 60
    const ohlcv = []
    for (let i = 0; i < len - 1; i++) {
      const t = i * 60_000
      ohlcv.push([t, 100, 101, 99, 100, 100])
    }
    const tLast = (len - 1) * 60_000
    ohlcv.push([tLast, 102, 105, 101, 104, 100]) // price > previous highs
    const atrArr = Array(len).fill(1)
    atrArr[len - 1] = 2 // atrNow
    atrArr[len - 1 - 5] = 0.5 // atrPast smaller
    vi.spyOn(indicators, 'calculateATR').mockReturnValue(atrArr)
    const res = atrBreakout.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when price breaks above high but ATR is not rising', () => {
    const len = 60
    const ohlcv = []
    for (let i = 0; i < len - 1; i++) {
      const t = i * 60_000
      ohlcv.push([t, 100, 101, 99, 100, 100])
    }
    const tLast = (len - 1) * 60_000
    ohlcv.push([tLast, 102, 105, 101, 104, 100])
    const atrArr = Array(len).fill(1) // flat ATR
    vi.spyOn(indicators, 'calculateATR').mockReturnValue(atrArr)
    const res = atrBreakout.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// bollingerMeanRevert

describe('bollingerMeanRevert behavior', () => {
  it('enters long when price crosses below lower band and trend is not down', () => {
    const len = 250
    const ohlcv = makeFlatOhlcv(len, 100)
    const middle = Array(len).fill(100)
    const lower = Array(len).fill(99)
    const emaFastArr = Array(len).fill(105)
    const emaSlowArr = Array(len).fill(100)
    // previous close above lower, current below
    const prevIdx = len - 2
    const lastIdx = len - 1
    ohlcv[prevIdx][4] = 99.5
    ohlcv[lastIdx][4] = 98.5
    vi.spyOn(indicators, 'calculateBollinger').mockReturnValue({ middle, upper: Array(len).fill(101), lower })
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const res = bollingerMeanRevert.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when price reverts to middle band', () => {
    const len = 250
    const ohlcv = makeFlatOhlcv(len, 100)
    const middle = Array(len).fill(100)
    const lower = Array(len).fill(99)
    const emaFastArr = Array(len).fill(105)
    const emaSlowArr = Array(len).fill(100)
    const lastIdx = len - 1
    ohlcv[lastIdx][4] = 100.5 // above mid
    vi.spyOn(indicators, 'calculateBollinger').mockReturnValue({ middle, upper: Array(len).fill(101), lower })
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const res = bollingerMeanRevert.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// bollingerSqueeze

describe('bollingerSqueeze behavior', () => {
  it('enters long on squeeze breakout above upper band', () => {
    const len = 100
    const ohlcv = makeFlatOhlcv(len, 100)
    const upper = Array(len).fill(101)
    const lower = Array(len).fill(99)
    const lastIdx = len - 1
    const prevIdx = len - 2
    // previous price at/below upper, current above upper
    ohlcv[prevIdx][4] = 100.5
    ohlcv[lastIdx][4] = 101.5
    vi.spyOn(indicators, 'calculateBollinger').mockReturnValue({ middle: Array(len).fill(100), upper, lower })
    const res = bollingerSqueeze.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when squeeze condition is false even if price breaks above upper band', () => {
    const len = 100
    const ohlcv = makeFlatOhlcv(len, 100)
    const upper = Array(len).fill(101)
    const lower = Array(len).fill(99)
    // Make the last width much larger than historical widths so squeeze=false
    upper[len - 1] = 120
    lower[len - 1] = 80
    const lastIdx = len - 1
    const prevIdx = len - 2
    ohlcv[prevIdx][4] = 100.5
    ohlcv[lastIdx][4] = 101.5
    vi.spyOn(indicators, 'calculateBollinger').mockReturnValue({ middle: Array(len).fill(100), upper, lower })
    const res = bollingerSqueeze.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})
