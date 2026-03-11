import { formatAmount, formatPnl } from './utils.js'
import { state } from './state.js'

export function updateChartFocusLabel () {
  const el = document.getElementById('chart-focus-label')
  if (!el) return
  if (!state.selectedStrategyId) {
    el.textContent = '— (select a strategy to focus chart)'
    el.style.color = '#9ca3af'
    return
  }
  const strat = state.latestStrategies.find(s => s.id === state.selectedStrategyId)
  const name = strat ? (strat.name || strat.id) : state.selectedStrategyId
  el.textContent = name
  el.style.color = '#22c55e'
}

export function strategyDetailHtml (s) {
  if (!s) return ''
  const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const desc = (s.description || '').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const posText = s.position?.open ? s.position.side + ' ' + formatAmount(s.position.amount) : 'Flat'
  const pnlColor = (v) => {
    const n = v ?? 0
    if (Number.isNaN(n)) return ''
    if (n > 0) return '#22c55e'
    if (n < 0) return '#ef4444'
    return '#eab308' // neutral (zero) = yellow
  }
  const r = s.realizedPnl ?? 0
  const u = s.unrealizedPnl ?? 0
  const wins = s.wins ?? 0
  const losses = s.losses ?? 0
  const exposurePct = s.exposure != null ? (s.exposure * 100).toFixed(1) + '%' : '–'
  const hasPosition = s.position?.open === true
  const isShort = s.id && s.id.startsWith('short_')
  let actions = ''
  if (s.id !== 'manual') {
    actions += '<button class="secondary strategy-btn" data-id="' + s.id + '" data-running="' + s.running + '">' + (s.running ? 'Stop' : 'Start') + '</button> '
  }
  if (!isShort) {
    actions += '<button class="primary strategy-buy-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Open long</button> '
  } else {
    actions += '<button class="primary strategy-short-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Open short</button> '
  }
  actions += '<button class="danger strategy-sell-btn" data-id="' + s.id + '"' + (!hasPosition ? ' disabled' : '') + '>Close</button> '
  actions += '<button class="secondary strategy-reset-pnl-btn" data-id="' + s.id + '">Reset stats & trades</button>'
  return '<div class="section-title">' + name + '</div>' +
    (desc ? '<p style="margin:0.5rem 0; font-size:0.85rem; color:#9ca3af">' + desc + '</p>' : '') +
    '<div class="row"><span class="label">Status</span><span class="value">' + (s.running ? 'Running' : 'Stopped') + '</span></div>' +
    '<div class="row"><span class="label">W/L</span><span class="value">' + wins + ' / ' + losses + '</span></div>' +
    '<div class="row"><span class="label">Realized</span><span class="value" style="color:' + pnlColor(r) + '">' + formatPnl(s.realizedPnl).replace(' USDT', '') + '</span></div>' +
    '<div class="row"><span class="label">Unrealized</span><span class="value" style="color:' + pnlColor(u) + '">' + formatPnl(s.unrealizedPnl).replace(' USDT', '') + '</span></div>' +
    '<div class="row"><span class="label">Exposure</span><span class="value">' + exposurePct + '</span></div>' +
    '<div class="row"><span class="label">Position</span><span class="value">' + posText + '</span></div>' +
    '<div class="row"><span class="label">Last decision</span><span class="value">' + (s.lastDecision || '–') + '</span></div>' +
    '<div style="margin-top:0.75rem">' + actions + '</div>'
}

/**
 * Renders the strategies table and detail pane. callbacks.onStrategySelect(id, strategies) when a row is clicked.
 */
export function updateStrategiesPanel (strategies, callbacks) {
  const tbody = document.getElementById('strategies-tbody')
  const detailPane = document.getElementById('strategy-detail-pane')
  if (!tbody) return
  if (strategies.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6">No strategies</td></tr>'
    return
  }
  const sorted = [...strategies].sort((a, b) => {
    const aShort = a.id && a.id.startsWith('short_')
    const bShort = b.id && b.id.startsWith('short_')
    if (aShort !== bShort) return aShort ? 1 : -1
    return (a.name || a.id).localeCompare(b.name || b.id)
  })
  tbody.innerHTML = sorted.map(s => {
    const posText = s.position?.open ? s.position.side + ' ' + formatAmount(s.position.amount) : 'Flat'
    const runningPill = s.running ? 'Running' : 'Stopped'
    const hasPosition = s.position?.open === true
    const isManual = s.id === 'manual'
    const direction = s.direction || (s.id && s.id.startsWith('short_') ? 'short' : 'long')
    const isShort = direction === 'short'
    const isBoth = direction === 'both'
    const startStopBtn = s.id === 'manual' ? '' : '<button class="secondary strategy-btn" data-id="' + s.id + '" data-running="' + s.running + '">' + (s.running ? 'Stop' : 'Start') + '</button> '
    const buyBtn = (!isShort || isBoth) ? '<button class="primary strategy-buy-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Long</button> ' : ''
    const shortBtn = (isShort || isBoth) ? '<button class="primary strategy-short-btn" data-id="' + s.id + '"' + (hasPosition ? ' disabled' : '') + '>Short</button> ' : ''
    const sellBtn = '<button class="danger strategy-sell-btn" data-id="' + s.id + '"' + (!hasPosition ? ' disabled' : '') + '>Close</button> '
    const resetBtn = '<button class="secondary strategy-reset-pnl-btn" data-id="' + s.id + '">Reset stats & trades</button>'
    const name = (s.name || s.id).replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const typeTag =
      isManual ? 'Utility'
        : direction === 'both' ? 'Both'
          : direction === 'short' ? 'Short'
            : 'Long'
    const selected = s.id === state.selectedStrategyId ? ' selected' : ''
    const regimeActive = s.regimeActive ? ' regime-active' : ''
    return '<tr class="clickable' + selected + regimeActive + '" data-strategy-id="' + s.id + '">' +
      '<td>' + name + '</td>' +
      '<td>' + typeTag + '</td>' +
      '<td>' + runningPill + '</td>' +
      '<td>' + posText + '</td>' +
      '<td>' + (s.lastDecision || '–') + '</td>' +
      '<td>' + startStopBtn + buyBtn + shortBtn + sellBtn + resetBtn + '</td></tr>'
  }).join('')
  tbody.querySelectorAll('tr[data-strategy-id]').forEach(tr => {
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return
      const id = tr.dataset.strategyId || null
      if (callbacks?.onStrategySelect) callbacks.onStrategySelect(id, strategies)
    })
  })
  const selectedStrat = strategies.find(s => s.id === state.selectedStrategyId)
  if (detailPane) {
    if (selectedStrat) {
      detailPane.classList.remove('empty')
      detailPane.innerHTML = strategyDetailHtml(selectedStrat)
    } else {
      detailPane.classList.add('empty')
      detailPane.innerHTML = 'Click a strategy row to see details.'
    }
  }
}
