function rankMatrix(matrix) {
  const rows = matrix.map((row) => row.map(Number))
  const cols = matrix[0]?.length ?? 0
  let rank = 0
  for (let col = 0; col < cols && rank < rows.length; col += 1) {
    let pivot = rank
    while (pivot < rows.length && Math.abs(rows[pivot][col]) < 1e-10) pivot += 1
    if (pivot === rows.length) continue
    ;[rows[rank], rows[pivot]] = [rows[pivot], rows[rank]]
    for (let i = 0; i < rows.length; i += 1) {
      if (i === rank) continue
      const factor = rows[i][col] / rows[rank][col]
      for (let j = col; j < cols; j += 1) rows[i][j] -= factor * rows[rank][j]
    }
    rank += 1
  }
  return rank
}

/**
 * Design columns are [intercept, routeB, own-add D, open-neighbor-add N]
 * for the two-node V2 A-B segment.  Full rank four means the exposure
 * combinations do not force D and N to be the same contrast.
 */
export function abDesignRank(addByWindow = {}) {
  const matrix = []
  for (const [window, addedRoute] of Object.entries(addByWindow)) {
    for (const route of ['A', 'B']) {
      const direct = addedRoute === route ? 1 : 0
      const neighbor = addedRoute && addedRoute !== route ? 1 : 0
      matrix.push([1, route === 'B' ? 1 : 0, direct, neighbor])
    }
  }
  return { rank: rankMatrix(matrix), parameterCount: 4, rows: matrix.length }
}

export function buildIdentification(dataset) {
  const v1 = dataset.links.filter((l) => l.version === 'V1')
  const v2 = dataset.links.filter((l) => l.version === 'V2')
  const closedLinks = v2.filter((l) => l.state === '关闭')
  const changedLimits = v2
    .map((link) => {
      const old = v1.find((l) => l.from === link.from && l.to === link.to)
      return old && old.limit !== link.limit
        ? { segment: `${link.from}-${link.to}`, from: Number(old.limit), to: Number(link.limit) }
        : null
    })
    .filter(Boolean)

  const executedV2Windows = [
    ...new Set(
      dataset.observations
        .map((o) => o.window)
        .filter((w) => dataset.slots.some((s) => s.window === w && s.version === 'V2')),
    ),
  ]

  const strictRecordedPlan = { W7: null, W8: 'A', W9: 'B' }
  const minUsableComparisons = Number(dataset.decision_windows[0]?.min_usable_comparisons ?? '2')
  const parentSource = abDesignRank({ W7: strictRecordedPlan.W7, W9: strictRecordedPlan.W9 })
  const groupSource = abDesignRank({ W8: strictRecordedPlan.W8 })
  const pooledExploratory = abDesignRank(strictRecordedPlan)

  return {
    targetVersion: dataset.promotion[0]?.version ?? 'V2',
    executedTargetObservationWindows: executedV2Windows,
    historicalScope: 'V1：W0/W1/W2/W5/W6，晴好且已公布',
    closedLinks,
    changedLimits,
    failedPublishedComparisons: [
      {
        window: 'W9',
        route: 'B',
        comparison: 'B 加场 -> C 邻线 / 以 C 为相邻对照',
        reason: 'V2 中 B-C 为关闭状态；V1 的 W2/W6 和 29/35 拥堵率只适用于开放结构',
      },
    ],
    designChecks: [
      {
        source: '亲子混合',
        segment: 'A-B 开放',
        windows: ['W7', 'W9'],
        addByWindow: { W7: null, W9: 'B' },
        ...parentSource,
        separatePointIdentification: parentSource.rank === 4,
        addWindows: 1,
        minUsableComparisons,
        meetsReplicateThreshold: false,
        canReport: ['W9/B 相对 W7 的 B 直接点差', 'B->A 邻线点差', 'A+B 全场总体净流量点差'],
        cannotReport: ['达到两个登记重复时段的不确定性', 'A 加场方向的直接/邻场交叉验证'],
      },
      {
        source: '团体为主',
        segment: 'A-B 开放',
        windows: ['W8'],
        addByWindow: { W8: 'A' },
        ...groupSource,
        separatePointIdentification: false,
        addWindows: 1,
        minUsableComparisons,
        meetsReplicateThreshold: false,
        canReport: ['W8/A 单臂结果和 B 同期邻线观测'],
        cannotReport: ['同来源内扣除路线基线后的稳定直接/邻场效应'],
      },
      {
        source: '散客为主',
        segment: 'B-C 关闭，C 无开放邻线',
        windows: ['W8', 'W9'],
        addByWindow: { W8: 'C', W9: null },
        rank: 2,
        parameterCount: 2,
        separatePointIdentification: false,
        directPointIdentification: true,
        addWindows: 1,
        minUsableComparisons,
        meetsReplicateThreshold: false,
        canReport: ['若选择 W8/C、保留 W9/C 为无加场观测，可得到 C 线总体/直接效应单点差'],
        cannotReport: ['C 的邻线效应', '两个登记重复时段的不确定性', 'W9/C 在 B 已占用 max_added 时再加'],
      },
    ],
    pooledExploratory: {
      ...pooledExploratory,
      sameSource: false,
      registeredCriterionMet: false,
      note: 'W7=00、W8=10、W9=01 的矩阵满秩；但 W8 为团体来源、W7/W9 为亲子来源，只能作探索性合并，不能满足预先登记的同来源要求。',
    },
    withdrawal:
      '若不能在 V2 下补足至少两个同来源可用对比及缺失暴露方向，撤回 W9/B 在 V2 结构中的“直接+邻场效应已分别识别/可推广”表述；只报告 W7 对照与 W9/B 的同来源 A+B 总体净流量点差，W8 团体来源层另行分析。V1 原范围结论和 decisions.json 的已签记录保留。',
  }
}
