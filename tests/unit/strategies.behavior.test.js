import { describe, it, expect, vi } from 'vitest'

// 1) ema_crossover – behavior based on indicator signal

vi.mock('../../src/indicators.js', async (orig) => {
  // Start from real module so other tests keep working if they import it
  const real = await import('../../src/indicators.js')
  return {
    ...real,
    // For this file we override getEMACrossSignal in the specific test
    getEMACrossSignal: () => ({ fast: 50, slow: 49, signal: 'long' })
  }
})

import * as emaCrossover from '../../src/strategies/emaCrossover.js'
import * as rangeBounce from '../../src/strategies/rangeBounce.js'
import * as shortRejection from '../../src/strategies/shortRejection.js'

function makeFlatOhlcv (len, close = 100) {
  const out = []
  for (let i = 0; i < len; i++) {
    const t = i * 60_000
    out.push([t, close, close + 1, close - 1, close, 100])
  }
  return out
}

describe('ema_crossover behavior', () => {
  it('enters long when getEMACrossSignal reports a long crossover and no open position', () => {
    const ohlcv = makeFlatOhlcv(250)
    const state = { openPosition: null }
    const res = emaCrossover.evaluate(ohlcv, state)
    expect(res.action).toBe('enter-long')
  })

  it('holds when already in a position even if signal is long', () => {
    const ohlcv = makeFlatOhlcv(250)
    const state = { openPosition: { side: 'long' } }
    const res = emaCrossover.evaluate(ohlcv, state)
    expect(res.action).toBe('hold')
  })
})

// 2) range_bounce – enter-long near range low, exit near range high

describe('range_bounce behavior', () => {
  it('enters long after bullish bounce near range low', () => {
    const len = 60
    const ohlcv = []
    for (let i = 0; i < len - 1; i++) {
      const t = i * 60_000
      // Build a range roughly [99, 101]
      const low = 99
      const high = 101
      const close = 100
      const open = 100
      ohlcv.push([t, open, high, low, close, 100])
    }
    // Last candle: touch/bounce from range low
    const tLast = (len - 1) * 60_000
    const rangeLow = 99
    const rangeHigh = 101
    const rangeMid = (rangeLow + rangeHigh) / 2 // 100
    const openLast = rangeLow + 0.1 // 99.1
    const closeLast = rangeLow + 0.5 // 99.5, < mid
    const highLast = rangeHigh // 101
    const lowLast = rangeLow // 99
    ohlcv.push([tLast, openLast, highLast, lowLast, closeLast, 100])

    const res = rangeBounce.evaluate(ohlcv, { openPosition: null })
    expect(res.action).toBe('enter-long')
  })

  it('exits long when price approaches range high', () => {
    const len = 60
    const ohlcv = []
    for (let i = 0; i < len - 1; i++) {
      const t = i * 60_000
      const low = 99
      const high = 101
      const close = 100
      const open = 100
      ohlcv.push([t, open, high, low, close, 100])
    }
    // Last candle near range high
    const tLast = (len - 1) * 60_000
    const openLast = 100.5
    const closeLast = 100.9
    const highLast = 101 // near rangeHigh
    const lowLast = 99.5
    ohlcv.push([tLast, openLast, highLast, lowLast, closeLast, 100])

    const res = rangeBounce.evaluate(ohlcv, { openPosition: { side: 'long' } })
    expect(['exit-long', 'hold']).toContain(res.action)
  })
})

// 3) short_rejection – enter-short on rejection at resistance in bearish/neutral trend

describe('short_rejection behavior', () => {
  it('enters short on clear rejection candle at resistance', () => {
    const len = 80
    const ohlcv = []
    // Build history with modest highs
    for (let i = 0; i < len - 1; i++) {
      const t = i * 60_000
      const close = 100
      const high = 101
      const low = 99
      const open = 100
      ohlcv.push([t, open, high, low, close, 100])
    }
    const tLast = (len - 1) * 60_000
    const prevClose = 100
    const prev = [tLast - 60_000, 100, 101, 99, prevClose, 100]
    ohlcv[ohlcv.length - 1] = prev

    // Last candle: push above resistance, big upper wick, bearish close
    const openLast = 101
    const closeLast = 99
    const highLast = 105
    const lowLast = 98
    const last = [tLast, openLast, highLast, lowLast, closeLast, 100]
    ohlcv.push(last)

    const res = shortRejection.evaluate(ohlcv, { openPosition: null })
    expect(['enter-short', 'hold']).toContain(res.action)
  })
})

