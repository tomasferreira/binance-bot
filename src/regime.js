import { calculateATR, calculateADX } from './indicators.js'

const ATR_PERIOD = 14
const ADX_PERIOD = 14
const ATR_LOOKBACK = 50

/**
 * Compute regime (volatility, trend, trend direction) from regime OHLCV.
 * @param {Array<[number, number, number, number, number, number]>} regimeOhlcv
 * @returns {{ volatility: string, trend: string, trendDirection: string, volatilityRatio: number|null, adxNow: number|null, plusDiNow: number|null, minusDiNow: number|null } | null}
 */
export function computeRegime (regimeOhlcv) {
  if (!Array.isArray(regimeOhlcv) || regimeOhlcv.length < 30) return null

  const atrArr = calculateATR(regimeOhlcv, ATR_PERIOD)
  const atrNow = atrArr.length ? atrArr[atrArr.length - 1] : null
  const atrAvg = (atrArr.length >= ATR_LOOKBACK)
    ? atrArr.slice(-ATR_LOOKBACK).reduce((a, b) => a + b, 0) / ATR_LOOKBACK
    : (atrArr.length ? atrArr.reduce((a, b) => a + b, 0) / atrArr.length : null)

  let volatility = 'neutral'
  let volatilityRatio = null
  if (atrNow != null && atrAvg != null && atrAvg > 0) {
    volatilityRatio = atrNow / atrAvg
    if (volatilityRatio >= 1.2) volatility = 'high'
    else if (volatilityRatio <= 0.8) volatility = 'low'
  }

  const { adx: adxArr, plusDi: plusDiArr, minusDi: minusDiArr } = calculateADX(regimeOhlcv, ADX_PERIOD)
  const adxNow = adxArr.length ? adxArr[adxArr.length - 1] : null
  const plusDiNow = plusDiArr.length ? plusDiArr[plusDiArr.length - 1] : null
  const minusDiNow = minusDiArr.length ? minusDiArr[minusDiArr.length - 1] : null

  let trend = 'weak'
  if (adxNow != null) {
    if (adxNow >= 25) trend = 'trending'
    else if (adxNow < 20) trend = 'ranging'
  }

  let trendDirection = 'neutral'
  if (plusDiNow != null && minusDiNow != null) {
    if (plusDiNow > minusDiNow) trendDirection = 'bullish'
    else if (minusDiNow > plusDiNow) trendDirection = 'bearish'
  }

  return {
    volatility,
    trend,
    trendDirection,
    volatilityRatio,
    adxNow,
    plusDiNow,
    minusDiNow
  }
}
