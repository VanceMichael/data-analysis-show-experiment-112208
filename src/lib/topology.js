export function linksForVersion(links, version) {
  return links.filter((link) => link.version === version)
}

export function openLinksForVersion(links, version) {
  return linksForVersion(links, version).filter((link) => link.state === '开放')
}

/**
 * The source stores directed from/to rows, while the business rule says an
 * adjacent open segment creates mutual influence eligibility.  We therefore
 * match either endpoint for eligibility, but preserve the directed limit for
 * congestion ratios where possible.
 */
export function findLinkBetween(links, version, a, b, { openOnly = true } = {}) {
  const versionLinks = linksForVersion(links, version).filter(
    (link) => !openOnly || link.state === '开放',
  )
  return (
    versionLinks.find((link) => link.from === a && link.to === b) ??
    versionLinks.find((link) => link.from === b && link.to === a) ??
    null
  )
}

export function openNeighbors(links, version, route) {
  return openLinksForVersion(links, version)
    .flatMap((link) => {
      if (link.from === route) return [link.to]
      if (link.to === route) return [link.from]
      return []
    })
    .sort()
}

export function exposureForSlot(slotKey, slots, links, version) {
  const [window, route] = slotKey.split('|')
  const windowSlots = slots.filter((s) => s.window === window && s.version === version)
  const own = windowSlots.find((s) => s.route === route)
  const addedRoutes = new Set(
    windowSlots.filter((s) => s.assigned === '加场').map((s) => s.route),
  )
  const neighbors = openNeighbors(links, version, route)
  const neighborAddedRoutes = neighbors.filter((r) => addedRoutes.has(r))
  return {
    direct: own?.assigned === '加场' ? 1 : 0,
    neighbor: neighborAddedRoutes.length ? 1 : 0,
    neighborAddedRoutes,
    addedRoutes: [...addedRoutes],
  }
}
