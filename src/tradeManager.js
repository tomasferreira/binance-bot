import { config } from './config.js'
import { getExchange } from './exchange.js'
import { calculatePositionSize } from './risk.js'
import { getEffectiveTradingConfig } from './runtimeConfig.js'
import { logger } from './logger.js'
import { recordOrderStrategy } from './orderStrategy.js'
import { loadState } from './stateMulti.js'

const { symbol, feeRatePct, closedTradesHistoryLimit } = config.trading
const feeRate = typeof feeRatePct === 'number' && feeRatePct >= 0 ? feeRatePct : 0

export async function syncBalanceQuote () {
  const exchange = getExchange()
  logger.debug('exchange.fetchBalance request', { symbol })
  const balance = await exchange.fetchBalance()
  logger.debug('exchange.fetchBalance response', {
    total: balance.total,
    free: balance.free,
    used: balance.used
  })
  const quoteCurrency = symbol.split('/')[1]
  const quoteInfo = balance.total?.[quoteCurrency] ?? balance.free?.[quoteCurrency]
  const quoteBalance = Number(quoteInfo || 0)
  logger.debug('syncBalanceQuote result', { quoteCurrency, quoteBalance })
  return quoteBalance
}

/**
 * Internal: open a long or short position. SL/TP and order side depend on side.
 * @param {'long'|'short'} side
 */
async function openPosition (state, marketPrice, side, strategyId, entryDetail, budgetQuote) {
  const exchange = getExchange()
  const quoteBalance = (budgetQuote != null && budgetQuote > 0) ? budgetQuote : await syncBalanceQuote()
  if (!quoteBalance) {
    logger.warn(`No quote balance available; cannot open ${side} position`)
    return state
  }

  const { riskPerTrade: effectiveRiskPerTrade, stopLossPct: effectiveStopLossPct, takeProfitPct: effectiveTakeProfitPct } = getEffectiveTradingConfig(state)

  let stopLossPrice, takeProfitPrice
  if (side === 'long') {
    stopLossPrice = marketPrice * (1 - effectiveStopLossPct + feeRate) / (1 + feeRate)
    takeProfitPrice = marketPrice * (1 + effectiveTakeProfitPct + 2 * feeRate)
  } else {
    stopLossPrice = marketPrice * (1 + effectiveStopLossPct)
    takeProfitPrice = marketPrice * (1 - effectiveTakeProfitPct)
  }

  logger.debug(`openPosition(${side}): computed risk config`, {
    strategyId,
    marketPrice,
    quoteBalance,
    stopLossPrice,
    takeProfitPrice
  })

  let amount = calculatePositionSize({
    balanceQuote: quoteBalance,
    entryPrice: marketPrice,
    stopLossPrice,
    riskPerTrade: effectiveRiskPerTrade,
    feeRatePct: feeRate
  })

  if (amount <= 0) {
    logger.warn(`Calculated zero or negative position size for ${side}; skipping trade`)
    return state
  }

  if (budgetQuote != null && budgetQuote > 0) {
    const maxAmountByBudget = budgetQuote / marketPrice
    if (amount > maxAmountByBudget) {
      amount = Math.floor(maxAmountByBudget * 1e6) / 1e6
      logger.debug(`openPosition(${side}): capped amount to budget`, { amount })
    }
  }

  if (amount <= 0) {
    logger.warn(`Position size zero after budget cap for ${side}; skipping trade`)
    return state
  }

  const sideLabel = side.toUpperCase()
  logger.info(`Opening ${sideLabel} position on ${symbol} at ${marketPrice}, amount ${amount}, SL ${stopLossPrice}, TP ${takeProfitPrice}`)

  const order = side === 'long'
    ? await exchange.createMarketBuyOrder(symbol, amount)
    : await exchange.createMarketSellOrder(symbol, amount)
  logger.info(`Market ${side === 'long' ? 'BUY' : 'SELL'} order placed: id=${order.id}, status=${order.status}`)

  const recordReason = strategyId === 'manual' ? 'Manual' : (side === 'short' ? 'Short entry' : 'Entry')
  if (strategyId) recordOrderStrategy(order.id, strategyId, recordReason, entryDetail ?? null)

  const newPosition = {
    side,
    symbol,
    entryPrice: marketPrice,
    amount,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    openedAt: new Date().toISOString(),
    lastPrice: marketPrice
  }

  const positionsOpened = (state.positionsOpened ?? 0) + 1
  return { ...state, openPosition: newPosition, lastSignal: side, positionsOpened }
}

export async function openLongPosition (state, marketPrice, strategyId = null, entryDetail = null, budgetQuote = null) {
  return openPosition(state, marketPrice, 'long', strategyId, entryDetail, budgetQuote)
}

export async function openShortPosition (state, marketPrice, strategyId = null, entryDetail = null, budgetQuote = null) {
  return openPosition(state, marketPrice, 'short', strategyId, entryDetail, budgetQuote)
}

