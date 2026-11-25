import { readFile } from 'node:fs/promises'

export const TABLE_NAMES = [
  'slots',
  'links',
  'observations',
  'control',
  'decision_windows',
  'booking',
  'operations',
  'decisions',
  'promotion',
]

export const intOrNull = (value) => (value === '?' || value == null ? null : Number(value))
export const boolValue = (value) => value === 'true'

export async function loadDataset(dataDir = new URL('../../data/', import.meta.url)) {
  const entries = await Promise.all(
    TABLE_NAMES.map(async (name) => {
      const url = new URL(`${name}.json`, dataDir)
      const rows = JSON.parse(await readFile(url, 'utf8'))
      return [name, rows]
    }),
  )
  return Object.fromEntries(entries)
}

export function indexBy(rows, key) {
  const map = new Map()
  for (const row of rows) map.set(row[key], row)
  return map
}

export function groupBy(rows, key) {
  const map = new Map()
  for (const row of rows) {
    const k = typeof key === 'function' ? key(row) : row[key]
    if (!map.has(k)) map.set(k, [])
    map.get(k).push(row)
  }
  return map
}
