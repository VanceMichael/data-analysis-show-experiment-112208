import { formatNumber } from './stats.js'

const pct = (x) => (x == null ? '未知' : `${(x * 100).toFixed(1)}%`)
const num = (x) => formatNumber(x, 2)

function table(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n')
}

export function renderBriefing(result, dataset) {
  const { analysis, plan, thresholds } = result
  const lines = []

  lines.push('# 排班会分析与后续试验说明')
  lines.push('')
  lines.push(`生成时间：${result.generatedAt}`)
  lines.push('')
  lines.push('## 一、先给排班会的结论')
  lines.push('')
  lines.push('1. **试验单位不变**：仍以排期名单中预先分配的“游线 × 时段”为单位，不把闸机人数、分路计数和场次签到合并成同一人数。')
  lines.push('2. **转线/重入票保留原分配**：T2 仍归属 W1/B 对照分配；其实际 A 段用于标识 A 线实际暴露和邻场影响，全场净流量只计一次 unique ticket。')
  lines.push('3. **W3 不进入效果估计**：A 为已公布后遇天气取消，B 有停步道；不能把无观测或 `occupancy:"?"` 解释成“游客没来/零拥堵”。已公布场次占用的 G/E 等班组在该执行窗口不可事后改派。')
  lines.push('4. **V1 结论只保留在 V1 路线结构**：W0/W1/W2/W5/W6 是晴好、已公布、有流转记录的可比时段；W4 是 V2 未公布且无观测备选，不提供证据。')
  lines.push('5. **V2 必须缩小主张**：B-C 已关闭，W2/W6 的 B→C 邻线对照不能直接当作 V2 对照。若补不足同来源、同开放路段的暴露组合，应撤回“B 在 V2 下仍有已识别直接+邻场优势”的新结论；V1 原报告范围和 W9/B 已签记录均保留。')
  lines.push('6. **W9/B 发识别条件缺失通知，但不删决策记录**：承诺场仍按承诺执行并采集 V2 数据；通知只说明不能把它宣称为已被 V2 证据验证的推广。W9/A 旅行团基准等其他承诺/有证据范围的场次不受连坐，继续执行。')
  lines.push('')

  lines.push('## 二、窗口可用性')
  lines.push('')
  lines.push(
    table(
      ['窗口', '版本/天气', '结论', '原因'],
      analysis.windowClasses.map((w) => [
        w.window,
        `${w.version}/${w.weather}`,
        w.comparable ? '可用作 V1 可比证据' : '不作常规效果证据',
        w.comparable ? '晴好、已公布、有观测、无致命中断' : w.reasons.join('；'),
      ]),
    ),
  )
  lines.push('')

  if (dataset) {
    const unpublishedSlots = dataset.slots
      .filter((s) => s.announced === 'false')
      .map((s) => `${s.window}/${s.route}`)
    const unpublishedBookings = dataset.booking
      .filter((b) => b.state === '未公示')
      .map((b) => `${b.window}/${b.route}`)
    const publishedCommitments = dataset.booking
      .filter((b) => b.state === '已公示' || b.state === '已接受')
      .map((b) => `${b.window}/${b.route}(${b.role})`)
    const forcedCancellations = dataset.control
      .filter((c) => c.event.includes('取消'))
      .map((c) => `${c.window}/${c.route}`)
    lines.push('**场次身份不能混用：**')
    lines.push('')
    lines.push(`- 未公布备选：${[...unpublishedSlots, ...unpublishedBookings].join('、')}。公示前可以改派/补齐，不构成对游客或演员的公开承诺。`)
    lines.push(`- 公开约定/已接受：${publishedCommitments.join('、')}；另有 decisions.json 的 W9/B 已签记录。承诺基准场即使限流也保留为试验的一部分。`)
    lines.push(`- 现场被迫取消：${forcedCancellations.join('、')}。取消不是“对照/没来”，已占用人员在正在执行的窗口不能重新分配。`)
    lines.push(`- 道路结构：${dataset.links.filter((l) => l.state === '关闭').map((l) => `${l.version} ${l.from}-${l.to} 关闭`).join('；')}；关闭后旧邻线客流不能直接当新结构对照。`)
    lines.push('')
  }

  lines.push('## 三、有效停留与全场净流量')
  lines.push('')
  lines.push('有效停留主口径按 README 用流转记录的 `exit-entry >= 20` 判定；`checkin:"?"` 是签到点来源缺失，不直接当作“无签到”。另列严格有签到点口径作为敏感性核对。')
  lines.push('')
  lines.push('注意：`uniqueTickets` 是流转记录中的全场净票口径，只用于避免转线/重入重复计数；资料没有独立闸机计数表，不能把它冒充闸机净人流。`control.occupancy` 是场控占用，也不与流转票数相加。现有资料同样没有入口等待/截留人数，因此“限流把游客留在入口”只能由限流事件提示，不能量化为多少人；不得把后续无路线记录解释成未到场。')
  lines.push('')
  const metricRows = []
  const metricWindows = Object.entries(analysis.observationSummary.windows).sort(([a], [b]) =>
    a.localeCompare(b, undefined, { numeric: true }),
  )
  for (const [w, summary] of metricWindows) {
    for (const [route, m] of Object.entries(summary.routes)) {
      metricRows.push([
        w,
        route,
        m.actualVisits,
        m.effectiveStaysFlow,
        m.effectiveStaysConfirmed,
        m.durationQualifiedMissingCheckin,
        summary.uniqueTickets,
        summary.crossRouteTickets,
      ])
    }
  }
  lines.push(
    table(
      ['窗口', '实际路线', '路线段/访问', '流转≥20分', '其中签到点完整', '时长够但签到点缺失', '全场唯一票', '跨线票'],
      metricRows,
    ),
  )
  lines.push('')
  lines.push('### 全场净流量（可比窗口）')
  lines.push('')
  lines.push(
    table(
      ['窗口', '加场路线', '唯一票', '有效票', '有效率', '路线段合计', '跨线票'],
      analysis.networkRows.map((r) => [
        r.window,
        r.addedRoutes.join('+') || '无',
        r.uniqueTickets,
        r.effectiveTickets,
        pct(r.effectiveRate),
        r.routeSegments,
        r.crossRouteTickets,
      ]),
    ),
  )
  lines.push('')
  const ciText = (c) =>
    c.ci95[0] == null ? '区间不可构造/退化' : `95%区间 [${num(c.ci95[0])}, ${num(c.ci95[1])}]`
  lines.push(`- 全场有效票：A 加场窗均值对非 A 窗差 ${num(analysis.networkEffects.aAddVsNoA.difference)}，${ciText(analysis.networkEffects.aAddVsNoA)}。`)
  lines.push(`- 全场有效票：B 加场窗均值对非 B 窗差 ${num(analysis.networkEffects.bAddVsNoB.difference)}，${ciText(analysis.networkEffects.bAddVsNoB)}。`)
  lines.push(`- 任意加场窗相对 W0 纯对照差 ${num(analysis.networkEffects.anyAddVsW0.difference)}；对照只有 1 个登记窗口，不能给出可靠常规区间。`)
  lines.push('')

  lines.push('## 四、按预先登记时段得到的路线对比')
  lines.push('')
  lines.push('以下每个数字的聚类单位是“游线 × 时段”，不是把每张扫码记录当独立试验。样本只有 2 个直接加场时段，CI 很宽或无法用常规 Welch 区间估计；表中同时保留观测区间。')
  lines.push('')
  const effectRows = []
  for (const [route, e] of Object.entries(analysis.routeEffects)) {
    const f = e.effectiveFlow
    effectRows.push([
      route,
      `${f.direct.n} [${f.direct.min ?? '—'},${f.direct.max ?? '—'}]`,
      `${f.neighborOnly.n} [${f.neighborOnly.min ?? '—'},${f.neighborOnly.max ?? '—'}]`,
      `${f.pureControl.n} [${f.pureControl.min ?? '—'},${f.pureControl.max ?? '—'}]`,
      num(f.directVsAssignedControl.difference),
      f.directVsAssignedControl.ci95[0] == null
        ? '不可构造'
        : `[${num(f.directVsAssignedControl.ci95[0])}, ${num(f.directVsAssignedControl.ci95[1])}]`,
      num(f.neighborVsPureControl.difference),
    ])
  }
  lines.push(
    table(
      ['路线', '直接加场 n[范围]', '仅邻线暴露 n[范围]', '纯净对照 n[范围]', '直接-登记对照差', '直接差95%区间', '邻线-纯净对照差'],
      effectRows,
    ),
  )
  lines.push('')
  lines.push('解释边界：A 有 W1/W5 两个直接加场时段，B 有 W2/W6；C 从未直接加场。没有“两条线同时加场”的组合，因此交互/协同效应不可识别。V2 尚无已执行观测，不能把这些 V1 系数改标成 V2 因果效应。')
  lines.push('')

  lines.push('## 五、邻线拥堵责任与阈值')
  lines.push('')
  lines.push(`运营协议阈值：max_congestion=${thresholds.max_congestion}。比率为 control.occupancy / 对应开放 link.limit；没有 control 记录或 occupancy 为 ? 时标 unknown，不能当零拥堵。`)
  lines.push('')
  lines.push(
    table(
      ['加场窗口', '加场线', '被观察邻线', 'link/限值', '占用', '比率', '状态', '现场事件'],
      analysis.congestion.map((c) => [
        c.window,
        c.addedRoute,
        c.observedRoute,
        `${c.link ?? '—'}/${c.linkLimit ?? '—'}`,
        c.occupancy ?? '?',
        pct(c.ratio),
        c.status,
        c.event ?? '无记录',
      ]),
    ),
  )
  lines.push('')
  lines.push('- W1：A 加场后，B 在 10–20 分限流，占用 59，对应 A→B 限值 60，比率 98.3%，超过 85%。拥堵现场责任在 B 段场控，但排期层面的邻线溢出关联指向 A 加场；这是否为唯一因果原因仍需重复样本。')
  lines.push('- W2：B 加场后，C 占用 29，对应 B→C 限值 35，比率 82.9%，低于但接近 85%。该结果只适用于 B-C 开放的 V1。')
  lines.push('- W5/W6 没有 control 占用记录；不能补造为“通过”。')
  lines.push('')

  lines.push('## 六、加场/推广判定')
  lines.push('')
  const promoRows = Object.entries(analysis.promotionByRoute).map(([route, p]) => [
    route,
    p.directReplicates,
    p.controlReplicates,
    p.hasMinReplicates ? '是' : '否',
    num(p.flowAdvantage),
    num(p.confirmedAdvantage),
    p.congestionObservedWorst == null ? '未知' : pct(p.congestionObservedWorst),
    p.congestionBreaches.length ? `阻断：${p.congestionBreaches.map((c) => `${c.window} ${pct(c.ratio)}`).join('；')}` : '无已测超限',
  ])
  lines.push(
    table(
      ['路线', '直接重复', '对照重复', '达到2段', '流转优势', '完整签到优势', '最差已测拥堵', '推广核对'],
      promoRows,
    ),
  )
  lines.push('')
  lines.push('- A：有效停留信号为正，但 W1 邻线 B 已出现 98.3% 占用/限流，运营阈值下不能推广。')
  lines.push('- B：V1 有 W2/W6 两个加场段，点估计不低于 min_advantage=0，W2→C 拥堵 82.9% 未超限；这解释了早先 W9/B 已签决定。但 V2 关闭 B-C 后，该证据的新结构适用性和直接/邻线分解不足，本轮应发识别缺失通知。')
  lines.push('- C：没有直接加场重复，不能提出 C 线加场效果结论。')
  lines.push('- **按 V2 新结构重新审批时：没有任何路线已满足“至少两个 V2 同来源可比时段 + 拥堵阈值”的新推广条件。** W9/B 是此前已签承诺，按原记录执行并通知识别缺口，而不是在本轮重新认证为 V2 推广。')
  lines.push('')

  lines.push('## 七、V2 剩余组合能否分别识别直接与邻场效应')
  lines.push('')
  const ident = plan.identification
  lines.push(`V2 已执行且有观测的目标结构窗口：${ident.executedTargetObservationWindows.length ? ident.executedTargetObservationWindows.join('、') : '无（W4 只有未公布对照壳，无观测）'}。`)
  lines.push('')
  lines.push(
    table(
      ['客流来源/路段', '窗口', '暴露', '矩阵秩/参数数', '直接+邻场满秩', '加场重复', '结论'],
      ident.designChecks.map((d) => [
        `${d.source}；${d.segment}`,
        d.windows.join(','),
        Object.entries(d.addByWindow).map(([w, r]) => `${w}:${r ?? '00'}`).join('，'),
        `${d.rank}/${d.parameterCount}`,
        d.separatePointIdentification ? '是' : '否',
        `${d.addWindows}/${d.minUsableComparisons}`,
        d.meetsReplicateThreshold ? '达到重复阈值' : '不满足登记重复阈值',
      ]),
    ),
  )
  lines.push('')
  for (const d of ident.designChecks) {
    lines.push(`- ${d.source}：可回答 ${d.canReport.join('；')}；不能回答 ${d.cannotReport.join('；')}。`)
  }
  lines.push(`探索性跨来源合并：${ident.pooledExploratory.note}`)
  lines.push('')
  lines.push(`**应撤回的结论边界**：${ident.withdrawal}`)
  lines.push('')

  lines.push('## 八、后续排期安排')
  lines.push('')
  for (const rec of plan.recommendations) {
    lines.push(`### ${rec.window}：${rec.action}`)
    lines.push('')
    lines.push(`- 主安排：${rec.decision}`)
    for (const item of rec.alternatives ?? []) lines.push(`- 备选/边界：${item}`)
    for (const item of rec.caveats ?? []) lines.push(`- 注意：${item}`)
    lines.push('')
  }

  lines.push('### 容量与人员可行性速查')
  lines.push('')
  const sessionRows = Object.values(plan.sessions).map((s) => [
    `${s.window}/${s.route}`,
    s.runnable ? '可开展/承诺继续' : '按现记录不可直接加场',
    s.capacity.hasOperations ? `${s.capacity.reserved}/${s.capacity.usableCapacity}（余 ${s.capacity.remainingAfterReservations}）` : '缺 ops',
    s.blockers.join('；') || '无',
  ])
  lines.push(table(['场次', '结论', '预留/可用（扣除出口预留）', '阻断项'], sessionRows))
  lines.push('')
  lines.push('## 九、班组单场查询')
  lines.push('')
  lines.push('可运行：')
  lines.push('')
  lines.push('```sh')
  lines.push('node src/cli.js session W1 A')
  lines.push('node src/cli.js session W3 A')
  lines.push('node src/cli.js session W7 B')
  lines.push('node src/cli.js session W9 B')
  lines.push('node src/cli.js notify')
  lines.push('```')
  lines.push('')
  lines.push('查询结果会给出该场能否开展、容量/人员阻断、拥堵责任方向，以及它还能回答哪些分析问题。')
  lines.push('')

  return `${lines.join('\n')}\n`
}