// Immediately closes any open position at market, ignoring SL/TP levels.
export async function closePositionNow (state, marketPrice, strategyId = null, reason = 'Manual close', exitDetail = null) {
  const position = state.openPosition
  if (!position) return state

  const { side, amount } = position
  if (!amount || amount <= 0) {
    return state
  }

  // Avoid duplicate close: re-read state from disk; if already closed, skip order
  if (strategyId) {
    const fresh = loadState(strategyId)
    if (!fresh.openPosition) {
      logger.warn(`[${strategyId}] Skipping close - position already closed (state on disk)`)
      return fresh
    }
  }

  const exchange = getExchange()
  const orderSide = side === 'short' ? 'buy' : 'sell'

  logger.info(
    `Manual CLOSE ${side.toUpperCase()} position at marketPrice=${marketPrice}, entry=${position.entryPrice}, amount=${amount}`
  )

  if (orderSide === 'sell') {
    logger.debug('exchange.createMarketSellOrder request (close)', { symbol, amount })
  } else {
    logger.debug('exchange.createMarketBuyOrder request (close)', { symbol, amount })
  }
  const order = orderSide === 'sell'
    ? await exchange.createMarketSellOrder(symbol, amount)
    : await exchange.createMarketBuyOrder(symbol, amount)
  logger.debug('exchange market order response (close)', { orderSide, order })
  logger.info(`Market ${orderSide.toUpperCase()} order placed: id=${order.id}, status=${order.status}`)

  const pnl = side === 'short'
    ? (position.entryPrice - marketPrice) * amount
    : (marketPrice - position.entryPrice) * amount
  if (strategyId) recordOrderStrategy(order.id, strategyId, reason, exitDetail ?? null, pnl)
  const realizedPnl = (state.realizedPnl ?? 0) + pnl
  logger.info(`Closed position PnL: ${pnl.toFixed(2)} USDT, realized total: ${realizedPnl.toFixed(2)}`)
  let wins = state.wins ?? 0
  let losses = state.losses ?? 0
  let totalWinPnl = state.totalWinPnl ?? 0
  let totalLossPnl = state.totalLossPnl ?? 0
  if (pnl > 0) {
    wins++
    totalWinPnl += pnl
  } else if (pnl < 0) {
    losses++
    totalLossPnl += pnl
  }

  const openedAtMs = position.openedAt ? Date.parse(position.openedAt) : null
  const closedAtMs = Date.now()
  let closedTrades = state.closedTrades ?? 0
  let totalTradeDurationMs = state.totalTradeDurationMs ?? 0
  let firstTradeAt = state.firstTradeAt ?? (position.openedAt || null)
  if (openedAtMs != null && Number.isFinite(openedAtMs)) {
    const dur = Math.max(0, closedAtMs - openedAtMs)
    totalTradeDurationMs += dur
    closedTrades += 1
  }

  let peakEquity = state.peakEquity ?? 0
  let maxDrawdown = state.maxDrawdown ?? 0
  const equity = realizedPnl
  if (equity > peakEquity) {
    peakEquity = equity
  } else {
    const dd = equity - peakEquity
    if (dd < maxDrawdown) maxDrawdown = dd
  }

  const closedTradesHistory = Array.isArray(state.closedTradesHistory) ? state.closedTradesHistory : []
  closedTradesHistory.push({ timestamp: new Date().toISOString(), pnl })
  const maxHistory = Math.max(100, closedTradesHistoryLimit || 500)
  const trimmed = closedTradesHistory.length > maxHistory ? closedTradesHistory.slice(-maxHistory) : closedTradesHistory

  return {
    ...state,
    openPosition: null,
    realizedPnl,
    wins,
    losses,
    totalWinPnl,
    totalLossPnl,
    closedTrades,
    totalTradeDurationMs,
    firstTradeAt,
    peakEquity,
    maxDrawdown,
    closedTradesHistory: trimmed
  }
}

export async function maybeClosePosition (state, marketPrice, strategyId = null) {
  const position = state.openPosition
  if (!position) return state

  const { side, stopLoss, takeProfit } = position

  let shouldStop = false
  let shouldTakeProfit = false

  if (side === 'long') {
    shouldStop = stopLoss != null && marketPrice <= stopLoss
    shouldTakeProfit = takeProfit != null && marketPrice >= takeProfit
  } else if (side === 'short') {
    shouldStop = stopLoss != null && marketPrice >= stopLoss
    shouldTakeProfit = takeProfit != null && marketPrice <= takeProfit
  }

  if (!shouldStop && !shouldTakeProfit) {
    return { ...state, openPosition: { ...position, lastPrice: marketPrice } }
  }

  const closeReason = shouldStop ? 'Stop loss' : 'Take profit'
  const slTpDetail = {
    marketPrice,
    entryPrice: position.entryPrice,
    trigger: shouldStop ? 'stop_loss' : 'take_profit'
  }

  return closePositionNow(state, marketPrice, strategyId, closeReason, slTpDetail)
}

