import { calculateATR, calculateADX } from './indicators.js'

const ATR_PERIOD = 14
const ADX_PERIOD = 14
const ATR_LOOKBACK = 200
const ADX_SMOOTH = 3
const DI_GAP_MIN = 5
const REGIME_MIN_HOLD = 3

const ADX_TRENDING_ENTER = 25
const ADX_TRENDING_EXIT = 22
const ADX_RANGING_ENTER = 20
const ADX_RANGING_EXIT = 23

function avgNonNull (arr) {
  let sum = 0
  let count = 0
  for (const v of arr) {
    if (v != null) { sum += v; count++ }
  }
  return count > 0 ? sum / count : null
}

/**
 * Compute regime (volatility, trend, trend direction) from regime OHLCV.
 * @param {Array<[number, number, number, number, number, number]>} regimeOhlcv
 * @param {object|null} prevResult - Previous computeRegime result for hysteresis / min-hold.
 * @returns {{ volatility: string, trend: string, trendDirection: string, volatilityRatio: number|null, adxNow: number|null, plusDiNow: number|null, minusDiNow: number|null, barsInRegime: number } | null}
 */
export function computeRegime (regimeOhlcv, prevResult = null) {
  if (!Array.isArray(regimeOhlcv) || regimeOhlcv.length < 30) return null

  const atrArr = calculateATR(regimeOhlcv, ATR_PERIOD)
  const atrNow = atrArr.length ? atrArr[atrArr.length - 1] : null
  const atrAvg = atrArr.length >= ATR_LOOKBACK
    ? avgNonNull(atrArr.slice(-ATR_LOOKBACK))
    : avgNonNull(atrArr)

  let volatility = 'neutral'
  let volatilityRatio = null
  if (atrNow != null && atrAvg != null && atrAvg > 0) {
    volatilityRatio = atrNow / atrAvg
    if (volatilityRatio >= 1.2) volatility = 'high'
    else if (volatilityRatio <= 0.8) volatility = 'low'
  }

  const { adx: adxArr, plusDi: plusDiArr, minusDi: minusDiArr } = calculateADX(regimeOhlcv, ADX_PERIOD)

  const adxNow = avgNonNull(adxArr.slice(-ADX_SMOOTH))
  const plusDiNow = avgNonNull(plusDiArr.slice(-ADX_SMOOTH))
  const minusDiNow = avgNonNull(minusDiArr.slice(-ADX_SMOOTH))

  // --- Trend classification with hysteresis ---
  let trend = 'weak'
  if (adxNow != null) {
    const prevTrend = prevResult?.trend
    if (prevTrend === 'trending') {
      trend = adxNow >= ADX_TRENDING_EXIT ? 'trending' : (adxNow < ADX_RANGING_ENTER ? 'ranging' : 'weak')
    } else if (prevTrend === 'ranging') {
      trend = adxNow < ADX_RANGING_EXIT ? 'ranging' : (adxNow >= ADX_TRENDING_ENTER ? 'trending' : 'weak')
    } else {
      if (adxNow >= ADX_TRENDING_ENTER) trend = 'trending'
      else if (adxNow < ADX_RANGING_ENTER) trend = 'ranging'
    }
  }

  // --- Direction: require DI minimum gap and ADX-confirmed trend (not ranging) ---
  let trendDirection = 'neutral'
  if (plusDiNow != null && minusDiNow != null && trend !== 'ranging') {
    const diGap = Math.abs(plusDiNow - minusDiNow)
    if (diGap >= DI_GAP_MIN) {
      if (plusDiNow > minusDiNow) trendDirection = 'bullish'
      else trendDirection = 'bearish'
    }
  }

  // --- Min hold: prevent trend/direction flip-flopping (volatility updates freely) ---
  const prevBars = prevResult?.barsInRegime ?? 0
  const trendChanged = prevResult != null && (trend !== prevResult.trend || trendDirection !== prevResult.trendDirection)
  if (trendChanged && prevBars < REGIME_MIN_HOLD) {
    return {
      volatility,
      trend: prevResult.trend,
      trendDirection: prevResult.trendDirection,
      volatilityRatio,
      adxNow,
      plusDiNow,
      minusDiNow,
      barsInRegime: prevBars + 1
    }
  }

  return {
    volatility,
    trend,
    trendDirection,
    volatilityRatio,
    adxNow,
    plusDiNow,
    minusDiNow,
    barsInRegime: trendChanged ? 1 : prevBars + 1
  }
}
