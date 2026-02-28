export function formatBoolPill (value) {
  const cls = value ? 'status-pill pill-ok' : 'status-pill pill-warn'
  const label = value ? 'ON' : 'OFF'
  return '<span class="' + cls + '">' + label + '</span>'
}

export function formatPrice (n) {
  if (n == null || isNaN(n)) return '–'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatAmount (n) {
  if (n == null || isNaN(n)) return '–'
  const x = Number(n)
  return x >= 1 ? x.toLocaleString(undefined, { maximumFractionDigits: 2 })
    : x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })
}

export function formatQuote (n) {
  if (n == null || isNaN(n)) return '–'
  return Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPnl (n) {
  if (n == null || isNaN(n)) return '–'
  const x = Number(n)
  const s = x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT'
  return x > 0 ? '+' + s : x < 0 ? s : s
}

export function escapeHtml (str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
