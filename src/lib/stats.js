export function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
}

export function sampleSd(values) {
  if (values.length < 2) return null
  const m = mean(values)
  return Math.sqrt(values.reduce((sum, v) => sum + (v - m) ** 2, 0) / (values.length - 1))
}

export function cellStats(values) {
  const n = values.length
  const m = mean(values)
  const sd = sampleSd(values)
  return {
    n,
    mean: m,
    sd,
    se: sd == null ? null : sd / Math.sqrt(n),
    min: n ? Math.min(...values) : null,
    max: n ? Math.max(...values) : null,
    values,
  }
}

// Two-sided 95% t critical values for the tiny Welch degrees of freedom in
// this dataset.  Larger df use the normal approximation here; callers also get
// the raw SE and observed range.
const T_95 = {
  1: 12.706,
  2: 4.303,
  3: 3.182,
  4: 2.776,
  5: 2.571,
  6: 2.447,
  7: 2.365,
  8: 2.306,
  9: 2.262,
  10: 2.228,
  12: 2.179,
  15: 2.131,
  20: 2.086,
  30: 2.042,
}

function tCritical95(df) {
  if (df <= 0) return null
  if (df <= 30) {
    const key = [...Object.keys(T_95).map(Number)]
      .sort((a, b) => a - b)
      .find((n) => n >= df)
    return T_95[key]
  }
  return 1.96
}

export function welchContrast(aValues, bValues) {
  const a = cellStats(aValues)
  const b = cellStats(bValues)
  if (a.mean == null || b.mean == null) {
    return { difference: null, se: null, ci95: [null, null], df: null }
  }
  const difference = a.mean - b.mean
  if (a.n < 2 || b.n < 2 || a.sd == null || b.sd == null) {
    return {
      difference,
      se: null,
      ci95: [null, null],
      df: null,
      note: '至少一组不足两个时段；只报告观测差，不构造常规区间',
    }
  }
  const va = a.sd ** 2 / a.n
  const vb = b.sd ** 2 / b.n
  const se = Math.sqrt(va + vb)
  if (se === 0) {
    return {
      difference,
      se: 0,
      df: null,
      ci95: [difference, difference],
      note: '观测值无样本方差；这不等于总体不确定性为零，时段数仍很少',
    }
  }
  const df = (va + vb) ** 2 / (va ** 2 / (a.n - 1) + vb ** 2 / (b.n - 1))
  const tcrit = tCritical95(df)
  const margin = tcrit == null ? null : tcrit * se
  return {
    difference,
    se,
    df,
    ci95: margin == null ? [null, null] : [difference - margin, difference + margin],
  }
}

export function formatNumber(value, digits = 3) {
  if (value == null || Number.isNaN(value)) return '—'
  return Number(value).toFixed(digits).replace(/\.?0+$/, '')
}
