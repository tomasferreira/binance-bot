import { getEMACrossSignal, averageVolume } from '../indicators.js'
import { logger } from '../logger.js'

export const id = 'volume_ema_crossover'
export const name = 'Volume-Filtered EMA Crossover (50/200)'
export const description =
  'EMA 50/200 crossover long only when current volume > 1.5x average (20). Exits via SL/TP.'

const VOLUME_PERIOD = 24 // 1 day on 1h (24 bars)
const VOLUME_MULT = 1.5

export function evaluate (ohlcv, state) {
  if (!Array.isArray(ohlcv) || ohlcv.length < 210) {
    return { action: 'hold', detail: {} }
  }
  const { fast, slow, signal } = getEMACrossSignal(ohlcv)
  const avgVol = averageVolume(ohlcv, VOLUME_PERIOD)
  const lastCandle = ohlcv[ohlcv.length - 1]
  const currentVol = lastCandle[5] ?? 0
  const price = lastCandle[4]

  if (fast == null || slow == null || avgVol == null) {
    return { action: 'hold', detail: { fast, slow, signal, volume: currentVol } }
  }

  const volumeOk = avgVol > 0 && currentVol >= VOLUME_MULT * avgVol

  logger.info(
    `[${id}] price=${price.toFixed(2)} ema50=${fast.toFixed(2)} ema200=${slow.toFixed(2)} signal=${signal || 'none'} vol=${currentVol.toFixed(0)} avgVol=${avgVol.toFixed(0)} volumeOk=${volumeOk}`
  )

  if (!state?.openPosition && signal === 'long' && volumeOk) {
    logger.info(`[${id}] LONG signal (EMA cross + volume confirmation)`)
    return { action: 'enter-long', detail: { fast, slow, signal, volume: currentVol, avgVol } }
  }

  return { action: 'hold', detail: { fast, slow, signal, volume: currentVol, avgVol } }
}
