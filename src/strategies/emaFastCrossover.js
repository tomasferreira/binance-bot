import { getEMACrossSignalPeriods, calculateATR } from '../indicators.js'

export const id = 'ema_fast_crossover'
export const name = 'EMA Fast Crossover (9/21)'
export const description =
  'Long when EMA 9 crosses above EMA 21, only when ATR(14)/price is above 0.4% (skip dead markets). Exits via SL/TP.'

const FAST = 9
const SLOW = 21
const ATR_PERIOD = 14
const MIN_ATR_REL = 0.004 // 0.4% min volatility to avoid whipsaw in flat markets
const SL_ATR_MULT = 2.5
const TP_ATR_MULT = 3.5

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(SLOW + 2, ATR_PERIOD + 2)
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const { fast, slow, signal } = getEMACrossSignalPeriods(ohlcv, FAST, SLOW)
  const i = ohlcv.length - 1
  const price = ohlcv[i][4]
  const atrArr = calculateATR(ohlcv, ATR_PERIOD)
  const atr = atrArr[i]
  const atrRel = atr != null && price != null && price > 0 ? atr / price : 0
  const volatilityOk = atrRel >= MIN_ATR_REL

  if (fast == null || slow == null) {
    return { action: 'hold', detail: { fast, slow, signal, atrRel } }
  }

  if (log) {
    log.info(
      `[${id}] price=${price.toFixed(2)} ema9=${fast.toFixed(2)} ema21=${slow.toFixed(
        2
      )} signal=${signal || 'none'} atrRel=${(atrRel * 100).toFixed(2)}% volOk=${volatilityOk}`
    )
  }

  if (!state?.openPosition && signal === 'long' && volatilityOk) {
    if (log) log.info(`[${id}] LONG signal (EMA cross + volatility filter)`)
    return { action: 'enter-long', detail: { fast, slow, signal, atrRel, stopLoss: (atr != null ? price - SL_ATR_MULT * atr : undefined), takeProfit: (atr != null ? price + TP_ATR_MULT * atr : undefined) } }
  }

  return { action: 'hold', detail: { fast, slow, signal, atrRel } }
}
