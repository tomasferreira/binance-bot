import dotenv from 'dotenv'

dotenv.config()

export const config = {
  binance: {
    apiKey: process.env.BINANCE_API_KEY || '',
    secret: process.env.BINANCE_API_SECRET || '',
    testnet: process.env.TESTNET !== 'false'
  },
  trading: {
    symbol: process.env.SYMBOL || 'BTC/USDT',
    timeframe: process.env.TIMEFRAME || '15m',
    pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 60_000),
    riskPerTrade: Number(process.env.RISK_PER_TRADE || 0.01), // 1%
    stopLossPct: Number(process.env.STOP_LOSS_PCT || 0.02), // 2%
    takeProfitPct: Number(process.env.TAKE_PROFIT_PCT || 0.04), // 4%
    // Fee per side (decimal, e.g. 0.001 = 0.1%). Used for position sizing and SL/TP.
    feeRatePct: Number(process.env.FEE_RATE_PCT || 0.001),
    testingMode: process.env.TESTING_MODE === 'true',
    assetsToLog: (process.env.ASSETS_TO_LOG || 'BTC,USDT')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  },
  paths: {
    stateFile: new URL('../data/state.json', import.meta.url).pathname,
    logDir: new URL('../logs', import.meta.url).pathname
  }
}

