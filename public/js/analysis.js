import { formatPnl, formatDate24h, formatTime24h } from './utils.js'
import { state } from './state.js'

const Chart = window.Chart

function streaksFromHistory (entries) {
  if (!entries?.length) return { consecutiveWins: 0, consecutiveLosses: 0, maxConsecutiveWins: 0, maxConsecutiveLosses: 0 }
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  let cw = 0; let cl = 0; let maxW = 0; let maxL = 0
  for (let i = pnls.length - 1; i >= 0; i--) {
    if (pnls[i] > 0) { cw++; cl = 0; if (cw > maxW) maxW = cw }
    else if (pnls[i] < 0) { cl++; cw = 0; if (cl > maxL) maxL = cl }
    else break
  }
  return { consecutiveWins: cw, consecutiveLosses: cl, maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL }
}

function maxDrawdownFromHistory (entries) {
  if (!entries?.length) return 0
  let peak = 0; let maxDd = 0; let cum = 0
  for (const e of entries) {
    cum += Number(e.pnl ?? 0)
    if (cum > peak) peak = cum
    const dd = peak - cum
    if (dd > maxDd) maxDd = dd
  }
  return maxDd
}

function timeInProfitPctFromHistory (entries) {
  if (!entries?.length) return null
  let peak = 0; let atNewHigh = 0; let cum = 0
  for (const e of entries) {
    cum += Number(e.pnl ?? 0)
    if (cum >= peak) { atNewHigh++; if (cum > peak) peak = cum }
  }
  return (atNewHigh / entries.length) * 100
}

function getMetricsForRange (s) {
  if (state.analysisTimeRange === 'all') {
    return {
      realizedPnl: s.realizedPnl ?? 0,
      unrealizedPnl: s.unrealizedPnl ?? 0,
      totalPnl: s.totalPnl ?? 0,
      wins: s.wins ?? 0,
      losses: s.losses ?? 0,
      trades: s.trades ?? 0,
      winRate: s.winRate,
      avgWin: s.avgWin,
      avgLoss: s.avgLoss,
      exposure: s.exposure,
      avgTradeDurationMs: s.avgTradeDurationMs,
      maxDrawdown: s.maxDrawdown
    }
  }
  const block = state.analysisTimeRange === 'sinceReset' ? (s.sinceReset || {}) : state.analysisTimeRange === 'last7d' ? (s.last7d || {}) : (s.last30d || {})
  const real = block.realizedPnl ?? 0
  const unreal = s.unrealizedPnl ?? 0
  return {
    realizedPnl: real,
    unrealizedPnl: unreal,
    totalPnl: real + unreal,
    wins: block.wins ?? 0,
    losses: block.losses ?? 0,
    trades: block.trades ?? 0,
    winRate: block.winRate ?? null,
    avgWin: block.avgWin ?? null,
    avgLoss: block.avgLoss ?? null,
    exposure: s.exposure,
    avgTradeDurationMs: s.avgTradeDurationMs,
    maxDrawdown: s.maxDrawdown
  }
}

function getFilteredHistoryForRange (s) {
  const history = Array.isArray(s.closedTradesHistory) ? s.closedTradesHistory : []
  if (state.analysisTimeRange === 'all') return history
  const now = Date.now()
  const now7d = now - 7 * 24 * 60 * 60 * 1000
  const now30d = now - 30 * 24 * 60 * 60 * 1000
  if (state.analysisTimeRange === 'sinceReset' && s.pnlResetAt) {
    const t0 = new Date(s.pnlResetAt).getTime()
    return history.filter(e => new Date(e.timestamp).getTime() >= t0)
  }
  if (state.analysisTimeRange === 'last7d') return history.filter(e => new Date(e.timestamp).getTime() >= now7d)
  if (state.analysisTimeRange === 'last30d') return history.filter(e => new Date(e.timestamp).getTime() >= now30d)
  return history
}

function computeSharpe (entries) {
  if (!entries.length) return null
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const variance = pnls.reduce((sum, p) => sum + (p - mean) ** 2, 0) / pnls.length
  const std = Math.sqrt(variance)
  if (std === 0) return null
  return mean / std
}

