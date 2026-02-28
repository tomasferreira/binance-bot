import { logger } from '../logger.js'
import * as emaCrossover from './emaCrossover.js'
import * as macd from './macd.js'
import * as multiEma from './multiEma.js'
import * as priceVsEma from './priceVsEma.js'
import * as rsiPullback from './rsiPullback.js'
import * as bollingerMeanRevert from './bollingerMeanRevert.js'
import * as multiTfTrend from './multiTfTrend.js'
import * as atrTrend from './atrTrend.js'
import * as shortTrend from './shortTrend.js'
import * as shortBreakdown from './shortBreakdown.js'
import * as shortOverbought from './shortOverbought.js'
import * as shortMacd from './shortMacd.js'
import * as shortRejection from './shortRejection.js'
import * as macdHistogramLong from './macdHistogramLong.js'
import * as volumeEmaCrossover from './volumeEmaCrossover.js'
import * as emaFastCrossover from './emaFastCrossover.js'
import * as rsiMacdCombo from './rsiMacdCombo.js'
import * as bollingerSqueeze from './bollingerSqueeze.js'
import * as donchianBreakout from './donchianBreakout.js'
import * as stochasticOversold from './stochasticOversold.js'
import * as shortMacdHistogram from './shortMacdHistogram.js'
import * as atrBreakout from './atrBreakout.js'
import * as rangeBounce from './rangeBounce.js'

const strategies = {
  [emaCrossover.id]: emaCrossover,
  [macd.id]: macd,
  [multiEma.id]: multiEma,
  [priceVsEma.id]: priceVsEma,
  [rsiPullback.id]: rsiPullback,
  [bollingerMeanRevert.id]: bollingerMeanRevert,
  [multiTfTrend.id]: multiTfTrend,
  [atrTrend.id]: atrTrend,
  [shortTrend.id]: shortTrend,
  [shortBreakdown.id]: shortBreakdown,
  [shortOverbought.id]: shortOverbought,
  [shortMacd.id]: shortMacd,
  [shortRejection.id]: shortRejection,
  [macdHistogramLong.id]: macdHistogramLong,
  [volumeEmaCrossover.id]: volumeEmaCrossover,
  [emaFastCrossover.id]: emaFastCrossover,
  [rsiMacdCombo.id]: rsiMacdCombo,
  [bollingerSqueeze.id]: bollingerSqueeze,
  [donchianBreakout.id]: donchianBreakout,
  [stochasticOversold.id]: stochasticOversold,
  [shortMacdHistogram.id]: shortMacdHistogram,
  [atrBreakout.id]: atrBreakout,
  [rangeBounce.id]: rangeBounce
}

export const STRATEGY_IDS = Object.keys(strategies)

export function getStrategy (id) {
  return strategies[id] ?? null
}

export function evaluateStrategy (id, ohlcv, state) {
  const s = getStrategy(id)
  if (!s?.evaluate) return { action: 'hold', detail: {} }
  const lastClose = Array.isArray(ohlcv) && ohlcv.length ? ohlcv[ohlcv.length - 1][4] : null
  logger.debug(`evaluateStrategy: ${id} start`, {
    lastClose,
    hasOpenPosition: !!state?.openPosition,
    side: state?.openPosition?.side || null
  })
  const decision = s.evaluate(ohlcv, state)
  logger.debug(`evaluateStrategy: ${id} result`, {
    action: decision?.action,
    detail: decision?.detail
  })
  return decision
}
