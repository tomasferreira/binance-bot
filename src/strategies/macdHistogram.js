import { calculateMACD, calculateEMA } from '../indicators.js'

export const id = 'macd_histogram'
export const name = 'MACD Histogram Zero-Line'
export const description =
  'Goes long when MACD histogram crosses from negative to positive and price is above EMA 200; goes short on the opposite. Exits when histogram crosses back or EMA 200 trend breaks.'

const FAST = 12
const SLOW = 26
const SIGNAL = 9
const EMA_TREND = 200

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = SLOW + SIGNAL + EMA_TREND + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const { histogram } = calculateMACD(closes, FAST, SLOW, SIGNAL)
  const emaTrendArr = calculateEMA(closes, EMA_TREND)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = closes[i]
  const histNow = histogram[i]
  const histPrev = histogram[prev]
  const ema200 = emaTrendArr[i]

  if (histNow == null || histPrev == null || ema200 == null) {
    return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
  }

  const crossUp = histPrev < 0 && histNow >= 0
  const crossDown = histPrev > 0 && histNow <= 0
  const above200 = price > ema200
  const below200 = price < ema200

  const dir = context?.regime?.trendDirection || null
  const allowLong = dir === 'bullish'
  const allowShort = dir === 'bearish'

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} hist=${histNow.toFixed(4)} ema200=${ema200.toFixed(
        2
      )} crossUp=${crossUp} crossDown=${crossDown} above200=${above200} below200=${below200} dir=${dir ?? 'n/a'} allowLong=${allowLong} allowShort=${allowShort}`
    )
  }

  // Manage existing position first
  if (state?.openPosition) {
    const side = state.openPosition.side || 'long'
    if (side === 'long') {
      const exitCrossDown = crossDown
      const exitTrendBroken = !above200
      if (exitCrossDown || exitTrendBroken) {
        if (log) log.info(`[${id}] EXIT-LONG signal`)
        return { action: 'exit-long', detail: { price, histogram: histNow, ema200 } }
      }
      return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
    } else if (side === 'short') {
      const exitCrossUp = crossUp
      const exitTrendBroken = above200
      if (exitCrossUp || exitTrendBroken) {
        if (log) log.info(`[${id}] EXIT-SHORT signal`)
        return { action: 'exit-short', detail: { price, histogram: histNow, ema200 } }
      }
      return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
    }
  }

  // No open position: look for new entries (only in direction of regime)
  if (!state?.openPosition && crossUp && above200 && allowLong) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, histogram: histNow, ema200 } }
  }

  if (!state?.openPosition && crossDown && below200 && allowShort) {
    if (log) log.info(`[${id}] SHORT signal`)
    return { action: 'enter-short', detail: { price, histogram: histNow, ema200 } }
  }

  return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
}

