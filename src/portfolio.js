import { getTradingExchange } from './exchange.js'
import { logger } from './logger.js'
import { config } from './config.js'

const { symbol, assetsToLog } = config.trading

export async function logPortfolio (state) {
  try {
    const exchange = getTradingExchange()
    const balance = await exchange.fetchBalance()

    const lines = (assetsToLog || []).map(asset => {
      const total = balance.total?.[asset] ?? 0
      const free = balance.free?.[asset] ?? 0
      const used = balance.used?.[asset] ?? 0
      return `${asset}: total=${total}, free=${free}, used=${used}`
    })

    logger.info(`Portfolio balances (${assetsToLog.join(', ')}): ${lines.join(' | ')}`)
  } catch (err) {
    logger.error('Failed to fetch portfolio balances', err)
  }

  if (state?.openPosition) {
    const p = state.openPosition
    logger.info(
      `Open position: side=${p.side}, symbol=${p.symbol || symbol}, entry=${p.entryPrice}, amount=${p.amount}, SL=${p.stopLoss}, TP=${p.takeProfit}, lastPrice=${p.lastPrice}`
    )
  } else {
    logger.info('No open position in local state')
  }
}