function computeSortino (entries) {
  if (!entries.length) return null
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length
  const negativeSquared = pnls.filter(p => p < 0).map(p => p * p)
  if (negativeSquared.length === 0) return mean > 0 ? Infinity : (mean < 0 ? -Infinity : null)
  const downsideVariance = negativeSquared.reduce((a, b) => a + b, 0) / negativeSquared.length
  const downsideStd = Math.sqrt(downsideVariance)
  if (downsideStd === 0) return null
  return mean / downsideStd
}

function computeExtraMetrics (entries, s) {
  const pnls = entries.map(e => Number(e.pnl ?? 0))
  const sumWins = pnls.filter(p => p > 0).reduce((a, b) => a + b, 0)
  const sumLosses = pnls.filter(p => p < 0).reduce((a, b) => a + b, 0)
  const profitFactor = sumLosses === 0 ? (sumWins > 0 ? Infinity : 0) : sumWins / Math.abs(sumLosses)
  const expectancy = pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null
  const winsOnly = pnls.filter(p => p > 0)
  const lossesOnly = pnls.filter(p => p < 0)
  const maxWin = winsOnly.length ? Math.max(...winsOnly) : null
  const maxLoss = lossesOnly.length ? Math.min(...lossesOnly) : null
  const sortino = computeSortino(entries)
  const now = Date.now()
  let daysInRange = 1
  if (state.analysisTimeRange === 'last7d') daysInRange = 7
  else if (state.analysisTimeRange === 'last30d') daysInRange = 30
  else if (state.analysisTimeRange === 'sinceReset' && s.pnlResetAt) daysInRange = Math.max(1, (now - new Date(s.pnlResetAt).getTime()) / (86400 * 1000))
  else if (entries.length >= 2) {
    const ts = entries.map(e => new Date(e.timestamp).getTime())
    daysInRange = Math.max(1, (Math.max(...ts) - Math.min(...ts)) / (86400 * 1000))
  }
  const tradesPerDay = entries.length && daysInRange > 0 ? entries.length / daysInRange : null
  const lastEntry = entries.length ? entries.reduce((a, b) => new Date(b.timestamp).getTime() > new Date(a.timestamp).getTime() ? b : a) : null
  const lastTradeTs = lastEntry ? new Date(lastEntry.timestamp).getTime() : null
  const lastTradeStr = lastEntry ? formatDate24h(lastEntry.timestamp) : '–'

  const realizedPnl = pnls.reduce((a, b) => a + b, 0)
  const maxDdInRange = maxDrawdownFromHistory(entries)
  const calmarRatio = maxDdInRange > 0 ? realizedPnl / maxDdInRange : null
  const recoveryFactor = maxDdInRange > 0 ? realizedPnl / maxDdInRange : null
  const streaks = streaksFromHistory(entries)
  const timeInProfitPct = timeInProfitPctFromHistory(entries)

  return {
    profitFactor,
    expectancy,
    maxWin,
    maxLoss,
    sortino,
    tradesPerDay,
    lastTradeStr,
    lastTradeTs,
    calmarRatio,
    recoveryFactor,
    maxDrawdownInRange: maxDdInRange,
    ...streaks,
    timeInProfitPct
  }
}

