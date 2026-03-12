import { calculateEMA, getMACDCrossSignal } from '../indicators.js'

export const id = 'short_macd'
export const name = 'Short MACD Bearish Cross'
export const description =
  'Shorts when MACD crosses below signal and EMA 50 < EMA 200 (bearish trend only). Exits on opposite cross or MACD turning up.'

const FAST_EMA = 50
const SLOW_EMA = 200

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(SLOW_EMA, 26 + 9) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const emaFastArr = calculateEMA(closes, FAST_EMA)
  const emaSlowArr = calculateEMA(closes, SLOW_EMA)
  const i = closes.length - 1

  const price = closes[i]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  const { macd, signal, histogram, crossSignal } = getMACDCrossSignal(ohlcv)
  if ([price, emaFast, emaSlow, macd, signal].some(v => v == null)) {
    return { action: 'hold', detail: { price, emaFast, emaSlow, macd, signal, histogram, crossSignal } }
  }

  const trendBearish = emaFast < emaSlow
  const bearishCross = crossSignal === 'short'
  const bullishCross = crossSignal === 'long'

  const detail = { price, emaFast, emaSlow, macd, signal, histogram, trendBearish, bearishCross, bullishCross }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(
        2
      )} macd=${macd.toFixed(4)} signal=${signal.toFixed(
        4
      )} trendBearish=${trendBearish} cross=${crossSignal || 'none'}`
    )
  }

  if (state?.openPosition?.side === 'short') {
    const exitCondition = bullishCross || macd >= 0
    if (exitCondition) {
      if (log) log.info(`[${id}] EXIT-SHORT (MACD turning up)`)
      return { action: 'exit-short', detail }
    }
    return { action: 'hold', detail }
  }

  if (!state?.openPosition && trendBearish && bearishCross) {
    if (log) log.info(`[${id}] ENTER-SHORT on MACD cross down`)
    return { action: 'enter-short', detail }
  }

  return { action: 'hold', detail }
}

