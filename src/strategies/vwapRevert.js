import { calculateATR, averageVolume } from '../indicators.js'

export const id = 'vwap_revert'
export const name = 'VWAP Mean Reversion'
export const description =
  'Mean reversion around intraday VWAP: fades extensions above/below VWAP primarily in ranging/weak regimes. Exits via SL/TP.'

// Bars in 24h for each timeframe (used for session VWAP lookback)
const BARS_PER_24H = { '1m': 1440, '5m': 288, '15m': 96, '30m': 48, '1h': 24 }
const DEFAULT_VWAP_LOOKBACK = 288 // 5m default
const DISTANCE_ENTRY = 0.015 // 1.5% away from VWAP to consider overextended
const MIN_BODY_FRACTION = 0.3 // body at least 30% of bar range
const SL_ATR_MULT = 1.5
const VOL_MULT = 1.2
const VOL_PERIOD = 20

function getVwapLookback (timeframe) {
  return BARS_PER_24H[timeframe] ?? DEFAULT_VWAP_LOOKBACK
}

function computeSessionVwap (ohlcv, lookback) {
  const n = ohlcv.length
  if (n < lookback) return null
  const slice = ohlcv.slice(-lookback)
  let pvSum = 0
  let volSum = 0
  for (const c of slice) {
    const high = c[2]
    const low = c[3]
    const close = c[4]
    const vol = c[5] ?? 0
    const tp = (high + low + close) / 3
    pvSum += tp * vol
    volSum += vol
  }
  if (volSum <= 0) return null
  return pvSum / volSum
}

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const vwapLookback = getVwapLookback(context?.timeframe || '5m')
  if (!Array.isArray(ohlcv) || ohlcv.length < vwapLookback + 2) {
    return { action: 'hold', detail: {} }
  }

  const n = ohlcv.length
  const [ts, open, high, low, close, volume] = ohlcv[n - 1]

  const vwap = computeSessionVwap(ohlcv, vwapLookback)
  if (vwap == null || vwap === 0) {
    return { action: 'hold', detail: { vwap: null } }
  }

  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  const avgVol = averageVolume(ohlcv, VOL_PERIOD)
  const vol = volume ?? 0
  const volOk = avgVol != null && avgVol > 0 && vol > VOL_MULT * avgVol

  const dist = (close - vwap) / vwap // positive = above VWAP
  const range = (high - low) || 0
  const body = Math.abs((close ?? 0) - (open ?? 0))
  const bodyOk = range > 0 && body / range >= MIN_BODY_FRACTION

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'

  const isTrending = trend === 'trending'
  const isRangingOrWeak = trend === 'ranging' || trend === 'weak'

  // Bias: prefer mean reversion in ranging/weak, be conservative in strong trends.
  const allowCounterLong = isRangingOrWeak || dir !== 'bearish'
  const allowCounterShort = isRangingOrWeak || dir !== 'bullish'

  if (log) {
    log.info(
      `[${id}] ts=${new Date(ts).toISOString()} close=${close.toFixed(2)} vwap=${vwap.toFixed(
        2
      )} dist=${(dist * 100).toFixed(2)}% trend=${trend} dir=${dir}`
    )
  }

  if (state?.openPosition) {
    return {
      action: 'hold',
      detail: {
        ts,
        vwap,
        dist,
        trend,
        dir,
        hasOpenPosition: true
      }
    }
  }

  let enterLong = false
  let enterShort = false

  // Price sufficiently below VWAP, bullish candle, volume spike, regime allows counter-trend
  if (dist <= -DISTANCE_ENTRY && close > open && bodyOk && volOk && allowCounterLong) {
    enterLong = true
  }

  // Price sufficiently above VWAP, bearish candle, volume spike, regime allows counter-trend
  if (dist >= DISTANCE_ENTRY && close < open && bodyOk && volOk && allowCounterShort) {
    enterShort = true
  }

  if (enterLong) {
    if (log) log.info(`[${id}] ENTER-LONG (below VWAP, fade up)`)
    return {
      action: 'enter-long',
      detail: {
        type: 'vwap_revert',
        direction: 'long',
        ts,
        vwap,
        dist,
        trend,
        dir,
        volume,
        stopLoss: atr != null ? close - SL_ATR_MULT * atr : undefined,
        takeProfit: vwap
      }
    }
  }

  if (enterShort) {
    if (log) log.info(`[${id}] ENTER-SHORT (above VWAP, fade down)`)
    return {
      action: 'enter-short',
      detail: {
        type: 'vwap_revert',
        direction: 'short',
        ts,
        vwap,
        dist,
        trend,
        dir,
        volume,
        stopLoss: atr != null ? close + SL_ATR_MULT * atr : undefined,
        takeProfit: vwap
      }
    }
  }

  return {
    action: 'hold',
    detail: {
      ts,
      vwap,
      dist,
      trend,
      dir,
      volume
    }
  }
}

