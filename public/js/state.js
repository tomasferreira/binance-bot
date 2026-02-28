/** Shared mutable state for the dashboard. */
export const state = {
  priceChart: null,
  macdChart: null,
  analysisPnlChart: null,
  analysisWinrateChart: null,
  analysisEquityChart: null,
  analysisSortBy: 'totalPnl',
  analysisSortDesc: true,
  analysisTimeRange: 'sinceReset',
  analysisTradesData: {},
  selectedStrategyId: null,
  latestTrades: [],
  chartWindowSize: 500,
  lastCandles: [],
  customWindow: null,
  activityEvents: [],
  lastStrategySnapshot: {},
  activityInitialized: false,
  latestStrategies: []
}
