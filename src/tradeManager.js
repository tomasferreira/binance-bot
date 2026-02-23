import { config } from './config.js'
import { getExchange } from './exchange.js'
import { calculatePositionSize } from './risk.js'
import { logger } from './logger.js'

const { symbol, riskPerTrade, stopLossPct, takeProfitPct } = config.trading

export async function syncBalanceQuote () {
  const exchange = getExchange()
  const balance = await exchange.fetchBalance()
  const quoteCurrency = symbol.split('/')[1]
  const quoteInfo = balance.total?.[quoteCurrency] ?? balance.free?.[quoteCurrency]
  const quoteBalance = Number(quoteInfo || 0)
  logger.info(`Balance ${quoteCurrency}: ${quoteBalance}`)
  return quoteBalance
}

export async function openLongPosition (state, marketPrice) {
  const exchange = getExchange()

  const quoteBalance = await syncBalanceQuote()
  if (!quoteBalance) {
    logger.warn('No quote balance available; cannot open position')
    return state
  }

  const stopLossPrice = marketPrice * (1 - stopLossPct)
  const takeProfitPrice = marketPrice * (1 + takeProfitPct)

  const amount = calculatePositionSize({
    balanceQuote: quoteBalance,
    entryPrice: marketPrice,
    stopLossPrice,
    riskPerTrade
  })

  if (amount <= 0) {
    logger.warn('Calculated zero or negative position size; skipping trade')
    return state
  }

  logger.info(
    `Opening LONG position on ${symbol} at ${marketPrice}, amount ${amount}, SL ${stopLossPrice}, TP ${takeProfitPrice}`
  )

  const order = await exchange.createMarketBuyOrder(symbol, amount)
  logger.info(`Market BUY order placed: id=${order.id}, status=${order.status}`)

  const newPosition = {
    side: 'long',
    symbol,
    entryPrice: marketPrice,
    amount,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    openedAt: new Date().toISOString(),
    lastPrice: marketPrice
  }

  return { ...state, openPosition: newPosition, lastSignal: 'long' }
}

export async function maybeClosePosition (state, marketPrice) {
  const position = state.openPosition
  if (!position) return state

  const exchange = getExchange()

  const { side, amount, stopLoss, takeProfit } = position

  if (side !== 'long') {
    // In this simple bot we only manage long positions
    return state
  }

  const shouldStop = marketPrice <= stopLoss
  const shouldTakeProfit = marketPrice >= takeProfit

  if (!shouldStop && !shouldTakeProfit) {
    return { ...state, openPosition: { ...position, lastPrice: marketPrice } }
  }

  const reason = shouldStop ? 'STOP LOSS' : 'TAKE PROFIT'
  logger.info(
    `Closing LONG position due to ${reason} at marketPrice=${marketPrice}, entry=${position.entryPrice}`
  )

  const order = await exchange.createMarketSellOrder(symbol, amount)
  logger.info(`Market SELL order placed: id=${order.id}, status=${order.status}`)

  return { ...state, openPosition: null }
}

