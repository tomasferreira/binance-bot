import { getTradingExchange } from './exchange.js'
import { logger } from './logger.js'
import { config } from './config.js'

const { symbol } = config.trading

export async function logOpenOrders () {
  try {
    const exchange = getTradingExchange()
    const orders = await exchange.fetchOpenOrders(symbol)

    if (!orders || orders.length === 0) {
      logger.debug(`Open orders (${symbol}): none`)
      return
    }

    const summary = orders
      .map(o => {
        const price = o.price || 'market'
        return `${o.id}: ${o.side} ${o.amount} @ ${price} status=${o.status}`
      })
      .join(' | ')

    logger.info(`Open orders (${symbol}): ${summary}`)
  } catch (err) {
    logger.error('Failed to fetch open orders', err)
  }
}

