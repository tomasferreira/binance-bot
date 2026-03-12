import { calculateEMA } from '../indicators.js'

export const id = 'short_breakdown'
export const name = 'Short Breakdown (support break)'
export const description =
  'Shorts when price closes below recent support in a downtrend. Exits if price reclaims the level or EMAs turn neutral.'

const FAST = 50
const SLOW = 200
const LOOKBACK = 14 // ~2 weeks on 1h for recent support

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(SLOW, LOOKBACK) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const emaFastArr = calculateEMA(closes, FAST)
  const emaSlowArr = calculateEMA(closes, SLOW)
  const i = closes.length - 1
  const prev = i - 1

  const price = closes[i]
  const prevClose = closes[prev]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if ([price, prevClose, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { price, emaFast, emaSlow } }
  }

  const trendDown = emaFast < emaSlow
  const priorCloses = closes.slice(i - LOOKBACK, i)
  const support = Math.min(...priorCloses)
  const brokeSupport = prevClose >= support && price < support

  const detail = { price, prevClose, support, emaFast, emaSlow, trendDown, brokeSupport }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} support=${support.toFixed(
        2
      )} trendDown=${trendDown} brokeSupport=${brokeSupport}`
    )
  }

  if (state?.openPosition?.side === 'short') {
    const reclaimed = price > support || !trendDown
    if (reclaimed) {
      if (log) log.info(`[${id}] EXIT-SHORT (reclaim or trend broken)`)
      return { action: 'exit-short', detail }
    }
    return { action: 'hold', detail }
  }

  if (!state?.openPosition && trendDown && brokeSupport) {
    if (log) log.info(`[${id}] ENTER-SHORT on breakdown`)
    return { action: 'enter-short', detail }
  }

  return { action: 'hold', detail }
}