export async function updateAnalysisPanel (strategies) {
  const tbody = document.getElementById('analysis-tbody')
  if (!tbody) return
  state.analysisTimeRange = document.getElementById('analysis-time-range')?.value || 'sinceReset'
  try {
    const res = await fetch('/api/trades?limit=500')
    if (res.ok) {
      const data = await res.json()
      const list = Array.isArray(data.trades) ? data.trades : []
      const byStrategy = {}
      const now = Date.now()
      const range = state.analysisTimeRange
      list.forEach(t => {
        const id = t.strategyId || '_unknown_'
        let include = true
        if (range === 'last7d') include = (now - t.timestamp) <= 7 * 24 * 60 * 60 * 1000
        else if (range === 'last30d') include = (now - t.timestamp) <= 30 * 24 * 60 * 60 * 1000
        else if (range === 'sinceReset') {
          const strat = (strategies || []).find(s => s.id === id)
          const resetAt = strat?.pnlResetAt ? new Date(strat.pnlResetAt).getTime() : 0
          include = t.timestamp >= resetAt
        }
        if (!include) return
        if (!byStrategy[id]) byStrategy[id] = { count: 0, fee: 0 }
        byStrategy[id].count += 1
        if (t.fee && (t.fee.currency === 'USDT' || t.fee.currency === 'BNB')) byStrategy[id].fee += Number(t.fee.cost || 0)
      })
      state.analysisTradesData = byStrategy
    }
  } catch (e) { state.analysisTradesData = {} }

  const list = (strategies || []).map(s => {
    const m = getMetricsForRange(s)
    const hist = getFilteredHistoryForRange(s)
    const sharpe = computeSharpe(hist)
    const extra = computeExtraMetrics(hist, s)
    const td = state.analysisTradesData[s.id] || {}
    const typeTag = s.id && s.id.startsWith('short_') ? 'Short' : 'Long'
    return {
      ...s,
      _metrics: m,
      _typeTag: typeTag,
      _sharpe: sharpe,
      _tradesHistory: td.count || 0,
      _fees: td.fee || 0,
      _profitFactor: extra.profitFactor,
      _expectancy: extra.expectancy,
      _maxWin: extra.maxWin,
      _maxLoss: extra.maxLoss,
      _sortino: extra.sortino,
      _tradesPerDay: extra.tradesPerDay,
      _lastTradeStr: extra.lastTradeStr,
      _lastTradeTs: extra.lastTradeTs,
      _calmarRatio: extra.calmarRatio,
      _recoveryFactor: extra.recoveryFactor,
      _consecutiveWins: extra.consecutiveWins,
      _consecutiveLosses: extra.consecutiveLosses,
      _maxConsecutiveWins: extra.maxConsecutiveWins,
      _maxConsecutiveLosses: extra.maxConsecutiveLosses,
      _timeInProfitPct: extra.timeInProfitPct
    }
  })

  const sorted = [...list].sort((a, b) => {
    const sortKey = state.analysisSortBy === 'avgDuration' ? 'avgTradeDurationMs' : state.analysisSortBy
    const extraKeys = { type: '_typeTag', sharpe: '_sharpe', tradesHistory: '_tradesHistory', fees: '_fees', profitFactor: '_profitFactor', expectancy: '_expectancy', maxWin: '_maxWin', maxLoss: '_maxLoss', sortino: '_sortino', tradesPerDay: '_tradesPerDay', lastTrade: '_lastTradeTs', calmar: '_calmarRatio', recovery: '_recoveryFactor', timeInProfitPct: '_timeInProfitPct' }
    const extraKey = extraKeys[state.analysisSortBy]
    const va = extraKey ? (extraKey === '_lastTradeTs' ? a._lastTradeTs : a[extraKey]) : (state.analysisSortBy === 'currentDrawdownPct' || state.analysisSortBy === 'avgHoldTimeMin') ? a[state.analysisSortBy] : (a._metrics && a._metrics[sortKey]) != null ? a._metrics[sortKey] : a[state.analysisSortBy]
    const vb = extraKey ? (extraKey === '_lastTradeTs' ? b._lastTradeTs : b[extraKey]) : (state.analysisSortBy === 'currentDrawdownPct' || state.analysisSortBy === 'avgHoldTimeMin') ? b[state.analysisSortBy] : (b._metrics && b._metrics[sortKey]) != null ? b._metrics[sortKey] : b[state.analysisSortBy]
    if (state.analysisSortBy === 'name' || state.analysisSortBy === 'type') {
      const sa = (va ?? '').toString()
      const sb = (vb ?? '').toString()
      return state.analysisSortDesc ? sb.localeCompare(sa) : sa.localeCompare(sb)
    }
    const na = Number(va)
    const nb = Number(vb)
    if (state.analysisSortBy === 'winRate' || state.analysisSortBy === 'exposure' || state.analysisSortBy === 'avgDuration') {
      if (na != null && !isNaN(na) && nb != null && !isNaN(nb)) return state.analysisSortDesc ? na - nb : nb - na
      return ((nb != null && !isNaN(nb)) ? 1 : 0) - ((na != null && !isNaN(na)) ? 1 : 0)
    }
    if (na != null && !isNaN(na) && nb != null && !isNaN(nb)) return state.analysisSortDesc ? nb - na : na - nb
    return ((na != null && !isNaN(na)) ? -1 : 0) - ((nb != null && !isNaN(nb)) ? -1 : 0)
  })

  const pnlColor = (v) => {
    const n = v ?? 0
    if (Number.isNaN(n)) return ''
    if (n > 0) return '#22c55e'
    if (n < 0) return '#ef4444'
    return '#eab308' // neutral (zero) = yellow
  }
  const totalTradesInRange = sorted.reduce((sum, s) => sum + (s._metrics?.trades ?? 0), 0)
  const totalTradesEl = document.getElementById('analysis-total-trades')
  if (totalTradesEl) totalTradesEl.textContent = totalTradesInRange.toLocaleString()

  if (sorted.length === 0) {
    tbody.innerHTML = '<tr><td colspan="31">No strategies</td></tr>'
  } else {
    tbody.innerHTML = sorted.map(s => {
      const m = s._metrics
      const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const typeTag = s.id && s.id.startsWith('short_') ? 'Short' : 'Long'
      const winRatePct = m.winRate != null ? (m.winRate * 100).toFixed(1) : '–'
      const exposurePct = m.exposure != null ? (m.exposure * 100).toFixed(1) : '–'
      const avgDur = m.avgTradeDurationMs != null ? (m.avgTradeDurationMs < 60000 ? (m.avgTradeDurationMs / 1000).toFixed(0) + 's' : (m.avgTradeDurationMs / 60000).toFixed(1) + 'm') : '–'
      const sharpeStr = s._sharpe != null ? s._sharpe.toFixed(2) : '–'
      const pfStr = s._profitFactor != null ? (s._profitFactor === Infinity ? '∞' : s._profitFactor.toFixed(2)) : '–'
      const expStr = s._expectancy != null ? formatPnl(s._expectancy).replace(' USDT', '') : '–'
      const sortinoStr = s._sortino == null ? '–' : (s._sortino === Infinity ? '∞' : (s._sortino === -Infinity ? '-∞' : s._sortino.toFixed(2)))
      const tpdStr = s._tradesPerDay != null ? s._tradesPerDay.toFixed(1) : '–'
      const regimeActiveClass = s.regimeActive ? ' class="regime-active"' : ''
      return '<tr' + regimeActiveClass + '>' +
        '<td>' + name + '</td>' +
        '<td class="numeric">' + typeTag + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.totalPnl) + '">' + formatPnl(m.totalPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.realizedPnl) + '">' + formatPnl(m.realizedPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(m.unrealizedPnl) + '">' + formatPnl(m.unrealizedPnl).replace(' USDT', '') + '</td>' +
        '<td class="numeric">' + (m.wins ?? 0) + '/' + (m.losses ?? 0) + '</td>' +
        '<td class="numeric">' + winRatePct + '</td>' +
        '<td class="numeric" style="color:#22c55e">' + (m.avgWin != null ? formatPnl(m.avgWin).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (m.avgLoss != null ? formatPnl(m.avgLoss).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + sharpeStr + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (m.maxDrawdown != null ? formatPnl(m.maxDrawdown).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + (s._calmarRatio != null ? s._calmarRatio.toFixed(2) : '–') + '</td>' +
        '<td class="numeric">' + (s._recoveryFactor != null ? s._recoveryFactor.toFixed(2) : '–') + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (s.currentDrawdownPct != null && s.currentDrawdownPct > 0 ? s.currentDrawdownPct.toFixed(1) + '%' : '–') + '</td>' +
        '<td class="numeric">' + (m.trades ?? 0) + '</td>' +
        '<td class="numeric">' + (s._tradesHistory ?? 0) + '</td>' +
        '<td class="numeric">' + (s._fees != null ? s._fees.toFixed(4) : '–') + '</td>' +
        '<td class="numeric">' + exposurePct + '</td>' +
        '<td class="numeric">' + avgDur + '</td>' +
        '<td class="numeric">' + ((s._consecutiveWins > 0 ? s._consecutiveWins + 'W' : '') || (s._consecutiveLosses > 0 ? s._consecutiveLosses + 'L' : '') || '–') + '</td>' +
        '<td class="numeric">' + (s._maxConsecutiveWins > 0 || s._maxConsecutiveLosses > 0 ? (s._maxConsecutiveWins || 0) + ' / ' + (s._maxConsecutiveLosses || 0) : '–') + '</td>' +
        '<td class="numeric">' + (s.avgHoldTimeMin != null ? s.avgHoldTimeMin.toFixed(1) : '–') + '</td>' +
        '<td class="numeric">' + (s._fees != null && (m.trades ?? 0) > 0 ? (s._fees / m.trades).toFixed(4) : '–') + '</td>' +
        '<td class="numeric">' + (s._timeInProfitPct != null ? s._timeInProfitPct.toFixed(1) + '%' : '–') + '</td>' +
        '<td class="numeric">' + pfStr + '</td>' +
        '<td class="numeric" style="color:' + pnlColor(s._expectancy) + '">' + expStr + '</td>' +
        '<td class="numeric" style="color:#22c55e">' + (s._maxWin != null ? formatPnl(s._maxWin).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric" style="color:#ef4444">' + (s._maxLoss != null ? formatPnl(s._maxLoss).replace(' USDT', '') : '–') + '</td>' +
        '<td class="numeric">' + sortinoStr + '</td>' +
        '<td class="numeric">' + tpdStr + '</td>' +
        '<td class="numeric">' + (s._lastTradeStr || '–') + '</td></tr>'
    }).join('')
  }

  const winRateBySideEl = document.getElementById('analysis-winrate-by-side')
  if (winRateBySideEl && sorted.length > 0) {
    const longStrats = sorted.filter(s => !s.id.startsWith('short_'))
    const shortStrats = sorted.filter(s => s.id.startsWith('short_'))
    const agg = (arr) => {
      const wins = arr.reduce((a, s) => a + (s._metrics?.wins ?? 0), 0)
      const losses = arr.reduce((a, s) => a + (s._metrics?.losses ?? 0), 0)
      const trades = wins + losses
      const wr = trades > 0 ? (wins / trades * 100).toFixed(1) : '–'
      return { wins, losses, trades, wr }
    }
    const longAgg = agg(longStrats)
    const shortAgg = agg(shortStrats)
    winRateBySideEl.innerHTML =
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Long</span> <span style="color:#9ca3af">' + longAgg.wins + 'W / ' + longAgg.losses + 'L</span> · Win rate <span style="color:#22c55e">' + longAgg.wr + '%</span></div>' +
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Short</span> <span style="color:#9ca3af">' + shortAgg.wins + 'W / ' + shortAgg.losses + 'L</span> · Win rate <span style="color:#22c55e">' + shortAgg.wr + '%</span></div>'
  }

  const topBottomEl = document.getElementById('analysis-top-bottom')
  if (topBottomEl && sorted.length > 0) {
    const byPnl = [...sorted].sort((a, b) => (b._metrics.totalPnl ?? 0) - (a._metrics.totalPnl ?? 0))
    const top3 = byPnl.slice(0, 3)
    const bottom3 = byPnl.slice(-3).reverse()
    topBottomEl.innerHTML =
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Top 3</span><ul style="margin:0;padding-left:1.25rem;color:#22c55e">' +
      top3.map(s => '<li>' + (s.name || s.id) + ': ' + formatPnl(s._metrics.totalPnl).replace(' USDT', '') + '</li>').join('') + '</ul></div>' +
      '<div><span class="section-title" style="margin-bottom:0.25rem;">Bottom 3</span><ul style="margin:0;padding-left:1.25rem;color:#ef4444">' +
      bottom3.map(s => '<li>' + (s.name || s.id) + ': ' + formatPnl(s._metrics.totalPnl).replace(' USDT', '') + '</li>').join('') + '</ul></div>'
  }

  const labels = sorted.map(s => s.name || s.id)
  const pnlValues = sorted.map(s => s._metrics.totalPnl ?? 0)
  const winRateValues = sorted.map(s => s._metrics.winRate != null ? s._metrics.winRate * 100 : null)
  const barColorsPnl = pnlValues.map(v => (v >= 0 ? 'rgba(74, 222, 128, 0.8)' : 'rgba(248, 113, 113, 0.8)'))
  const barColorsWr = winRateValues.map(() => 'rgba(56, 189, 248, 0.7)')
  const chartOpts = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: {
      x: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } },
      y: { ticks: { color: '#9ca3af', font: { size: 10 } }, grid: { display: false } }
    }
  }
  const pnlCtx = document.getElementById('analysis-pnl-chart')?.getContext('2d')
  if (pnlCtx) {
    const pnlData = { labels, datasets: [{ label: 'Total PnL', data: pnlValues, backgroundColor: barColorsPnl }] }
    if (state.analysisPnlChart) {
      state.analysisPnlChart.data = pnlData
      state.analysisPnlChart.update()
    } else {
      state.analysisPnlChart = new Chart(pnlCtx, { type: 'bar', data: pnlData, options: chartOpts })
    }
  }
  const wrCtx = document.getElementById('analysis-winrate-chart')?.getContext('2d')
  if (wrCtx) {
    const wrData = { labels, datasets: [{ label: 'Win rate %', data: winRateValues, backgroundColor: barColorsWr }] }
    const wrOpts = { ...chartOpts, scales: { ...chartOpts.scales, x: { ...chartOpts.scales.x, min: 0, max: 100 } } }
    if (state.analysisWinrateChart) {
      state.analysisWinrateChart.data = wrData
      state.analysisWinrateChart.options = wrOpts
      state.analysisWinrateChart.update()
    } else {
      state.analysisWinrateChart = new Chart(wrCtx, { type: 'bar', data: wrData, options: wrOpts })
    }
  }

  const equitySelect = document.getElementById('analysis-equity-strategy')
  const equityCtx = document.getElementById('analysis-equity-chart')?.getContext('2d')
  const savedEquityStrategyId = equitySelect?.value || null
  if (equitySelect) {
    const opts = (strategies || []).map(s => '<option value="' + s.id + '">' + (s.name || s.id) + '</option>').join('')
    equitySelect.innerHTML = opts || '<option value="">—</option>'
    if (savedEquityStrategyId && (strategies || []).some(s => s.id === savedEquityStrategyId)) {
      equitySelect.value = savedEquityStrategyId
    }
  }
  if (equityCtx) {
    const selectedId = equitySelect?.value || (strategies && strategies[0]?.id)
    const sel = (strategies || []).find(s => s.id === selectedId)
    const history = sel ? getFilteredHistoryForRange(sel) : []
    let cum = 0
    const equityLabels = history.map(e => formatDate24h(e.timestamp, { includeAgo: false }))
    const equityData = history.map(e => { cum += Number(e.pnl ?? 0); return cum })
    const eqData = { labels: equityLabels, datasets: [{ label: 'Cumulative PnL', data: equityData, borderColor: '#22c55e', backgroundColor: 'rgba(34,197,94,0.1)', fill: true, tension: 0.2 }] }
    const eqOpts = {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#9ca3af', maxTicksLimit: 8 }, grid: { display: false } },
        y: { ticks: { color: '#9ca3af' }, grid: { color: '#1f2937' } }
      }
    }
    if (state.analysisEquityChart) {
      state.analysisEquityChart.data = eqData
      state.analysisEquityChart.update()
    } else {
      state.analysisEquityChart = new Chart(equityCtx, { type: 'line', data: eqData, options: eqOpts })
    }
  }
}
