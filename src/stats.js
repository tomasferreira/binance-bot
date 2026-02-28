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
