let priceChart = null
let volumeChart = null
let candleSeries = null
let candleMarkers = null
let volumeSeries = null
let ma7Series = null
let ma25Series = null
let ma99Series = null
/** Last markers set (re-apply on zoom). */
let lastTradeMarkers = []
/** Candle + MA data for visible price range (excludes markers). */
let lastChartPriceData = []

function ensureLib () {
  if (!window.LightweightCharts) return null
  return window.LightweightCharts
}

const PRICE_RANGE_MARGIN = 0.02

function applyPriceRangeFromData (visibleFrom, visibleTo) {
  if (!priceChart || !lastChartPriceData.length) return
  const priceScale = priceChart.priceScale && priceChart.priceScale('right')
  if (!priceScale || typeof priceScale.setVisibleRange !== 'function') return
  const inRange = lastChartPriceData.filter(d => d.time >= visibleFrom && d.time <= visibleTo)
  if (!inRange.length) return
  let minP = Infinity
  let maxP = -Infinity
  for (const d of inRange) {
    if (d.ema7 != null) { if (d.ema7 < minP) minP = d.ema7; if (d.ema7 > maxP) maxP = d.ema7 }
    if (d.ema25 != null) { if (d.ema25 < minP) minP = d.ema25; if (d.ema25 > maxP) maxP = d.ema25 }
    if (d.ema99 != null) { if (d.ema99 < minP) minP = d.ema99; if (d.ema99 > maxP) maxP = d.ema99 }
  }
  if (!Number.isFinite(minP) || !Number.isFinite(maxP)) return
  const span = Math.max(maxP - minP, 0) || 1
  const margin = span * PRICE_RANGE_MARGIN
  priceScale.setVisibleRange({ from: minP - margin, to: maxP + margin })
}

export function initFinancialChart () {
  const lib = ensureLib()
  const priceContainer = document.getElementById('financial-price-chart-container')
  const volumeContainer = document.getElementById('financial-volume-chart-container')
  if (!lib || !priceContainer || !volumeContainer) return
  if (priceChart && volumeChart) return

  const {
    createChart,
    CrosshairMode,
    createSeriesMarkers,
    CandlestickSeries,
    HistogramSeries,
    LineSeries
  } = lib

  const priceWidth = priceContainer.clientWidth || 600
  const volumeWidth = volumeContainer.clientWidth || priceWidth

  // Price chart (candles + MAs)
  priceChart = createChart(priceContainer, {
    width: priceWidth,
    height: 360,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#e5e7eb'
    },
    grid: {
      vertLines: { color: '#0f172a' },
      horzLines: { color: '#0f172a' }
    },
    rightPriceScale: {
      borderColor: '#1f2937',
      autoScale: false,
      scaleMargins: { top: 0.1, bottom: 0.1 }
    },
    timeScale: {
      borderColor: '#1f2937',
      timeVisible: true,
      secondsVisible: false
    },
    crosshair: {
      mode: CrosshairMode.Normal
    }
  })

  candleSeries = priceChart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444',
    priceLineVisible: false
  })

  if (typeof createSeriesMarkers === 'function') {
    candleMarkers = createSeriesMarkers(candleSeries, [])
    const timeScale = priceChart.timeScale && priceChart.timeScale()
    if (timeScale && typeof timeScale.subscribeVisibleTimeRangeChange === 'function') {
      timeScale.subscribeVisibleTimeRangeChange(() => {
        const range = timeScale.getVisibleRange && timeScale.getVisibleRange()
        if (!range) return
        const from = range.from
        const to = range.to
        if (candleMarkers && lastTradeMarkers.length) {
          const inRange = lastTradeMarkers.filter(m => m.time >= from && m.time <= to)
          candleMarkers.setMarkers(inRange)
        }
        applyPriceRangeFromData(from, to)
      })
    }
  }

  ma7Series = priceChart.addSeries(LineSeries, {
    color: '#eab308', // MA(7) - yellow
    lineWidth: 2,
    priceLineVisible: false
  })

  ma25Series = priceChart.addSeries(LineSeries, {
    color: '#6366f1', // MA(25) - indigo
    lineWidth: 2,
    priceLineVisible: false
  })

  ma99Series = priceChart.addSeries(LineSeries, {
    color: '#f97316', // MA(99) - orange
    lineWidth: 2,
    priceLineVisible: false
  })

  // Volume chart (separate panel)
  volumeChart = createChart(volumeContainer, {
    width: volumeWidth,
    height: 140,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#9ca3af'
    },
    grid: {
      vertLines: { color: '#0f172a' },
      horzLines: { color: '#020617' }
    },
    rightPriceScale: {
      borderColor: '#1f2937'
    },
    timeScale: {
      borderColor: '#1f2937',
      timeVisible: false,
      secondsVisible: false
    },
    crosshair: {
      mode: CrosshairMode.Normal
    }
  })

  volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceScaleId: 'volume',
    priceFormat: { type: 'volume' },
    scaleMargins: { top: 0.05, bottom: 0.05 },
    color: '#1d4ed8',
    priceLineVisible: false
  })

  // Marker tooltip on hover
  const markerTooltip = document.createElement('div')
  markerTooltip.style.cssText = 'position:absolute;display:none;padding:6px 10px;font-size:12px;z-index:1000;pointer-events:none;border-radius:4px;background:#1f2937;color:#e5e7eb;border:1px solid #374151;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis;'
  if (priceContainer.style.position !== 'relative') priceContainer.style.position = 'relative'
  priceContainer.appendChild(markerTooltip)
  if (typeof priceChart.subscribeCrosshairMove === 'function') {
    priceChart.subscribeCrosshairMove((param) => {
      const id = param && param.hoveredObjectId
      const marker = id && lastTradeMarkers.find(m => m.id === id)
      if (marker && marker.title) {
        markerTooltip.textContent = marker.title
        markerTooltip.style.display = 'block'
        const pad = 12
        const tooltipW = 220
        const tooltipH = 32
        let left = (param.point && param.point.x) != null ? param.point.x + pad : 0
        let top = (param.point && param.point.y) != null ? param.point.y + pad : 0
        if (left + tooltipW > priceContainer.clientWidth) left = param.point.x - tooltipW - pad
        if (top + tooltipH > priceContainer.clientHeight) top = param.point.y - tooltipH - pad
        if (left < 0) left = pad
        if (top < 0) top = pad
        markerTooltip.style.left = left + 'px'
        markerTooltip.style.top = top + 'px'
      } else {
        markerTooltip.style.display = 'none'
      }
    })
  }

  // Keep charts responsive
  window.addEventListener('resize', () => {
    if (priceChart && priceContainer) {
      const w = priceContainer.clientWidth || priceWidth
      priceChart.applyOptions({ width: w })
    }
    if (volumeChart && volumeContainer) {
      const w2 = volumeContainer.clientWidth || volumeWidth
      volumeChart.applyOptions({ width: w2 })
    }
  })
}

