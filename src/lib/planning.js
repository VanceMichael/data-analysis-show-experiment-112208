import { intOrNull } from './data.js'
import { findLinkBetween, openNeighbors } from './topology.js'
import { buildIdentification } from './identification.js'

export function latestOperationsByKey(operations) {
  const map = new Map()
  for (const op of operations) {
    const key = `${op.window}|${op.route}`
    const revision = Number(op.revision)
    const existing = map.get(key)
    if (!existing || revision > Number(existing.revision)) map.set(key, op)
  }
  return map
}

function capacityAssessment(op, bookingRows) {
  if (!op) {
    return {
      hasOperations: false,
      runnable: false,
      blockers: ['缺少 operations 容量/客流来源记录，不能从现有资料确认可开展'],
    }
  }
  const planned = intOrNull(op.planned_capacity)
  const egressReserve = intOrNull(op.egress_reserve)
  const usable = planned == null || egressReserve == null ? null : planned - egressReserve
  const reserved = bookingRows.reduce((sum, b) => sum + (intOrNull(b.reserved) ?? 0), 0)
  const blockers = []
  if (usable == null) blockers.push('容量或出口预留无法解析')
  else if (reserved > usable) blockers.push(`已订/预留 ${reserved} 人超过可用容量 ${usable} 人`)
  if (op.condition !== '可用' && op.condition !== '维修') {
    blockers.push(`场控状态为 ${op.condition}`)
  }
  return {
    hasOperations: true,
    condition: op.condition,
    revision: Number(op.revision),
    plannedCapacity: planned,
    egressReserve,
    protectedEgressReserve: egressReserve,
    usableCapacity: usable,
    reserved,
    remainingAfterReservations: usable == null ? null : usable - reserved,
    capacityRunnable: blockers.length === 0,
    blockers,
    note:
      op.condition === '维修'
        ? '最新修订为维修状态；表内仍给出下调后的容量和更大出口预留，按带修订条件执行，不能恢复旧修订容量。'
        : '出口预留是受保护容量，不得计作可加场容量。',
  }
}

function staffAssessment(window, route, booking) {
  const windowBookings = booking.filter((b) => b.window === window)
  const target = windowBookings.filter((b) => b.route === route)
  const committedStates = new Set(['已公示', '已接受', '已签'])
  const committed = windowBookings.filter(
    (b) => committedStates.has(b.state) || b.role === '旅行团基准',
  )
  const blockers = []
  const conflicts = []

  for (const item of target) {
    for (const other of committed) {
      if (other.route === route) continue
      if (item.guide === other.guide) {
        conflicts.push({ type: 'guide', id: item.guide, withRoute: other.route, state: other.state })
        blockers.push(`疏导/导游 ${item.guide} 已被 ${other.window} ${other.route} 的${other.state}场次占用`)
      }
      if (item.actor === other.actor) {
        conflicts.push({ type: 'actor', id: item.actor, withRoute: other.route, state: other.state })
        blockers.push(`演员 ${item.actor} 已被 ${other.window} ${other.route} 的${other.state}场次占用`)
      }
    }
  }

  return {
    targetBookings: target,
    conflicts,
    staffRunnable: blockers.length === 0,
    blockers,
  }
}

