import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'short_rejection'
export const name = 'Short Rejection at Resistance'
export const description =
  'Shorts rejection candles at recent resistance in a bearish/neutral EMA regime. Exits if resistance is broken.'

const FAST = 50
const SLOW = 200
const LOOKBACK = 30

export function evaluate (ohlcv, state) {
  const minLen = Math.max(SLOW, LOOKBACK) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const emaFastArr = calculateEMA(closes, FAST)
  const emaSlowArr = calculateEMA(closes, SLOW)

  const i = ohlcv.length - 1
  const prev = i - 1

  const [, open, high, low, close] = ohlcv[i]
  const prevClose = ohlcv[prev][4]
  const emaFast = emaFastArr[i]
  const emaSlow = emaSlowArr[i]

  if ([open, high, low, close, prevClose, emaFast, emaSlow].some(v => v == null)) {
    return { action: 'hold', detail: { open, high, low, close, emaFast, emaSlow } }
  }

  const highs = ohlcv.slice(i - LOOKBACK, i).map(c => c[2])
  const resistance = Math.max(...highs)

  const touchedResistance = high >= resistance * 0.999
  const bearishCandle = close < open && close < prevClose
  const upperWick = high - Math.max(open, close)
  const body = Math.abs(close - open)
  const hasUpperWick = upperWick > body
  const rejection = touchedResistance && bearishCandle && hasUpperWick

  const trendBearishOrNeutral = close <= emaFast || emaFast <= emaSlow

  const detail = {
    open,
    high,
    low,
    close,
    prevClose,
    resistance,
    emaFast,
    emaSlow,
    rejection,
    trendBearishOrNeutral
  }

  logger.info(
    `[${id}] close=${close.toFixed(2)} res=${resistance.toFixed(
      2
    )} rejection=${rejection} trendOk=${trendBearishOrNeutral}`
  )

  if (state?.openPosition?.side === 'short') {
    const brokenResistance = close > resistance || close > emaFast
    if (brokenResistance) {
      logger.info(`[${id}] EXIT-SHORT (resistance broken)`)
      return { action: 'exit-short', detail: { ...detail, brokenResistance } }
    }
    return { action: 'hold', detail }
  }

  if (!state?.openPosition && trendBearishOrNeutral && rejection) {
    logger.info(`[${id}] ENTER-SHORT on rejection`)
    return { action: 'enter-short', detail }
  }

  return { action: 'hold', detail }
}

