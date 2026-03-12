import { calculateATR } from '../indicators.js'

export const id = 'volume_climax_reversal'
export const name = 'Volume Climax Reversal'
export const description =
  'Fades exhaustion: after a directional move of at least 3 bars and 0.5%, enters opposite on a volume-climax bar (volume spike + dominant wick). Exits via SL/TP.'

// Volume climax
const VOL_LOOKBACK = 24 // 2h on 5m for volume average
const VOL_CLIMAX_MULT = 2 // current bar volume >= this × average

// Prior move (exhaustion = meaningful move before climax)
const MOVE_LOOKBACK = 8 // 40min on 5m
const MIN_MOVE_BARS = 3 // at least this many bars in the same direction
const MIN_MOVE_PCT = 0.005 // prior move must be at least 0.5% (avoid tiny noise)

// Climax bar shape
const WICK_VS_BODY = 1.5 // dominant wick: wick >= body * this
const CLOSE_OUTER_THIRD = 1 / 3 // close in outer 1/3 of range (top for hammer/long, bottom for shooting star/short)
const SL_ATR_MULT = 2
const TP_ATR_MULT = 3

export function evaluate (ohlcv, state, context = {}) {
  const log = context?.logger
  const minLen = Math.max(VOL_LOOKBACK, MOVE_LOOKBACK) + 2
  if (!Array.isArray(ohlcv) || ohlcv.length < minLen) {
    return { action: 'hold', detail: {} }
  }

  const i = ohlcv.length - 1
  const [ts, open, high, low, close, volume] = ohlcv[i]
  const atrArr = calculateATR(ohlcv, 14)
  const atr = atrArr[atrArr.length - 1]
  const range = (high - low) || 0
  const body = Math.abs((close ?? 0) - (open ?? 0))
  const upperWick = high - Math.max(open, close)
  const lowerWick = Math.min(open, close) - low
  const vol = volume ?? 0

  const volSlice = ohlcv.slice(i - VOL_LOOKBACK, i).map(c => c[5] ?? 0)
  const avgVol = volSlice.length ? volSlice.reduce((a, b) => a + b, 0) / volSlice.length : 0
  const isClimaxVol = avgVol > 0 && vol >= VOL_CLIMAX_MULT * avgVol

  const prevCloses = ohlcv.slice(i - MOVE_LOOKBACK, i).map(c => c[4])
  const closeThen = prevCloses[0]
  const closeNow = close
  let downBars = 0
  let upBars = 0
  for (let j = 1; j < prevCloses.length; j++) {
    if (prevCloses[j] < prevCloses[j - 1]) downBars++
    else if (prevCloses[j] > prevCloses[j - 1]) upBars++
  }
  const downMovePct = closeThen != null && closeThen > 0 && closeNow != null ? (closeThen - closeNow) / closeThen : 0
  const upMovePct = closeThen != null && closeThen > 0 && closeNow != null ? (closeNow - closeThen) / closeThen : 0
  const hadDownMove = closeThen != null && closeNow != null && closeNow < closeThen && downBars >= MIN_MOVE_BARS && downMovePct >= MIN_MOVE_PCT
  const hadUpMove = closeThen != null && closeNow != null && closeNow > closeThen && upBars >= MIN_MOVE_BARS && upMovePct >= MIN_MOVE_PCT

  const closePosInRange = range > 0 ? (close - low) / range : 0.5
  const dominantLowerWick = body > 0 && lowerWick >= WICK_VS_BODY * body && range > 0 && closePosInRange >= (1 - CLOSE_OUTER_THIRD)
  const dominantUpperWick = body > 0 && upperWick >= WICK_VS_BODY * body && range > 0 && closePosInRange <= CLOSE_OUTER_THIRD

  const bullishClimax = isClimaxVol && hadDownMove && dominantLowerWick
  const bearishClimax = isClimaxVol && hadUpMove && dominantUpperWick

  const regime = context?.regime || null
  const trend = regime?.trend || 'weak'
  const dir = regime?.trendDirection || 'neutral'
  const allowLong = trend === 'trending' ? dir !== 'bearish' : true
  const allowShort = trend === 'trending' ? dir !== 'bullish' : true

  if (log) {
    log.info(
      `[${id}] ts=${new Date(ts).toISOString()} vol=${vol.toFixed(0)} avgVol=${avgVol.toFixed(
        0
      )} climaxVol=${isClimaxVol} ` +
        `downMovePct=${(downMovePct * 100).toFixed(2)}% upMovePct=${(upMovePct * 100).toFixed(
          2
        )}% hadDown=${hadDownMove} hadUp=${hadUpMove} bullClimax=${bullishClimax} bearClimax=${bearishClimax}`
    )
  }

  if (state?.openPosition) {
    return {
      action: 'hold',
      detail: { ts, vol, avgVol, hasOpenPosition: true }
    }
  }

  if (!state?.openPosition && bullishClimax && allowLong) {
    if (log) log.info(`[${id}] ENTER-LONG (volume climax after down move)`)
    return {
      action: 'enter-long',
      detail: {
        type: 'volume_climax',
        direction: 'long',
        ts,
        vol,
        avgVol,
        closePosInRange,
        lowerWick,
        body,
        stopLoss: atr != null ? close - SL_ATR_MULT * atr : undefined,
        takeProfit: atr != null ? close + TP_ATR_MULT * atr : undefined
      }
    }
  }

  if (!state?.openPosition && bearishClimax && allowShort) {
    if (log) log.info(`[${id}] ENTER-SHORT (volume climax after up move)`)
    return {
      action: 'enter-short',
      detail: {
        type: 'volume_climax',
        direction: 'short',
        ts,
        vol,
        avgVol,
        closePosInRange,
        upperWick,
        body,
        stopLoss: atr != null ? close + SL_ATR_MULT * atr : undefined,
        takeProfit: atr != null ? close - TP_ATR_MULT * atr : undefined
      }
    }
  }

  return {
    action: 'hold',
    detail: { ts, vol, avgVol, downMovePct, upMovePct, bullishClimax, bearishClimax }
  }
}
