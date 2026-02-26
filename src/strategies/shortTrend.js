import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'short_trend'
export const name = 'Short Trend (EMA 50/200)'
export const description =
  'Goes short when price < EMA50 < EMA200 (bearish stack). Exits when price reclaims EMA50 or EMAs unstack.'

const FAST = 50
const SLOW = 200

export function evaluate (ohlcv, state) {
  const minLen = SLOW + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const emaFastArr = calculateEMA(closes, FAST)
  const emaSlowArr = calculateEMA(closes, SLOW)
  const i = closes.length - 1

  const price = closes[i]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if ([price, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, emaFast, emaSlow } }
  }

  const bearishStack = price < emaFast && emaFast < emaSlow
  const exitCondition = price > emaFast || emaFast >= emaSlow

  logger.info(
    `[${id}] price=${price.toFixed(2)} emaFast=${emaFast.toFixed(
      2
    )} emaSlow=${emaSlow.toFixed(2)} bearishStack=${bearishStack} exit=${exitCondition}`
  )

  if (state?.openPosition?.side === 'short') {
    if (exitCondition) {
      logger.info(`[${id}] EXIT-SHORT signal`)
      return { action: 'exit-short', detail: { price, emaFast, emaSlow } }
    }
    return { action: 'hold', detail: { price, emaFast, emaSlow } }
  }

  if (!state?.openPosition && bearishStack) {
    logger.info(`[${id}] ENTER-SHORT signal`)
    return { action: 'enter-short', detail: { price, emaFast, emaSlow } }
  }

  return { action: 'hold', detail: { price, emaFast, emaSlow } }
}