export function assessSession(window, route, dataset, baseAnalysis = null) {
  const { slots, booking, operations, decisions, decision_windows: decisionWindows, links, control, promotion } = dataset
  const opMap = latestOperationsByKey(operations)
  const op = opMap.get(`${window}|${route}`) ?? null
  const slot = slots.find((s) => s.window === window && s.route === route) ?? null
  const bookings = booking.filter((b) => b.window === window && b.route === route)
  const decision = decisions.find((d) => d.accepted_window === window && d.route === route) ?? null
  const decisionWindow = decisionWindows.find((d) => d.window === window) ?? null
  const windowBookings = booking.filter((b) => b.window === window)
  const fixedAddedBookings = windowBookings.filter(
    (b) => b.role === '周末推广' || b.state === '已接受',
  )
  const fixedAdded = fixedAddedBookings.length
  const fixedAddedRoutes = [...new Set(fixedAddedBookings.map((b) => b.route))]

  const capacity = capacityAssessment(op, bookings)
  const staff = staffAssessment(window, route, booking)
  const version = decisionWindow?.version ?? slot?.version ?? op?.version ?? 'V2'
  const neighbors = openNeighbors(links, version, route)
  const ownControl = control.filter((c) => c.window === window && c.route === route)

  const adjacentControl = neighbors.flatMap((n) =>
    control
      .filter((c) => c.window === window && c.route === n)
      .map((c) => {
        const link = findLinkBetween(links, version, route, n)
        const occupancy = intOrNull(c.occupancy)
        const limit = link ? intOrNull(link.limit) : null
        const threshold = Number(promotion[0]?.max_congestion ?? '0.85')
        return {
          observedRoute: n,
          event: c.event,
          occupancy,
          link: link ? `${link.from}-${link.to}` : null,
          linkLimit: limit,
          ratio: occupancy != null && limit ? occupancy / limit : null,
          threshold,
          status:
            occupancy == null || limit == null
              ? 'unknown'
              : occupancy / limit > threshold
                ? 'breach'
                : 'within_threshold',
        }
      }),
  )

  const upstreamAdded = []
  for (const record of ownControl) {
    for (const otherRoute of openNeighbors(links, version, route)) {
      const otherSlot = slots.find(
        (s) => s.window === window && s.route === otherRoute && s.version === version,
      )
      if (otherSlot?.assigned === '加场') {
        const link = findLinkBetween(links, version, otherRoute, route)
        upstreamAdded.push({ addedRoute: otherRoute, controlEvent: record.event, link: link ? `${link.from}-${link.to}` : null })
      }
    }
  }

  const classification = []
  if (decision?.kind === '周末推广') classification.push('已签周末推广（原记录不覆盖）')
  if (bookings.some((b) => b.role === '旅行团基准' && b.state === '已公示'))
    classification.push('已公示旅行团基准承诺场次')
  if (bookings.some((b) => b.state === '未公示')) classification.push('未公布备选场次')
  if (slot?.announced === 'false') classification.push('未公布排期备选')
  if (ownControl.some((c) => c.event.includes('取消'))) classification.push('现场/天气被迫取消场次')
  if (op?.condition === '维修') classification.push('维修修订容量场次')

  const quotaBlockers = []
  const isAddCandidate =
    decision?.kind === '周末推广' ||
    bookings.some((b) => b.role === '候选加场' || b.state === '未公示')
  const isAlreadyAdded =
    decision?.kind === '周末推广' || bookings.some((b) => b.role === '周末推广' || b.state === '已接受')
  if (decisionWindow && isAddCandidate && !isAlreadyAdded) {
    const maxAdded = Number(decisionWindow.max_added)
    if (fixedAdded >= maxAdded) {
      quotaBlockers.push(`本轮已有 ${fixedAdded} 个公开约定加场，达到 max_added=${maxAdded}；未公布候选不能再加`)
    }
  }

  const capacityBlockers = capacity.blockers
  const planningBlockers = [...capacityBlockers, ...staff.blockers, ...quotaBlockers]
  const futureLike = Boolean(decisionWindow || bookings.length)
  const forcedCancellation = ownControl.some((c) => c.event.includes('取消'))
  const blockers = futureLike
    ? planningBlockers
    : forcedCancellation
      ? ['该场已有天气取消记录，不能按原加场效果执行']
      : []
  const dataGaps = futureLike
    ? []
    : capacity.hasOperations
      ? []
      : ['无 operations 未来容量记录；历史效果分析不因此阻断，但不能作容量审批']
  const runnable = futureLike ? planningBlockers.length === 0 : !forcedCancellation

  const questions = []
  if (slot?.assigned === '加场' && baseAnalysis?.comparableWindows.includes(window)) {
    questions.push(`可作为 ${slot.version}/${slot.weather} 原结构下 ${route} 线直接效应的登记重复样本`)
    questions.push(`可观察 ${neighbors.join('、') || '无开放邻线'} 的邻线溢出`)
    questions.push('可计入全场唯一票/有效停留净流量')
  }
  if (ownControl.some((c) => c.event.includes('取消'))) {
    questions.push('只能回答取消响应、滞留/疏导和承诺履约，不能回答加场效果')
  }
  if (futureLike) {
    const targetFixedAdd = fixedAddedRoutes.includes(route)
    const fixedNeighborRoutes = fixedAddedRoutes.filter(
      (r) => r !== route && neighbors.includes(r),
    )
    if (targetFixedAdd) {
      questions.push(`该场是已公开约定的 ${route} 线加场/推广臂，执行后成为 ${version} 新观测单元`)
      if (neighbors.length) questions.push(`可识别对 ${neighbors.join('、')} 的邻线影响（仍需对照时段估计不确定性）`)
    } else if (fixedNeighborRoutes.length) {
      questions.push(
        `在 ${fixedNeighborRoutes.join('、')} 已固定加场时，该场是邻线暴露/溢出观测点，不是 ${route} 直接加场臂`,
      )
    } else {
      questions.push(`若本轮不选 ${route} 加场，该场可作为同来源对照/基准观测`)
    }
    questions.push('可计入全场唯一票、有效停留票和净流量，避免把转线票重复计成净增量')
    if (!neighbors.length) questions.push('当前版本没有开放邻线，只能识别本线/全场总体效果')
    if (isAddCandidate && !isAlreadyAdded) {
      questions.push(
        runnable
          ? `若排班会选中此未公布候选，将其登记为 ${route} 直接加场臂，并观测 ${neighbors.join('、') || '全场'}`
          : `此候选补齐人员/配额前提后才可作为 ${route} 直接加场臂`,
      )
    }
  }

  const resourcesLocked = Boolean(
    slot?.announced === 'true' ||
    decision ||
    bookings.some((b) => b.state === '已公示' || b.state === '已接受'),
  )

  return {
    window,
    route,
    version,
    classification,
    runnable,
    resourcesLocked,
    blockers,
    planningBlockers,
    dataGaps,
    capacity,
    staffConflicts: staff.conflicts,
    bookings,
    decision,
    decisionWindow,
    openNeighbors: neighbors,
    ownControl,
    adjacentControl,
    upstreamAddedResponsibility: upstreamAdded,
    analysisQuestions: questions,
  }
}

