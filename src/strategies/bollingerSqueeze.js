import { calculateBollinger, calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'bb_squeeze'
export const name = 'Bollinger Squeeze Breakout (Long)'
export const description =
  'Long when BB width has been low (squeeze) and price breaks above the upper band. Exits via SL/TP.'

const PERIOD = 20
const K = 2
const WIDTH_LOOKBACK = 50
const WIDTH_PERCENTILE = 80 // squeeze = width in bottom 20% of recent

export function evaluate (ohlcv, state) {
  const minLen = Math.max(PERIOD, WIDTH_LOOKBACK) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const { upper, lower } = calculateBollinger(closes, PERIOD, K)
  const i = closes.length - 1
  const prev = i - 1
  const price = closes[i]
  const pricePrev = closes[prev]
  const upperNow = upper[i]
  const lowerNow = lower[i]

  if (upperNow == null || lowerNow == null) {
    return { action: 'hold', detail: { price, upper: upperNow, lower: lowerNow } }
  }

  const width = upperNow - lowerNow
  const widths = []
  for (let j = Math.max(0, i - WIDTH_LOOKBACK); j <= i; j++) {
    if (upper[j] != null && lower[j] != null) {
      widths.push(upper[j] - lower[j])
    }
  }
  widths.sort((a, b) => a - b)
  const threshold = widths[Math.floor(widths.length * (WIDTH_PERCENTILE / 100))] ?? width
  const squeeze = width <= threshold
  const breakAboveUpper = pricePrev <= upper[prev] && price > upperNow

  logger.info(
    `[${id}] price=${price.toFixed(2)} upper=${upperNow.toFixed(2)} width=${width.toFixed(2)} squeeze=${squeeze} breakAbove=${breakAboveUpper}`
  )

  if (!state?.openPosition && squeeze && breakAboveUpper) {
    logger.info(`[${id}] LONG signal (squeeze breakout)`)
    return { action: 'enter-long', detail: { price, upper: upperNow, lower: lowerNow, width } }
  }

  return { action: 'hold', detail: { price, upper: upperNow, lower: lowerNow, width } }
}
