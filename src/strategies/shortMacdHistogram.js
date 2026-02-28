import { calculateMACD, calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'short_macd_histogram'
export const name = 'Short MACD Histogram Zero-Line'
export const description =
  'Short when MACD histogram crosses from positive to negative and price is below EMA 200. Exits when histogram crosses back or trend breaks.'

const FAST = 12
const SLOW = 26
const SIGNAL = 9
const EMA_TREND = 200

export function evaluate (ohlcv, state) {
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

  const histogramCrossDown = histPrev > 0 && histNow <= 0
  const priceBelowEma200 = price < ema200

  if (state?.openPosition?.side === 'short') {
    const exitCrossUp = histPrev < 0 && histNow >= 0
    if (exitCrossUp || price > ema200) {
      logger.info(`[${id}] EXIT-SHORT signal`)
      return { action: 'exit-short', detail: { price, histogram: histNow, ema200 } }
    }
    return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
  }

  logger.info(
    `[${id}] price=${price.toFixed(2)} hist=${histNow.toFixed(4)} ema200=${ema200.toFixed(2)} crossDown=${histogramCrossDown} below200=${priceBelowEma200}`
  )

  if (!state?.openPosition && histogramCrossDown && priceBelowEma200) {
    logger.info(`[${id}] SHORT signal`)
    return { action: 'enter-short', detail: { price, histogram: histNow, ema200 } }
  }

  return { action: 'hold', detail: { price, histogram: histNow, ema200 } }
}
