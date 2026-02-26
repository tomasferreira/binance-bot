import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'multi_tf_trend'
export const name = 'Multi-TF Trend (approx)'
export const description =
  '1m trend follower that only enters when both short-term (EMA20>EMA50) and slower (EMA100>EMA200) trends are up, on price crossing above EMA20.'

const SHORT_FAST = 20
const SHORT_SLOW = 50
const LONG_FAST = 100
const LONG_SLOW = 200

export function evaluate (ohlcv, state) {
  const minLen = Math.max(LONG_SLOW, SHORT_SLOW) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const ema20Arr = calculateEMA(closes, SHORT_FAST)
  const ema50Arr = calculateEMA(closes, SHORT_SLOW)
  const ema100Arr = calculateEMA(closes, LONG_FAST)
  const ema200Arr = calculateEMA(closes, LONG_SLOW)

  const i = closes.length - 1
  const prev = i - 1
  const price = closes[i]
  const pricePrev = closes[prev]
  const ema20 = ema20Arr[i]
  const ema20Prev = ema20Arr[prev]
  const ema50 = ema50Arr[i]
  const ema100 = ema100Arr[i]
  const ema200 = ema200Arr[i]

  if ([ema20, ema20Prev, ema50, ema100, ema200].some(v => v == null)) {
    return { action: 'hold', detail: { price, ema20, ema50, ema100, ema200 } }
  }

  const shortUp = ema20 > ema50
  const longUp = ema100 > ema200
  const crossUp = pricePrev <= ema20Prev && price > ema20

  logger.info(
    `[${id}] price=${price.toFixed(2)} EMA20=${ema20.toFixed(2)} EMA50=${ema50.toFixed(
      2
    )} EMA100=${ema100.toFixed(2)} EMA200=${ema200.toFixed(2)} shortUp=${shortUp} longUp=${longUp} crossUp=${crossUp}`
  )

  if (!state?.openPosition && shortUp && longUp && crossUp) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, ema20, ema50, ema100, ema200 } }
  }

  if (state?.openPosition) {
    const crossDown = pricePrev >= ema20Prev && price < ema20
    const shortTrendBroken = ema20 <= ema50
    if (crossDown || shortTrendBroken) {
      logger.info(`[${id}] EXIT signal (short-term trend broken)`)
      return { action: 'exit-long', detail: { price, ema20, ema50, ema100, ema200 } }
    }
  }

  return { action: 'hold', detail: { price, ema20, ema50, ema100, ema200 } }
}