export function buildSchedulePlan(dataset, analysis) {
  const windows = dataset.decision_windows.map((w) => w.window)
  const sessions = Object.fromEntries(
    windows.flatMap((window) =>
      dataset.decision_windows
        .find((w) => w.window === window)
        .options.split('+')
        .map((route) => [`${window}|${route}`, assessSession(window, route, dataset, analysis)]),
    ),
  )

  const recommendations = [
    {
      window: 'W7',
      action: 'keep_baseline_hold_b_as_recorded',
      route: 'A',
      decision: 'A 的已公示旅行团基准场必须保留；出口预留 14 人不得挪作加场。',
      alternatives: [
        'B 按现有 booking 不可直接开展：G1 同时被已公示 A 占用。',
        'B 仍未公布，可在公示前改派一名 W7 无排班且具资格的疏导员；资料中 G2/G3 在 W7 无 booking 记录，但需排班主管确认资格。',
        '若改派 B，可得到 V2/亲子来源的 B 加场观测；若保留 W7 为无加场对照，则它是 W9/B 最直接的同来源总体净流量对照。',
      ],
    },
    {
      window: 'W8',
      action: 'run_one_registered_arm_prefer_A',
      route: 'A',
      decision:
        '资料内 A/B/C 候选均容量和人员可行；为与 W9 已固定的 B 加场形成不同暴露方向，优先登记 A 为唯一加场，B 作为 A-B 开放段邻线观测点。',
      caveats: [
        'W8 A/B 为团体为主，W9 A/B 为亲子混合，不能未经分层/加权直接并入同一不确定性样本。',
        'V2 的 A-B 限值为 45；阈值 0.85 对应 38.25 人，应实测 B 段占用，不能用 operations 的可用容量代替现场占用。',
        'C 为散客来源且 B-C 已关闭，不能作为 A/B 的同来源邻线对照；C 只能另建独立总体/直接效应序列。',
        '这一个 W8 A 臂不足以单独满足 min_usable_comparisons=2；它是预先登记的第一臂，结论需后续同来源重复或对照补足。',
      ],
    },
    {
      window: 'W9',
      action: 'honor_commitment_notify_identification_gap',
      route: 'B',
      decision:
        '保留 decisions.json 中 B 的已签周末推广原记录，A 旅行团基准和 B 已接受推广均按承诺排班；B 以最新 rev2 为准：计划 47、出口预留 18、可用 29；rev1 的可用 43/预留 12 已被维修修订替代。',
      alternatives: [
        'B 已占用 max_added=1，C 未公布候选不能在同一轮再加。',
        '向 W9/B 游线及排班会发出识别条件缺失通知：V2 已关闭 B-C，V1 的 B→C 邻线拥堵/客流对照不能直接作为 V2 对照。',
        '若无法补出同来源、同开放路段的 A 加场/B 加场/对照组合，应撤回的是“B 推广在 V2 新路线结构下仍有已识别直接+邻场优势”的新结论；V1 原范围结论和已签记录不改写。',
      ],
    },
  ]

  const selectedSchedule = [
    {
      window: 'W7',
      selectedAddedRoute: null,
      committedBaselineRoutes: ['A'],
      asRecordedUnavailable: ['B'],
      missingPlanningRecord: ['C'],
      role: 'V2/亲子来源对照与承诺基准场',
      contingent: {
        ifBeforePublication: '将 W7/B 的 G1 改派为经确认可值班的 G2/G3',
        then: '可改跑 B 加场重复臂，但会失去 W7 无加场对照；需另行补对照',
      },
    },
    {
      window: 'W8',
      selectedAddedRoute: 'A',
      observationRoutes: ['B', 'C'],
      maxAdded: 1,
      role: 'V2/团体来源的 A 直接臂与 B 邻线观测；C 仅作独立散客层',
      meetsSeparateIdentificationNow: false,
    },
    {
      window: 'W9',
      selectedAddedRoute: 'B',
      selectionSource: 'decisions.json 已签周末推广 + booking 已接受',
      committedBaselineRoutes: ['A'],
      blockedUnpublishedRoutes: ['C'],
      role: '承诺周末场，同时作为 V2/亲子来源 B 直接臂与 A 邻线观测',
      identificationNotification: 'V2_IDENTIFICATION_GAP',
    },
  ]

  return { sessions, recommendations, selectedSchedule, identification: buildIdentification(dataset) }
}