export function updateFinancialChart (candles, trades = []) {
  if (!priceChart || !volumeChart || !Array.isArray(candles) || !candles.length) return

  const candleData = candles.map(c => ({
    time: Math.floor(c.timestamp / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
  }))
  lastChartPriceData = candles.map(c => ({
    time: Math.floor(c.timestamp / 1000),
    ema7: c.ema7 ?? null,
    ema25: c.ema25 ?? null,
    ema99: c.ema99 ?? null
  }))
  candleSeries.setData(candleData)

  const volumeData = candles.map(c => {
    const up = c.close >= c.open
    return {
      time: Math.floor(c.timestamp / 1000),
      value: c.volume ?? 0,
      color: up ? 'rgba(34,197,94,0.6)' : 'rgba(239,68,68,0.6)'
    }
  })
  volumeSeries.setData(volumeData)

  const ma7Data = candles
    .filter(c => c.ema7 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema7
    }))
  ma7Series.setData(ma7Data)

  const ma25Data = candles
    .filter(c => c.ema25 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema25
    }))
  ma25Series.setData(ma25Data)

  const ma99Data = candles
    .filter(c => c.ema99 != null)
    .map(c => ({
      time: Math.floor(c.timestamp / 1000),
      value: c.ema99
    }))
  ma99Series.setData(ma99Data)

  // Trade markers (v5 API)
  if (candleMarkers) {
    if (Array.isArray(trades) && trades.length > 0 && candles.length > 0) {
      const markers = []
      for (const t of trades) {
        const ts = typeof t.timestamp === 'number' ? t.timestamp : Number(t.timestamp)
        if (!Number.isFinite(ts)) continue
        let best = null
        let bestDiff = Infinity
        for (const c of candles) {
          const diff = Math.abs(ts - c.timestamp)
          if (diff < bestDiff) {
            bestDiff = diff
            best = c
          }
        }
        if (!best) continue
        const time = Math.floor(best.timestamp / 1000)
        const isBuy = t.side !== 'sell'
        const amount = Number(t.amount) || 0
        const price = Number(t.price) || null
        const strategy = t.strategyName || t.strategyId || ''
        const titleParts = [isBuy ? 'Buy' : 'Sell']
        if (amount) titleParts.push(String(amount))
        if (price) titleParts.push('@ ' + price)
        if (strategy) titleParts.push('(' + strategy + ')')
        markers.push({
          id: 'trade-' + markers.length,
          time,
          position: isBuy ? 'belowBar' : 'aboveBar',
          color: isBuy ? '#22c55e' : '#ef4444',
          shape: isBuy ? 'arrowUp' : 'arrowDown',
          text: isBuy ? 'B' : 'S',
          title: titleParts.join(' ')
        })
      }
      lastTradeMarkers = markers
      candleMarkers.setMarkers(markers)
    } else {
      lastTradeMarkers = []
      candleMarkers.setMarkers([])
    }
  }

  const timeScale = priceChart.timeScale && priceChart.timeScale()
  const range = timeScale && timeScale.getVisibleRange && timeScale.getVisibleRange()
  const from = range ? range.from : (lastChartPriceData[0] && lastChartPriceData[0].time)
  const to = range ? range.to : (lastChartPriceData.length && lastChartPriceData[lastChartPriceData.length - 1].time)
  if (from != null && to != null) applyPriceRangeFromData(from, to)
}

