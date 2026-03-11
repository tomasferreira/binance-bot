import { logger } from '../logger.js'

export const id = 'impulse_pullback'
export const name = 'Impulse Pullback Continuation'
export const description =
  'Waits for a shallow pullback after a strong impulse bar in the direction of the trend, then enters with tighter risk. Exits via SL/TP.'

const LOOKBACK = 20
const RANGE_MULT = 1.5
const BODY_MULT = 1.5
const VOL_MULT = 1.5
const CLOSE_POS_THRESHOLD = 0.7
const MAX_PULLBACK_BARS = 3
const MAX_RETRACE_FRACTION = 0.5 // how deep the pullback can go into the impulse

export function evaluate (ohlcv, state, context = {}) {
  if (!Array.isArray(ohlcv) || ohlcv.length < LOOKBACK + MAX_PULLBACK_BARS + 2) {
    return { action: 'hold', detail: {} }
  }

  const n = ohlcv.length
  const recent = ohlcv.slice(-LOOKBACK - MAX_PULLBACK_BARS)
  const ranges = recent.map(c => (c[2] - c[3]) || 0)
  const bodies = recent.map(c => Math.abs((c[4] ?? 0) - (c[1] ?? 0)))
  const vols = recent.map(c => c[5] ?? 0)

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
  const avgRange = avg(ranges)
  const avgBody = avg(bodies)
  const avgVol = avg(vols)

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'
  const allowLong = trend === 'trending' && dir === 'bullish'
  const allowShort = trend === 'trending' && dir === 'bearish'

  const [tsNow, , , , closeNow] = ohlcv[n - 1]

  // Only look for entries when flat; rely on SL/TP for exits
  if (state?.openPosition) {
    return {
      action: 'hold',
      detail: {
        ts: tsNow,
        avgRange,
        avgBody,
        avgVol,
        hasOpenPosition: true
      }
    }
  }

  // Find the most recent impulse bar within the last MAX_PULLBACK_BARS + 1 bars
  const searchStart = Math.max(LOOKBACK, n - MAX_PULLBACK_BARS - 1)
  let impulseIndex = -1
  let impulseSide = null
  let impulseHigh = null
  let impulseLow = null

  for (let i = n - MAX_PULLBACK_BARS - 1; i < n; i++) {
    if (i <= 0 || i >= n) continue
    const [ts, open, high, low, close, volume] = ohlcv[i]
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

    const bullImpulse = hasRange && hasBody && hasVol && isBullishShape && allowLong
    const bearImpulse = hasRange && hasBody && hasVol && isBearishShape && allowShort

    if (bullImpulse || bearImpulse) {
      impulseIndex = i
      impulseSide = bullImpulse ? 'long' : 'short'
      impulseHigh = high
      impulseLow = low
      break
    }
  }

  if (impulseIndex === -1 || !impulseSide) {
    return {
      action: 'hold',
      detail: {
        ts: tsNow,
        avgRange,
        avgBody,
        avgVol,
        impulseFound: false
      }
    }
  }

  // Require that current bar is after the impulse (a pullback bar)
  if (n - 1 <= impulseIndex || n - 1 > impulseIndex + MAX_PULLBACK_BARS) {
    return {
      action: 'hold',
      detail: {
        ts: tsNow,
        avgRange,
        avgBody,
        avgVol,
        impulseFound: true,
        impulseSide
      }
    }
  }

  const [tsPull, , , lowPull, closePull] = ohlcv[n - 1]

  const impulseRange = (impulseHigh - impulseLow) || 0
  const midImpulse = impulseLow + impulseRange * 0.5
  const maxRetrace = impulseLow + impulseRange * (1 - MAX_RETRACE_FRACTION) // for long

  let enterLong = false
  let enterShort = false

  if (impulseSide === 'long') {
    const shallowRetrace = impulseRange > 0 && lowPull >= impulseLow && lowPull >= impulseLow + impulseRange * (1 - MAX_RETRACE_FRACTION)
    const holdsAboveMid = closePull >= midImpulse
    enterLong = shallowRetrace && holdsAboveMid && allowLong
  } else if (impulseSide === 'short') {
    const shallowRetrace = impulseRange > 0 && lowPull <= impulseHigh && closePull <= impulseHigh - impulseRange * (1 - MAX_RETRACE_FRACTION)
    const holdsBelowMid = closePull <= impulseLow + impulseRange * 0.5
    enterShort = shallowRetrace && holdsBelowMid && allowShort
  }

  logger.info(
    `[${id}] ts=${new Date(tsPull).toISOString()} impulseIdx=${impulseIndex} side=${impulseSide} ` +
      `impulseHigh=${impulseHigh?.toFixed?.(2)} impulseLow=${impulseLow?.toFixed?.(2)} ` +
      `closePull=${closePull?.toFixed?.(2)} enterLong=${enterLong} enterShort=${enterShort}`
  )

  if (enterLong) {
    return {
      action: 'enter-long',
      detail: {
        type: 'impulse_pullback',
        direction: 'long',
        ts: tsPull,
        impulseIndex,
        impulseHigh,
        impulseLow,
        avgRange,
        avgBody,
        avgVol
      }
    }
  }

  if (enterShort) {
    return {
      action: 'enter-short',
      detail: {
        type: 'impulse_pullback',
        direction: 'short',
        ts: tsPull,
        impulseIndex,
        impulseHigh,
        impulseLow,
        avgRange,
        avgBody,
        avgVol
      }
    }
  }

  return {
    action: 'hold',
    detail: {
      ts: tsNow,
      avgRange,
      avgBody,
      avgVol,
      impulseFound: true,
      impulseSide,
      pullback: true
    }
  }
}

