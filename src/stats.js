/**
 * Aggregate stats from closed-trade history entries (each has pnl).
 * @param {Array<{ pnl?: number }>} entries
 * @returns {{ realizedPnl: number, wins: number, losses: number, trades: number, winRate: number|null, avgWin: number|null, avgLoss: number|null }}
 */
export function statsFromHistory (entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { realizedPnl: 0, wins: 0, losses: 0, trades: 0, winRate: null, avgWin: null, avgLoss: null }
  }
  const realizedPnl = entries.reduce((sum, e) => sum + Number(e.pnl ?? 0), 0)
  const wins = entries.filter(e => (e.pnl ?? 0) > 0).length
  const losses = entries.filter(e => (e.pnl ?? 0) < 0).length
  const trades = entries.length
  const totalWinPnl = entries.filter(e => (e.pnl ?? 0) > 0).reduce((s, e) => s + e.pnl, 0)
  const totalLossPnl = entries.filter(e => (e.pnl ?? 0) < 0).reduce((s, e) => s + e.pnl, 0)
  return {
    realizedPnl,
    wins,
    losses,
    trades,
    winRate: trades > 0 ? wins / trades : null,
    avgWin: wins > 0 ? totalWinPnl / wins : null,
    avgLoss: losses > 0 ? totalLossPnl / losses : null
  }
}

/**
 * Consecutive win/loss streaks from history (pnl array).
 * @param {Array<{ pnl?: number }>} entries
 * @returns {{ consecutiveWins: number, consecutiveLosses: number, maxConsecutiveWins: number, maxConsecutiveLosses: number }}
 */
export function streaksFromHistory (entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { consecutiveWins: 0, consecutiveLosses: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0 }
  }
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  let consecutiveWins = 0
  let consecutiveLosses = 0
  let maxConsecutiveWins = 0
  let maxConsecutiveLosses = 0
  for (let i = pnls.length - 1; i >= 0; i--) {
    if (pnls[i] > 0) {
      consecutiveWins++
      consecutiveLosses = 0
      if (consecutiveWins > maxConsecutiveWins) maxConsecutiveWins = consecutiveWins
    } else if (pnls[i] < 0) {
      consecutiveLosses++
      consecutiveWins = 0
      if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses
    } else {
      break
    }
  }
  return { consecutiveWins, consecutiveLosses, maxConsecutiveWins, maxConsecutiveLosses }
}

/**
 * Max drawdown from equity curve (cumulative pnl).
 * @param {Array<{ pnl?: number }>} entries
 * @returns {number}
 */
export function maxDrawdownFromHistory (entries) {
  if (!Array.isArray(entries) || entries.length === 0) return 0
  let peak = 0
  let maxDd = 0
  let cum = 0
  for (const e of entries) {
    cum += Number(e.pnl ?? 0)
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

/**
 * % of trades where equity was at a new high (time in profit).
 * @param {Array<{ pnl?: number }>} entries
 * @returns {number|null} 0-100 or null
 */
export function timeInProfitPctFromHistory (entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null
  let peak = 0
  let atNewHigh = 0
  let cum = 0
  for (const e of entries) {
    cum += Number(e.pnl ?? 0)
    if (cum >= peak) {
      atNewHigh++
      if (cum > peak) peak = cum
    }
  }
  return (atNewHigh / entries.length) * 100
}
