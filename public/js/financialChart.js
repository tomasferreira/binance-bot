let chart = null
let candleSeries = null
let volumeSeries = null
let ma7Series = null
let ma25Series = null
let ma99Series = null

function ensureLib () {
  if (!window.LightweightCharts) return null
  return window.LightweightCharts
}

export function initFinancialChart () {
  const lib = ensureLib()
  const container = document.getElementById('financial-chart-container')
  if (!lib || !container) return
  if (chart) return

  const {
    createChart,
    CrosshairMode,
    CandlestickSeries,
    HistogramSeries,
    LineSeries
  } = lib

  const width = container.clientWidth || 600
  chart = createChart(container, {
    width,
    height: 420,
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: '#e5e7eb'
    },
    grid: {
      vertLines: { color: '#0f172a' },
      horzLines: { color: '#0f172a' }
    },
    rightPriceScale: {
      borderColor: '#1f2937'
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

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: '#22c55e',
    downColor: '#ef4444',
    borderVisible: false,
    wickUpColor: '#22c55e',
    wickDownColor: '#ef4444'
  })

  volumeSeries = chart.addSeries(HistogramSeries, {
    priceScaleId: '',
    priceFormat: { type: 'volume' },
    scaleMargins: { top: 0.8, bottom: 0 },
    color: '#1d4ed8'
  })

  ma7Series = chart.addSeries(LineSeries, {
    color: '#eab308', // MA(7) - yellow
    lineWidth: 2
  })

  ma25Series = chart.addSeries(LineSeries, {
    color: '#6366f1', // MA(25) - indigo
    lineWidth: 2
  })

  ma99Series = chart.addSeries(LineSeries, {
    color: '#f97316', // MA(99) - orange
    lineWidth: 2
  })

  window.addEventListener('resize', () => {
    if (!chart) return
    const w = container.clientWidth || width
    chart.applyOptions({ width: w })
  })
}

export function updateFinancialChart (candles) {
  if (!chart || !Array.isArray(candles) || !candles.length) return

  const candleData = candles.map(c => ({
    time: Math.floor(c.timestamp / 1000),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close
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
}

