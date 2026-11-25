import { intOrNull } from './data.js'
import { summarizeObservations } from './itinerary.js'
import { cellStats, welchContrast } from './stats.js'
import { exposureForSlot, findLinkBetween, openNeighbors } from './topology.js'

const COMPARABLE_VERSION = 'V1'
const COMPARABLE_WEATHER = '晴'

export function classifyHistoricalWindows({ slots, observations, control }) {
  const obsWindows = new Set(observations.map((o) => o.window))
  const windows = [...new Set(slots.map((s) => s.window))].sort()
  return windows.map((window) => {
    const rows = slots.filter((s) => s.window === window)
    const versions = [...new Set(rows.map((r) => r.version))]
    const weathers = [...new Set(rows.map((r) => r.weather))]
    const announced = rows.every((r) => r.announced === 'true')
    const windowControl = control.filter((c) => c.window === window)
    const canceled = windowControl.some((c) => c.event.includes('取消'))
    const pathStopped = windowControl.some((c) => c.event.includes('停步') || c.event.includes('关闭'))
    const hasObs = obsWindows.has(window)

    const comparable =
      versions.length === 1 &&
      versions[0] === COMPARABLE_VERSION &&
      weathers.length === 1 &&
      weathers[0] === COMPARABLE_WEATHER &&
      announced &&
      hasObs &&
      !canceled &&
      !pathStopped

    const reasons = []
    if (versions[0] !== COMPARABLE_VERSION) reasons.push(`不是 ${COMPARABLE_VERSION} 原路线结构`)
    if (weathers[0] !== COMPARABLE_WEATHER) reasons.push(`天气为${weathers[0]}，未登记为可比晴好时段`)
    if (!announced) reasons.push('备选场次未公布且未形成执行证据')
    if (!hasObs) reasons.push('没有流转观测')
    if (canceled) reasons.push('存在现场取消，处理未按登记交付')
    if (pathStopped) reasons.push('存在停步道/道路中断，客流暴露被现场改变')

    return {
      window,
      version: versions[0] ?? null,
      weather: weathers[0] ?? null,
      announced,
      hasObs,
      canceled,
      pathStopped,
      comparable,
      reasons,
      routes: rows.map((r) => r.route),
    }
  })
}

export function congestionEvidence({ slots, control, links, promotion }) {
  const threshold = Number(promotion[0]?.max_congestion ?? '0.85')
  const addedSlots = slots.filter((s) => s.assigned === '加场')
  const results = []

  for (const slot of addedSlots) {
    const version = slot.version
    const neighbors = openNeighbors(links, version, slot.route)
    for (const neighbor of neighbors) {
      const record = control.find(
        (c) => c.window === slot.window && c.route === neighbor,
      )
      const link = findLinkBetween(links, version, slot.route, neighbor)
      const occupancy = record ? intOrNull(record.occupancy) : null
      const limit = link ? intOrNull(link.limit) : null
      const ratio = occupancy != null && limit ? occupancy / limit : null
      results.push({
        window: slot.window,
        addedRoute: slot.route,
        observedRoute: neighbor,
        version,
        link: link ? `${link.from}-${link.to}` : null,
        linkState: link?.state ?? null,
        linkLimit: limit,
        occupancy,
        ratio,
        threshold,
        event: record?.event ?? null,
        controlStart: record ? intOrNull(record.start) : null,
        controlEnd: record ? intOrNull(record.end) : null,
        status:
          ratio == null
            ? 'unknown'
            : ratio > threshold
              ? 'breach'
              : 'within_threshold',
      })
    }
  }
  return results
}

