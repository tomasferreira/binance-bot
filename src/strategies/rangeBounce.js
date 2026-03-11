import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'range_bounce'
export const name = 'Range Bounce (Long)'
export const description =
  'Mean reversion: long when price touches the lower bound of the recent range and bounces (close > open, near range low), only when price is above EMA 50 (avoid downtrends).'

const RANGE_LOOKBACK = 50
const TREND_EMA = 50
const TOUCH_MARGIN = 0.002 // price within 0.2% of range low
const BOUNCE_CANDLES = 2 // number of candles to confirm bounce

export function evaluate (ohlcv, state) {
  const minLen = Math.max(RANGE_LOOKBACK + BOUNCE_CANDLES + 2, TREND_EMA + 2)
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const i = ohlcv.length - 1
  const closes = ohlcv.map(c => c[4])
  const ema50Arr = calculateEMA(closes, TREND_EMA)
  const ema50 = ema50Arr[i]
  const slice = ohlcv.slice(i - RANGE_LOOKBACK + 1, i + 1)
  const rangeHigh = Math.max(...slice.map(c => c[2]))
  const rangeLow = Math.min(...slice.map(c => c[3]))
  const rangeMid = (rangeHigh + rangeLow) / 2
  const price = ohlcv[i][4]
  const open = ohlcv[i][1]
  const candleBullish = price > open
  const nearRangeLow = rangeLow > 0 && price <= rangeLow * (1 + TOUCH_MARGIN)
  const bouncedFromLow = price >= rangeLow && price < rangeMid
  const aboveEma50 = ema50 != null && price > ema50

  if (state?.openPosition) {
    const nearRangeHigh = price >= rangeHigh * (1 - TOUCH_MARGIN)
    if (nearRangeHigh) {
      logger.info(`[${id}] EXIT signal (target near range high)`)
      return { action: 'exit-long', detail: { price, rangeHigh, rangeLow } }
    }
    return { action: 'hold', detail: { price, rangeHigh, rangeLow } }
  }

  const longSignal = candleBullish && bouncedFromLow && aboveEma50

  logger.info(
    `[${id}] price=${price.toFixed(2)} rangeLow=${rangeLow.toFixed(2)} rangeHigh=${rangeHigh.toFixed(2)} bullish=${candleBullish} bounced=${bouncedFromLow} aboveEma50=${aboveEma50}`
  )

  if (longSignal) {
    logger.info(`[${id}] LONG signal (range bounce above EMA 50)`)
    return { action: 'enter-long', detail: { price, rangeHigh, rangeLow, rangeMid, ema50 } }
  }

  return { action: 'hold', detail: { price, rangeHigh, rangeLow, ema50 } }
}
