import { groupBy, intOrNull } from './data.js'

/**
 * Build one itinerary per ticket.  The earliest non-repeat row is treated as
 * the pre-assigned route because the source has no separate ticket-to-slot
 * assignment table.  Assignment is deliberately retained even when later
 * rows show a transfer/re-entry.
 */
export function buildItinerary(observations) {
  const byTicket = groupBy(observations, 'ticket')
  const tickets = []

  for (const [ticket, rows] of byTicket) {
    const segments = rows
      .map((row) => {
        const entry = intOrNull(row.entry)
        const exit = intOrNull(row.exit)
        const duration = entry == null || exit == null ? null : exit - entry
        return {
          ...row,
          entryMinute: entry,
          exitMinute: exit,
          duration,
          checkinKnown: row.checkin !== '?',
          flowEffective: duration != null && duration >= 20,
          confirmedEffective: duration != null && duration >= 20 && row.checkin !== '?',
        }
      })
      .sort((a, b) => {
        if (a.entryMinute !== b.entryMinute) return a.entryMinute - b.entryMinute
        if (a.repeat !== b.repeat) return a.repeat === 'no' ? -1 : 1
        return a.route.localeCompare(b.route)
      })

    const original = segments[0]
    const routes = [...new Set(segments.map((s) => s.route))]
    tickets.push({
      ticket,
      window: original.window,
      assignedRoute: original.route,
      assignmentBasis: 'earliest_entry_flow_record',
      segments,
      actualRoutes: routes,
      transferred: routes.length > 1,
      repeatScan: segments.some((s) => s.repeat === 'yes'),
      flowEffectiveAny: segments.some((s) => s.flowEffective),
      confirmedEffectiveAny: segments.some((s) => s.confirmedEffective),
    })
  }

  return tickets.sort((a, b) => a.ticket.localeCompare(b.ticket, undefined, { numeric: true }))
}

export function summarizeObservations(observations) {
  const tickets = buildItinerary(observations)
  const byWindow = groupBy(tickets, 'window')
  const windows = {}

  for (const [window, windowTickets] of byWindow) {
    const allSegments = windowTickets.flatMap((t) => t.segments)
    const routeNames = [...new Set(allSegments.map((s) => s.route))].sort()
    const routes = {}

    for (const route of routeNames) {
      const segments = allSegments.filter((s) => s.route === route)
      const assigned = windowTickets.filter((t) => t.assignedRoute === route)
      routes[route] = {
        actualVisits: segments.length,
        actualTickets: new Set(segments.map((s) => s.ticket)).size,
        effectiveStaysFlow: segments.filter((s) => s.flowEffective).length,
        effectiveStaysConfirmed: segments.filter((s) => s.confirmedEffective).length,
        durationQualifiedMissingCheckin: segments.filter(
          (s) => s.flowEffective && !s.checkinKnown,
        ).length,
        assignedTickets: assigned.length,
        assignedEffectiveOnAssignedRouteFlow: assigned.filter((t) =>
          t.segments.some((s) => s.route === route && s.flowEffective),
        ).length,
        assignedEffectiveAnyRouteFlow: assigned.filter((t) => t.flowEffectiveAny).length,
      }
    }

    windows[window] = {
      uniqueTickets: windowTickets.length,
      routeSegments: allSegments.length,
      crossRouteTickets: windowTickets.filter((t) => t.transferred).length,
      flowEffectiveTickets: windowTickets.filter((t) => t.flowEffectiveAny).length,
      confirmedEffectiveTickets: windowTickets.filter((t) => t.confirmedEffectiveAny).length,
      routes,
      tickets: windowTickets,
    }
  }

  return { tickets, windows }
}