export function buildEffectAnalysis(dataset) {
  const { slots, observations, links, promotion } = dataset
  const obsSummary = summarizeObservations(observations)
  const windowClasses = classifyHistoricalWindows(dataset)
  const comparableWindows = new Set(windowClasses.filter((w) => w.comparable).map((w) => w.window))

  const rows = []
  for (const slot of slots) {
    const key = `${slot.window}|${slot.route}`
    if (!comparableWindows.has(slot.window)) continue
    const routeMetric = obsSummary.windows[slot.window]?.routes[slot.route] ?? null
    if (!routeMetric) continue
    const exposure = exposureForSlot(key, slots, links, slot.version)
    rows.push({
      window: slot.window,
      route: slot.route,
      version: slot.version,
      direct: exposure.direct,
      neighbor: exposure.neighbor,
      neighborAddedRoutes: exposure.neighborAddedRoutes,
      effectiveFlow: routeMetric.effectiveStaysFlow,
      effectiveConfirmed: routeMetric.effectiveStaysConfirmed,
      networkEffectiveTickets: obsSummary.windows[slot.window].flowEffectiveTickets,
      networkTickets: obsSummary.windows[slot.window].uniqueTickets,
    })
  }

  const routes = [...new Set(rows.map((r) => r.route))].sort()
  const routeEffects = {}
  for (const route of routes) {
    const routeRows = rows.filter((r) => r.route === route)
    const direct = routeRows.filter((r) => r.direct === 1)
    const neighborOnly = routeRows.filter((r) => r.direct === 0 && r.neighbor === 1)
    const pureControl = routeRows.filter((r) => r.direct === 0 && r.neighbor === 0)
    const assignedControl = routeRows.filter((r) => r.direct === 0)

    const metric = (list, key) => list.map((r) => r[key])
    routeEffects[route] = {
      nSlots: routeRows.length,
      directWindows: direct.map((r) => r.window),
      neighborWindows: neighborOnly.map((r) => r.window),
      controlWindows: pureControl.map((r) => r.window),
      assignedControlWindows: assignedControl.map((r) => r.window),
      effectiveFlow: {
        direct: cellStats(metric(direct, 'effectiveFlow')),
        neighborOnly: cellStats(metric(neighborOnly, 'effectiveFlow')),
        pureControl: cellStats(metric(pureControl, 'effectiveFlow')),
        assignedControl: cellStats(metric(assignedControl, 'effectiveFlow')),
        directVsPureControl: welchContrast(
          metric(direct, 'effectiveFlow'),
          metric(pureControl, 'effectiveFlow'),
        ),
        neighborVsPureControl: welchContrast(
          metric(neighborOnly, 'effectiveFlow'),
          metric(pureControl, 'effectiveFlow'),
        ),
        directVsAssignedControl: welchContrast(
          metric(direct, 'effectiveFlow'),
          metric(assignedControl, 'effectiveFlow'),
        ),
      },
      effectiveConfirmed: {
        direct: cellStats(metric(direct, 'effectiveConfirmed')),
        neighborOnly: cellStats(metric(neighborOnly, 'effectiveConfirmed')),
        pureControl: cellStats(metric(pureControl, 'effectiveConfirmed')),
        assignedControl: cellStats(metric(assignedControl, 'effectiveConfirmed')),
        directVsAssignedControl: welchContrast(
          metric(direct, 'effectiveConfirmed'),
          metric(assignedControl, 'effectiveConfirmed'),
        ),
      },
    }
  }

  const networkRows = Object.entries(obsSummary.windows)
    .filter(([w]) => comparableWindows.has(w))
    .map(([window, value]) => {
      const addedRoutes = slots
        .filter((s) => s.window === window && s.assigned === '加场')
        .map((s) => s.route)
      return {
        window,
        addedRoutes,
        uniqueTickets: value.uniqueTickets,
        effectiveTickets: value.flowEffectiveTickets,
        effectiveRate: value.flowEffectiveTickets / value.uniqueTickets,
        routeSegments: value.routeSegments,
        crossRouteTickets: value.crossRouteTickets,
      }
    })
    .sort((a, b) => a.window.localeCompare(b.window, undefined, { numeric: true }))

  const networkValues = (list) => list.map((r) => r.effectiveTickets)
  const networkEffects = {
    aAddVsNoA: welchContrast(
      networkValues(networkRows.filter((r) => r.addedRoutes.includes('A'))),
      networkValues(networkRows.filter((r) => !r.addedRoutes.includes('A'))),
    ),
    bAddVsNoB: welchContrast(
      networkValues(networkRows.filter((r) => r.addedRoutes.includes('B'))),
      networkValues(networkRows.filter((r) => !r.addedRoutes.includes('B'))),
    ),
    anyAddVsW0: welchContrast(
      networkValues(networkRows.filter((r) => r.addedRoutes.length > 0)),
      networkValues(networkRows.filter((r) => r.window === 'W0')),
    ),
  }

  const congestion = congestionEvidence(dataset)
  const minObservations = Number(promotion[0]?.min_observations ?? '2')
  const minAdvantage = Number(promotion[0]?.min_advantage ?? '0')

  const promotionByRoute = {}
  for (const route of routes) {
    const effect = routeEffects[route]
    const directN = effect.effectiveFlow.direct.n
    const controlN = effect.effectiveFlow.assignedControl.n
    const advantage = effect.effectiveFlow.directVsAssignedControl.difference
    const routeCongestion = congestion.filter((c) => c.addedRoute === route)
    const measured = routeCongestion.filter((c) => c.status !== 'unknown')
    const breaches = routeCongestion.filter((c) => c.status === 'breach')
    const unknown = routeCongestion.filter((c) => c.status === 'unknown')

    promotionByRoute[route] = {
      historicalVersion: COMPARABLE_VERSION,
      directReplicates: directN,
      controlReplicates: controlN,
      minObservations,
      hasMinReplicates: directN >= minObservations && controlN >= minObservations,
      flowAdvantage: advantage,
      confirmedAdvantage: effect.effectiveConfirmed.directVsAssignedControl.difference,
      meetsPointAdvantage: advantage != null && advantage >= minAdvantage,
      congestion: routeCongestion,
      congestionBreaches: breaches,
      congestionUnknown: unknown,
      congestionObservedWorst: measured.length
        ? Math.max(...measured.map((c) => c.ratio))
        : null,
      historicalPromotionSignal:
        directN >= minObservations &&
        advantage != null &&
        advantage >= minAdvantage &&
        breaches.length === 0,
    }
  }

  return {
    observationSummary: obsSummary,
    windowClasses,
    comparableWindows: [...comparableWindows],
    effectRows: rows,
    routeEffects,
    networkRows,
    networkEffects,
    congestion,
    promotionByRoute,
  }
}
