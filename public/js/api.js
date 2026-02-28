export async function fetchStatus () {
  const res = await fetch('/api/status')
  if (!res.ok) throw new Error('Failed to fetch status')
  return res.json()
}

export async function postJson (url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  })
  if (!res.ok) {
    throw new Error('Request failed: ' + res.status)
  }
  return res.json()
}
