import { calculateEMA, calculateBollinger } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'bb_mean_revert'
export const name = 'Bollinger Mean Revert (20,2)'
export const description =
  'Buys dips below Bollinger lower band (20,2) when EMA(50) is not in strong downtrend. Exits near middle band.'

const PERIOD = 20
const K = 2
const TREND_FAST = 50
const TREND_SLOW = 200

export function evaluate (ohlcv, state) {
  const minLen = Math.max(PERIOD, TREND_SLOW) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const { middle, lower } = calculateBollinger(closes, PERIOD, K)
  const emaFastArr = calculateEMA(closes, TREND_FAST)
  const emaSlowArr = calculateEMA(closes, TREND_SLOW)
  const i = closes.length - 1
  const prev = i - 1
  const price = closes[i]
  const pricePrev = closes[prev]
  const mid = middle[i]
  const low = lower[i]
  const lowPrev = lower[prev]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if ([mid, low, lowPrev, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, mid, low, emaFast, emaSlow } }
  }

  const trendNotDown = emaFast >= emaSlow
  const crossedBelowLower = pricePrev >= lowPrev && price < low

  logger.info(
    `[${id}] price=${price.toFixed(2)} mid=${mid.toFixed(2)} low=${low.toFixed(
      2
    )} emaFast=${emaFast.toFixed(2)} emaSlow=${emaSlow.toFixed(
      2
    )} trendNotDown=${trendNotDown} crossedBelowLower=${crossedBelowLower}`
  )

  if (!state?.openPosition && trendNotDown && crossedBelowLower) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, mid, low, emaFast, emaSlow } }
  }

  if (state?.openPosition && price >= mid) {
    logger.info(`[${id}] EXIT signal (reverted to middle band)`)
    return { action: 'exit-long', detail: { price, mid, low, emaFast, emaSlow } }
  }

  return { action: 'hold', detail: { price, mid, low, emaFast, emaSlow } }
}

