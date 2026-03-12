import { calculateEMA, calculateATR } from '../indicators.js'

export const id = 'short_breakdown'
export const name = 'Short Breakdown (support break)'
export const description =
  'Shorts when price closes below recent support in a downtrend. Exits if price reclaims the level or EMAs turn neutral.'

const FAST = 50
const SLOW = 200
const LOOKBACK = 14 // ~2 weeks on 1h for recent support
const SL_ATR_MULT = 2
const TP_ATR_MULT = 3

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
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]

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
    const fixedSupport = state.openPosition.entryDetail?.supportAtEntry ?? support
    const reclaimed = price > fixedSupport || !trendDown
    if (reclaimed) {
      if (log) log.info(`[${id}] EXIT-SHORT (reclaim fixed support ${fixedSupport.toFixed(2)} or trend broken)`)
      return { action: 'exit-short', detail: { ...detail, fixedSupport } }
    }
    return { action: 'hold', detail: { ...detail, fixedSupport } }
  }

  if (!state?.openPosition && trendDown && brokeSupport) {
    if (log) log.info(`[${id}] ENTER-SHORT on breakdown (support=${support.toFixed(2)})`)
    return {
      action: 'enter-short',
      detail: {
        ...detail,
        supportAtEntry: support,
        stopLoss: atr != null ? price + SL_ATR_MULT * atr : undefined,
        takeProfit: atr != null ? price - TP_ATR_MULT * atr : undefined
      }
    }
  }

  return { action: 'hold', detail }
}

