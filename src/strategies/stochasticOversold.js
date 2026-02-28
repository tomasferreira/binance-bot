import { calculateStochastic } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'stochastic_oversold'
export const name = 'Stochastic Oversold (Long)'
export const description =
  'Long when %K crosses above %D from below 20 (oversold). Exits when %K crosses below %D or RSI-style exit optional.'

const K_PERIOD = 14
const D_PERIOD = 3
const OVERSOLD = 20

export function evaluate (ohlcv, state) {
  const minLen = K_PERIOD + D_PERIOD + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }
  const { k, d } = calculateStochastic(ohlcv, K_PERIOD, D_PERIOD)
  const i = ohlcv.length - 1
  const prev = i - 1
  const price = ohlcv[i][4]
  const kNow = k[i]
  const dNow = d[i]
  const kPrev = k[prev]
  const dPrev = d[prev]

  if (kNow == null || dNow == null || kPrev == null || dPrev == null) {
    return { action: 'hold', detail: { price, k: kNow, d: dNow } }
  }

  const wasOversold = kPrev < OVERSOLD
  const crossUp = kPrev <= dPrev && kNow > dNow
  const longSignal = wasOversold && crossUp

  if (state?.openPosition) {
    const crossDown = kPrev >= dPrev && kNow < dNow
    if (crossDown) {
      logger.info(`[${id}] EXIT signal (Stoch cross down)`)
      return { action: 'exit-long', detail: { price, k: kNow, d: dNow } }
    }
    return { action: 'hold', detail: { price, k: kNow, d: dNow } }
  }

  logger.info(
    `[${id}] price=${price.toFixed(2)} %K=${kNow.toFixed(2)} %D=${dNow.toFixed(2)} wasOversold=${wasOversold} crossUp=${crossUp}`
  )

  if (longSignal) {
    logger.info(`[${id}] LONG signal`)
    return { action: 'enter-long', detail: { price, k: kNow, d: dNow } }
  }

  return { action: 'hold', detail: { price, k: kNow, d: dNow } }
}
