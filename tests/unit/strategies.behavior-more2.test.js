import { describe, it, expect, vi, afterEach } from 'vitest'
import * as indicators from '../../src/indicators.js'
import * as multiEma from '../../src/strategies/multiEma.js'
import * as priceVsEma from '../../src/strategies/priceVsEma.js'
import * as rsiPullback from '../../src/strategies/rsiPullback.js'
import * as volumeEmaCrossover from '../../src/strategies/volumeEmaCrossover.js'
import * as rsiMacdCombo from '../../src/strategies/rsiMacdCombo.js'
import * as donchianBreakout from '../../src/strategies/donchianBreakout.js'
import * as stochasticOversold from '../../src/strategies/stochasticOversold.js'
import * as multiTfTrend from '../../src/strategies/multiTfTrend.js'
import * as shortTrend from '../../src/strategies/shortTrend.js'
import * as shortBreakdown from '../../src/strategies/shortBreakdown.js'
import * as shortOverbought from '../../src/strategies/shortOverbought.js'
import * as shortMacd from '../../src/strategies/shortMacd.js'

function makeFlatOhlcv (len, close = 100, volume = 100) {
  const out = []
  for (let i = 0; i < len; i++) {
    const t = i * 60_000
    out.push([t, close, close + 1, close - 1, close, volume])
  }
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

// multiEma

describe('multiEma behavior', () => {
  it('enters long when price > EMA9 > EMA21 > EMA50 and no open position', () => {
    const len = 60
    const closes = Array(len).fill(100)
    const ema9 = Array(len).fill(99)
    const ema21 = Array(len).fill(98)
    const ema50 = Array(len).fill(97)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema9)
      .mockReturnValueOnce(ema21)
      .mockReturnValueOnce(ema50)
    const ohlcv = makeFlatOhlcv(len, 101) // price > ema9
    const res = multiEma.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when EMA9 crosses below EMA21', () => {
    const len = 60
    const ema9 = Array(len).fill(99)
    const ema21 = Array(len).fill(98)
    const ema50 = Array(len).fill(97)
    const prev = len - 2
    const last = len - 1
    ema9[prev] = 100
    ema21[prev] = 99
    ema9[last] = 95 // cross below
    ema21[last] = 96
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema9)
      .mockReturnValueOnce(ema21)
      .mockReturnValueOnce(ema50)
    const ohlcv = makeFlatOhlcv(len, 101)
    const res = multiEma.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// priceVsEma

describe('priceVsEma behavior', () => {
  it('enters long when price pulled back to/near EMA20 then closed above, with EMA20 > EMA50 and EMA50 > EMA200', () => {
    const len = 220
    const ema20Arr = Array(len).fill(99)
    const ema50Arr = Array(len).fill(98)
    const ema200Arr = Array(len).fill(97)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema20Arr)
      .mockReturnValueOnce(ema50Arr)
      .mockReturnValueOnce(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 105) // last bar close 105 (above ema20)
    ohlcv[len - 6][4] = 98 // one bar in last 10 had close at/near EMA20 (98 <= 99*1.002) = pullback
    const res = priceVsEma.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when price drops below EMA20', () => {
    const len = 220
    const ema20Arr = Array(len).fill(100)
    const ema50Arr = Array(len).fill(90)
    const ema200Arr = Array(len).fill(85)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema20Arr)
      .mockReturnValueOnce(ema50Arr)
      .mockReturnValueOnce(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 95) // price below ema20
    const res = priceVsEma.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// rsiPullback

describe('rsiPullback behavior', () => {
  it('enters long on RSI cross up from oversold in uptrend', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const rsiArr = Array(len).fill(50)
    const emaFastArr = Array(len).fill(110)
    const emaSlowArr = Array(len).fill(100)
    const prev = len - 2
    const last = len - 1
    rsiArr[prev] = 25
    rsiArr[last] = 35
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = rsiPullback.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when RSI is high or trend breaks', () => {
    const len = 250
    const rsiArr = Array(len).fill(65)
    const emaFastArr = Array(len).fill(110)
    const emaSlowArr = Array(len).fill(100)
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = rsiPullback.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// volumeEmaCrossover

describe('volumeEmaCrossover behavior', () => {
  it('enters long when EMA cross is long and volume above threshold', () => {
    const len = 220
    const ohlcv = makeFlatOhlcv(len, 100, 300)
    vi.spyOn(indicators, 'getEMACrossSignal').mockReturnValue({ fast: 110, slow: 100, signal: 'long' })
    vi.spyOn(indicators, 'averageVolume').mockReturnValue(100)
    const res = volumeEmaCrossover.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when volume is below threshold even if EMA cross is long', () => {
    const len = 220
    const ohlcv = makeFlatOhlcv(len, 100, 100)
    vi.spyOn(indicators, 'getEMACrossSignal').mockReturnValue({ fast: 110, slow: 100, signal: 'long' })
    vi.spyOn(indicators, 'averageVolume').mockReturnValue(100)
    const res = volumeEmaCrossover.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// rsiMacdCombo

describe('rsiMacdCombo behavior', () => {
  it('enters long when MACD cross is long and RSI is in zone', () => {
    const len = 200
    const closes = Array(len).fill(100)
    const rsiArr = Array(len).fill(50)
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({ crossSignal: 'long' })
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = rsiMacdCombo.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when RSI is out of zone even if MACD cross is long', () => {
    const len = 200
    const rsiArr = Array(len).fill(80)
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({ crossSignal: 'long' })
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = rsiMacdCombo.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// donchianBreakout

describe('donchianBreakout behavior', () => {
  it('enters long when price breaks above Donchian upper and is above EMA50', () => {
    const len = 100
    const ohlcv = makeFlatOhlcv(len, 100)
    const upper = Array(len).fill(101)
    const lower = Array(len).fill(99)
    const emaArr = Array(len).fill(95)
    const prev = len - 2
    const last = len - 1
    ohlcv[prev][4] = 100.5
    ohlcv[last][4] = 102 // > upperPrev
    emaArr[last] = 100
    vi.spyOn(indicators, 'calculateDonchian').mockReturnValue({ upper, lower })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValue(emaArr)
    const res = donchianBreakout.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('holds when price breaks above Donchian upper but is below EMA50', () => {
    const len = 100
    const ohlcv = makeFlatOhlcv(len, 100)
    const upper = Array(len).fill(101)
    const lower = Array(len).fill(99)
    const emaArr = Array(len).fill(200)
    const prev = len - 2
    const last = len - 1
    ohlcv[prev][4] = 100.5
    ohlcv[last][4] = 102
    vi.spyOn(indicators, 'calculateDonchian').mockReturnValue({ upper, lower })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValue(emaArr)
    const res = donchianBreakout.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('hold')
  })
})

// stochasticOversold

describe('stochasticOversold behavior', () => {
  it('enters long when %K crosses up from oversold', () => {
    const len = 40
    const k = Array(len).fill(50)
    const d = Array(len).fill(50)
    const prev = len - 2
    const last = len - 1
    k[prev] = 10
    d[prev] = 15
    k[last] = 25
    d[last] = 20
    vi.spyOn(indicators, 'calculateStochastic').mockReturnValue({ k, d })
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = stochasticOversold.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when %K crosses below %D while in position', () => {
    const len = 40
    const k = Array(len).fill(50)
    const d = Array(len).fill(50)
    const prev = len - 2
    const last = len - 1
    k[prev] = 60
    d[prev] = 55
    k[last] = 40
    d[last] = 45
    vi.spyOn(indicators, 'calculateStochastic').mockReturnValue({ k, d })
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = stochasticOversold.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// multiTfTrend

describe('multiTfTrend behavior', () => {
  it('enters long when short and long trends up and price crosses above EMA20', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const ema20Arr = Array(len).fill(100)
    const ema50Arr = Array(len).fill(90)
    const ema100Arr = Array(len).fill(95)
    const ema200Arr = Array(len).fill(90)
    const prev = len - 2
    const last = len - 1
    ema20Arr[prev] = 100
    closes[prev] = 99
    ema20Arr[last] = 100
    closes[last] = 101
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema20Arr)
      .mockReturnValueOnce(ema50Arr)
      .mockReturnValueOnce(ema100Arr)
      .mockReturnValueOnce(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 100)
    // overwrite closes in ohlcv
    ohlcv[prev][4] = closes[prev]
    ohlcv[last][4] = closes[last]
    const res = multiTfTrend.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when price crosses below EMA20 or short trend breaks', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const ema20Arr = Array(len).fill(100)
    const ema50Arr = Array(len).fill(90)
    const ema100Arr = Array(len).fill(95)
    const ema200Arr = Array(len).fill(90)
    const prev = len - 2
    const last = len - 1
    ema20Arr[prev] = 100
    closes[prev] = 101
    ema20Arr[last] = 100
    closes[last] = 99 // cross below
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(ema20Arr)
      .mockReturnValueOnce(ema50Arr)
      .mockReturnValueOnce(ema100Arr)
      .mockReturnValueOnce(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 100)
    ohlcv[prev][4] = closes[prev]
    ohlcv[last][4] = closes[last]
    const res = multiTfTrend.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(res.action).toBe('exit-long')
  })
})

// shortTrend

describe('shortTrend behavior', () => {
  it('enters short when bearish stack holds and no open position', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 80) // price below emaFast to satisfy bearishStack
    const res = shortTrend.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-short')
  })

  it('exits short when price reclaims EMA50 or EMAs unstack', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    const last = len - 1
    emaFastArr[last] = 110
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 120)
    const res = shortTrend.evaluate(ohlcv, { openPosition: { side: 'short' } })
    expect(res.action).toBe('exit-short')
  })
})

// shortBreakdown

describe('shortBreakdown behavior', () => {
  it('enters short on breakdown below support in downtrend', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    const prev = len - 2
    const last = len - 1
    const priorSegment = closes.slice(len - 25, len - 1)
    const support = 95
    for (let i = len - 25; i < len - 1; i++) {
      closes[i] = support + 1
    }
    closes[prev] = support + 1
    closes[last] = support - 1
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    for (let i = 0; i < len; i++) ohlcv[i][4] = closes[i]
    const res = shortBreakdown.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-short')
  })

  it('exits short when price reclaims support or trend breaks', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(110)
    const emaSlowArr = Array(len).fill(100)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 120)
    const res = shortBreakdown.evaluate(ohlcv, { openPosition: { side: 'short' } })
    expect(res.action).toBe('exit-short')
  })
})

// shortOverbought

describe('shortOverbought behavior', () => {
  it('enters short on RSI overbought bounce in downtrend', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const rsiArr = Array(len).fill(50)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    const prev = len - 2
    const last = len - 1
    rsiArr[prev] = 65
    rsiArr[last] = 75
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = shortOverbought.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-short')
  })

  it('exits short when RSI normalizes or trend breaks', () => {
    const len = 250
    const closes = Array(len).fill(100)
    const rsiArr = Array(len).fill(40)
    const emaFastArr = Array(len).fill(110)
    const emaSlowArr = Array(len).fill(100)
    vi.spyOn(indicators, 'calculateRSI').mockReturnValue(rsiArr)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = shortOverbought.evaluate(ohlcv, { openPosition: { side: 'short' } })
    expect(res.action).toBe('exit-short')
  })
})

// shortMacd

describe('shortMacd behavior', () => {
  it('enters short on bearish MACD cross in bearish regime', () => {
    const len = 200
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({
      macd: -0.5,
      signal: 0,
      histogram: -0.5,
      crossSignal: 'short'
    })
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = shortMacd.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-short')
  })

  it('exits short when MACD turns up or bullish cross', () => {
    const len = 200
    const closes = Array(len).fill(100)
    const emaFastArr = Array(len).fill(90)
    const emaSlowArr = Array(len).fill(110)
    vi.spyOn(indicators, 'calculateEMA')
      .mockReturnValueOnce(emaFastArr)
      .mockReturnValueOnce(emaSlowArr)
    vi.spyOn(indicators, 'getMACDCrossSignal').mockReturnValue({
      macd: 0.1,
      signal: 0,
      histogram: 0.1,
      crossSignal: 'long'
    })
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = shortMacd.evaluate(ohlcv, { openPosition: { side: 'short' } })
    expect(res.action).toBe('exit-short')
  })
})

// shortMacdHistogram

describe('shortMacdHistogram behavior', () => {
  it('enters short when histogram crosses down and price is below EMA200', () => {
    const len = 300
    const closes = Array(len).fill(100)
    const hist = Array(len).fill(0)
    hist[len - 2] = 0.5
    hist[len - 1] = -0.2
    const ema200Arr = Array(len).fill(120)
    ema200Arr[len - 1] = 110
    vi.spyOn(indicators, 'calculateMACD').mockReturnValue({
      macdLine: Array(len).fill(0),
      signalLine: Array(len).fill(0),
      histogram: hist
    })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValue(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 100)
    const res = shortMacdHistogram.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-short')
  })

  it('exits short when histogram crosses back up or price rises above EMA200', () => {
    const len = 300
    const closes = Array(len).fill(100)
    const hist = Array(len).fill(0)
    hist[len - 2] = -0.5
    hist[len - 1] = 0.2
    const ema200Arr = Array(len).fill(100)
    vi.spyOn(indicators, 'calculateMACD').mockReturnValue({
      macdLine: Array(len).fill(0),
      signalLine: Array(len).fill(0),
      histogram: hist
    })
    vi.spyOn(indicators, 'calculateEMA').mockReturnValue(ema200Arr)
    const ohlcv = makeFlatOhlcv(len, 120)
    const res = shortMacdHistogram.evaluate(ohlcv, { openPosition: { side: 'short' } })
    expect(res.action).toBe('exit-short')
  })
})

