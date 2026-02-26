import { getEMACrossSignal, calculateATR } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'atr_trend'
export const name = 'ATR Trend EMA (50/200)'
export const description =
  'EMA(50/200) crossover trend follower that only enters when ATR(14) / price is above a minimum threshold.'

const ATR_PERIOD = 14
// Minimum ATR as a fraction of price (e.g. 0.004 = 0.4%)
const MIN_ATR_REL = 0.004

export function evaluate (ohlcv, state) {
  const minLen = 210 + ATR_PERIOD
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const closes = ohlcv.map(c => c[4])
  const atrArr = calculateATR(ohlcv, ATR_PERIOD)
  const atr = atrArr[atrArr.length - 1]
  const price = closes[closes.length - 1]
  if (atr == null || price == null) {
    return { action: 'hold', detail: { price, atr, atrRel: null } }
  }
  const atrRel = atr / price

  const { fast: ema50, slow: ema200, signal } = getEMACrossSignal(ohlcv)

  logger.info(
    `[${id}] price=${price.toFixed(2)} ATR(${ATR_PERIOD})=${atr.toFixed(
      2
    )} atrRel=${(atrRel * 100).toFixed(2)}% ema50=${ema50?.toFixed(
      2
    )} ema200=${ema200?.toFixed(2)} signal=${signal || 'none'}`
  )

  if (!state?.openPosition && signal === 'long' && atrRel >= MIN_ATR_REL) {
    logger.info(`[${id}] LONG signal (EMA cross + ATR filter)`)
    return { action: 'enter-long', detail: { price, atr, atrRel, ema50, ema200 } }
  }

  // Exits are handled by SL/TP only; this strategy only provides entries
  return { action: 'hold', detail: { price, atr, atrRel, ema50, ema200 } }
}

