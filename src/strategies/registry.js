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
import * as macdHistogram from './macdHistogram.js'
import * as volumeEmaCrossover from './volumeEmaCrossover.js'
import * as emaFastCrossover from './emaFastCrossover.js'
import * as rsiMacdCombo from './rsiMacdCombo.js'
import * as bollingerSqueeze from './bollingerSqueeze.js'
import * as donchianBreakout from './donchianBreakout.js'
import * as stochasticOversold from './stochasticOversold.js'
import * as atrBreakout from './atrBreakout.js'
import * as rangeBounce from './rangeBounce.js'
import * as impulseFollow from './impulseFollow.js'
import * as stopHuntReversal from './stopHuntReversal.js'
import * as impulsePullback from './impulsePullback.js'
import * as vwapRevert from './vwapRevert.js'

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
  [macdHistogram.id]: macdHistogram,
  [volumeEmaCrossover.id]: volumeEmaCrossover,
  [emaFastCrossover.id]: emaFastCrossover,
  [rsiMacdCombo.id]: rsiMacdCombo,
  [bollingerSqueeze.id]: bollingerSqueeze,
  [donchianBreakout.id]: donchianBreakout,
  [stochasticOversold.id]: stochasticOversold,
  [atrBreakout.id]: atrBreakout,
  [rangeBounce.id]: rangeBounce,
  [impulseFollow.id]: impulseFollow,
  [impulsePullback.id]: impulsePullback,
  [stopHuntReversal.id]: stopHuntReversal,
  [vwapRevert.id]: vwapRevert
}

/** Regime filter: (regime) => true = allow entry. Omitted strategy = no filter. */
const REGIME_FILTERS = {
  [emaCrossover.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [macd.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [multiEma.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [priceVsEma.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [rsiPullback.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [multiTfTrend.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [atrTrend.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [macdHistogram.id]: (r) => r.trend === 'trending',
  [volumeEmaCrossover.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [emaFastCrossover.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [rsiMacdCombo.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bullish',
  [shortTrend.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bearish',
  [shortBreakdown.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bearish',
  [shortMacd.id]: (r) => r.trend === 'trending' && r.trendDirection === 'bearish',
  [shortOverbought.id]: (r) => r.trendDirection === 'bearish',
  [shortRejection.id]: (r) => r.trendDirection === 'bearish' || r.trendDirection === 'neutral',
  [bollingerMeanRevert.id]: (r) => r.trend === 'ranging' || r.volatility === 'low',
  [rangeBounce.id]: (r) => r.trend === 'ranging' || r.volatility === 'low',
  [stochasticOversold.id]: (r) => r.trend === 'ranging' || (r.trend === 'trending' && r.trendDirection === 'bullish'),
  [bollingerSqueeze.id]: (r) => r.trend === 'trending',
  [donchianBreakout.id]: (r) => r.trend === 'trending',
  [atrBreakout.id]: (r) => r.trend === 'trending',
  [impulseFollow.id]: (r) => r.trend === 'trending',
  [impulsePullback.id]: (r) => r.trend === 'trending',
  [stopHuntReversal.id]: (r) => r.trend === 'ranging' || r.trend === 'weak',
  [vwapRevert.id]: (r) => r.trend === 'ranging' || r.trend === 'weak'
}

export const STRATEGY_IDS = Object.keys(strategies)

// Direction metadata for UI / analytics: 'long' | 'short' | 'both'
const STRATEGY_DIRECTIONS = {
  [emaCrossover.id]: 'long',
  [macd.id]: 'long',
  [multiEma.id]: 'long',
  [priceVsEma.id]: 'long',
  [rsiPullback.id]: 'long',
  [bollingerMeanRevert.id]: 'long',
  [multiTfTrend.id]: 'long',
  [atrTrend.id]: 'long',
  [shortTrend.id]: 'short',
  [shortBreakdown.id]: 'short',
  [shortOverbought.id]: 'short',
  [shortMacd.id]: 'short',
  [shortRejection.id]: 'short',
  [macdHistogram.id]: 'both',
  [volumeEmaCrossover.id]: 'long',
  [emaFastCrossover.id]: 'long',
  [rsiMacdCombo.id]: 'long',
  [bollingerSqueeze.id]: 'long',
  [donchianBreakout.id]: 'long',
  [stochasticOversold.id]: 'long',
  [atrBreakout.id]: 'long',
  [rangeBounce.id]: 'long',
  [impulseFollow.id]: 'both',
  [impulsePullback.id]: 'both',
  [stopHuntReversal.id]: 'both',
  [vwapRevert.id]: 'both'
}

export function getStrategy (id) {
  return strategies[id] ?? null
}

export function getStrategyDirection (id) {
  if (!id) return 'long'
  return STRATEGY_DIRECTIONS[id] || (id.startsWith('short_') ? 'short' : 'long')
}

/** True if this strategy is allowed to enter in the current regime (for dashboard highlighting). */
export function isRegimeActive (id, regime, regimeFilterEnabled) {
  if (!regimeFilterEnabled) return true
  if (!regime) return true
  const filter = REGIME_FILTERS[id]
  if (!filter) return true
  return !!filter(regime)
}

export function evaluateStrategy (id, ohlcv, state, context = {}) {
  const s = getStrategy(id)
  if (!s?.evaluate) return { action: 'hold', detail: {} }
  const lastClose = Array.isArray(ohlcv) && ohlcv.length ? ohlcv[ohlcv.length - 1][4] : null
  logger.debug(`evaluateStrategy: ${id} start`, {
    lastClose,
    hasOpenPosition: !!state?.openPosition,
    side: state?.openPosition?.side || null
  })
  const decision = s.evaluate(ohlcv, state, context)
  const action = decision?.action || 'hold'
  // Highlight whenever a strategy **requests** an entry/exit, regardless of
  // whether auto-trading, regime filter, or other constraints will actually
  // execute the trade.
  if (
    action === 'enter-long' ||
    action === 'enter-short' ||
    action === 'exit-long' ||
    action === 'exit-short'
  ) {
    logger.warn(`strategy-decision: ${id} requested ${action}`, {
      hasOpenPosition: !!state?.openPosition,
      side: state?.openPosition?.side || null,
      detail: decision?.detail || {},
      regime: context?.regime || null,
      regimeFilterEnabled: context?.regimeFilterEnabled !== false
    })
  }
  const regime = context?.regime
  const regimeFilterEnabled = context?.regimeFilterEnabled !== false
  const filter = REGIME_FILTERS[id]
  if (
    regimeFilterEnabled &&
    regime &&
    filter &&
    (action === 'enter-long' || action === 'enter-short') &&
    !filter(regime)
  ) {
    logger.debug(`evaluateStrategy: ${id} regime filter blocked entry`, { regime, action })
    return {
      action: 'hold',
      detail: { ...(decision?.detail || {}), regimeSkipped: true }
    }
  }
  logger.debug(`evaluateStrategy: ${id} result`, {
    action: decision?.action,
    detail: decision?.detail
  })
  return decision
}
