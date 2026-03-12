import { getMACDCrossSignal, calculateRSI } from '../indicators.js'

export const id = 'rsi_macd_combo'
export const name = 'RSI + MACD Combo (Long)'
export const description =
  'Long when MACD crosses up and RSI(14) is between 40–60 (not overbought). Exits via SL/TP.'

const RSI_PERIOD = 14
const RSI_LOW = 40
const RSI_HIGH = 60

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = 26 + 9 + RSI_PERIOD + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const closes = ohlcv.map(c => c[4])
  const { crossSignal } = getMACDCrossSignal(ohlcv)
  const rsiArr = calculateRSI(closes, RSI_PERIOD)
  const i = closes.length - 1
  const rsi = rsiArr[i]
  const price = closes[i]

  if (rsi == null) {
    return { action: 'hold', detail: { price, rsi, crossSignal } }
  }

  const macdLong = crossSignal === 'long'
  const rsiInZone = rsi >= RSI_LOW && rsi <= RSI_HIGH

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} RSI=${rsi.toFixed(2)} macdCross=${crossSignal || 'none'} rsiInZone=${rsiInZone}`
    )
  }

  if (!state?.openPosition && macdLong && rsiInZone) {
    if (log) log.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, rsi, crossSignal } }
  }

  return { action: 'hold', detail: { price, rsi, crossSignal } }
}
