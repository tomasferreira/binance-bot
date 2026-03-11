import { calculateEMA } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'impulse_follow'
export const name = 'Impulse Follow-through'
export const description =
  'Scalps short-term continuation after a strong impulse bar (range + volume spike) in the direction of the trend. Exits when price closes beyond EMA 20 (vs trend); otherwise SL/TP.'

const LOOKBACK = 20
const TREND_EMA = 20
const RANGE_MULT = 1.5
const BODY_MULT = 1.5
const VOL_MULT = 1.5
const CLOSE_POS_THRESHOLD = 0.7

export function evaluate (ohlcv, state, context = {}) {
  if (!Array.isArray(ohlcv) || ohlcv.length < Math.max(LOOKBACK, TREND_EMA) + 2) {
    return { action: 'hold', detail: {} }
  }

  const i = ohlcv.length - 1
  const [ts, open, high, low, close, volume] = ohlcv[i]
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, TREND_EMA)
  const ema20 = emaArr[i]
  const price = close ?? ohlcv[i][4]

  const recent = ohlcv.slice(-LOOKBACK)
  const ranges = recent.map(c => (c[2] - c[3]) || 0)
  const bodies = recent.map(c => Math.abs((c[4] ?? 0) - (c[1] ?? 0)))
  const vols = recent.map(c => c[5] ?? 0)

  const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0
  const avgRange = avg(ranges)
  const avgBody = avg(bodies)
  const avgVol = avg(vols)

  const range = (high - low) || 0
  const body = Math.abs((close ?? 0) - (open ?? 0))
  const vol = volume ?? 0

  const hasRange = avgRange > 0 && range > RANGE_MULT * avgRange
  const hasBody = avgBody > 0 && body > BODY_MULT * avgBody
  const hasVol = avgVol > 0 && vol > VOL_MULT * avgVol

  const fullRange = high - low
  const posInBar = fullRange > 0 ? (close - low) / fullRange : 0.5
  const isBullishShape = close > open && posInBar >= CLOSE_POS_THRESHOLD
  const isBearishShape = close < open && (1 - posInBar) >= CLOSE_POS_THRESHOLD

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'
  const allowLong = trend === 'trending' && dir === 'bullish'
  const allowShort = trend === 'trending' && dir === 'bearish'

  const isBullishImpulse = hasRange && hasBody && hasVol && isBullishShape && allowLong
  const isBearishImpulse = hasRange && hasBody && hasVol && isBearishShape && allowShort

  logger.info(`[${id}] ts=${new Date(ts).toISOString()} range=${range.toFixed(2)} avgRange=${avgRange.toFixed(2)} body=${body.toFixed(2)} avgBody=${avgBody.toFixed(2)} vol=${vol.toFixed(0)} avgVol=${avgVol.toFixed(0)} bullImpulse=${isBullishImpulse} bearImpulse=${isBearishImpulse}`)

  if (!state?.openPosition) {
    if (isBullishImpulse) {
      logger.info(`[${id}] LONG impulse signal`)
      return {
        action: 'enter-long',
        detail: {
          type: 'impulse',
          direction: 'long',
          ts,
          range,
          avgRange,
          body,
          avgBody,
          vol,
          avgVol
        }
      }
    }
    if (isBearishImpulse) {
      logger.info(`[${id}] SHORT impulse signal`)
      return {
        action: 'enter-short',
        detail: {
          type: 'impulse',
          direction: 'short',
          ts,
          range,
          avgRange,
          body,
          avgBody,
          vol,
          avgVol
        }
      }
    }
  }

  if (state?.openPosition && ema20 != null) {
    const side = state.openPosition.side || 'long'
    if (side === 'long' && price < ema20) {
      logger.info(`[${id}] EXIT signal (price below EMA 20)`)
      return { action: 'exit-long', detail: { ts, price, ema20, range, avgRange, vol, avgVol } }
    }
    if (side === 'short' && price > ema20) {
      logger.info(`[${id}] EXIT signal (price above EMA 20)`)
      return { action: 'exit-short', detail: { ts, price, ema20, range, avgRange, vol, avgVol } }
    }
  }

  return {
    action: 'hold',
    detail: {
      ts,
      range,
      avgRange,
      body,
      avgBody,
      vol,
      avgVol
    }
  }
}

