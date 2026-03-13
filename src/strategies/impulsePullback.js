import { calculateATR, calculateEMA } from '../indicators.js'

export const id = 'impulse_pullback'
export const name = 'Impulse Pullback Continuation'
export const description =
  'Waits for a shallow pullback after a strong impulse bar in the direction of the trend, then enters. Exits when price closes beyond EMA 20 (vs trend); otherwise SL/TP.'

const LOOKBACK = 20
const TREND_EMA = 20
const RANGE_MULT = 2.0
const BODY_MULT = 2.0
const VOL_MULT = 2.0
const CLOSE_POS_THRESHOLD = 0.7
const MAX_PULLBACK_BARS = 3
const MAX_RETRACE_FRACTION = 0.5 // how deep the pullback can go into the impulse
const SL_ATR_MULT = 1.5
const TP_ATR_MULT = 2

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  if (!Array.isArray(ohlcv) || ohlcv.length < Math.max(LOOKBACK + MAX_PULLBACK_BARS + 2, TREND_EMA + 2)) {
    return { action: 'hold', detail: {} }
  }

  const n = ohlcv.length
  const recent = ohlcv.slice(-(LOOKBACK + MAX_PULLBACK_BARS + 1), -1)
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
  const closes = ohlcv.map(c => c[4])
  const emaArr = calculateEMA(closes, TREND_EMA)
  const ema20 = emaArr[n - 1]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]

  if (state?.openPosition && ema20 != null) {
    const side = state.openPosition.side || 'long'
    if (side === 'long' && closeNow < ema20) {
      if (log) log.info(`[${id}] EXIT signal (price below EMA 20)`)
      return { action: 'exit-long', detail: { ts: tsNow, closeNow, ema20, avgRange, avgBody, avgVol } }
    }
    if (side === 'short' && closeNow > ema20) {
      if (log) log.info(`[${id}] EXIT signal (price above EMA 20)`)
      return { action: 'exit-short', detail: { ts: tsNow, closeNow, ema20, avgRange, avgBody, avgVol } }
    }
    return {
      action: 'hold',
      detail: { ts: tsNow, avgRange, avgBody, avgVol, hasOpenPosition: true }
    }
  }

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

  const [tsPull, , highPull, lowPull, closePull] = ohlcv[n - 1]

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
    const shallowRetrace = impulseRange > 0 && highPull <= impulseHigh && highPull <= impulseLow + impulseRange * MAX_RETRACE_FRACTION
    const holdsBelowMid = closePull <= midImpulse
    enterShort = shallowRetrace && holdsBelowMid && allowShort
  }

  if (log) {
    log.info(
      `[${id}] ts=${new Date(tsPull).toISOString()} impulseIdx=${impulseIndex} side=${impulseSide} ` +
        `impulseHigh=${impulseHigh?.toFixed?.(2)} impulseLow=${impulseLow?.toFixed?.(2)} ` +
        `closePull=${closePull?.toFixed?.(2)} enterLong=${enterLong} enterShort=${enterShort}`
    )
  }

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
        avgVol,
        stopLoss: (atr != null ? closePull - SL_ATR_MULT * atr : undefined),
        takeProfit: (atr != null ? closePull + TP_ATR_MULT * atr : undefined)
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
        avgVol,
        stopLoss: (atr != null ? closePull + SL_ATR_MULT * atr : undefined),
        takeProfit: (atr != null ? closePull - TP_ATR_MULT * atr : undefined)
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

