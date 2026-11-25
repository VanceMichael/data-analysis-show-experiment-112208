import assert from 'node:assert/strict'
import { test } from 'node:test'

import { loadDataset } from '../src/lib/data.js'
import { buildEffectAnalysis } from '../src/lib/analysis.js'
import { assessSession, buildSchedulePlan } from '../src/lib/planning.js'
import { buildItinerary } from '../src/lib/itinerary.js'
import { abDesignRank } from '../src/lib/identification.js'

const dataset = await loadDataset()
const analysis = buildEffectAnalysis(dataset)

test('转线票保留最早游线分配，同时只计一次全场唯一票', () => {
  const tickets = buildItinerary(dataset.observations)
  const t2 = tickets.find((t) => t.ticket === 'T2')
  assert.equal(t2.assignedRoute, 'B')
  assert.deepEqual(t2.actualRoutes, ['B', 'A'])
  assert.equal(t2.transferred, true)

  const w1 = analysis.observationSummary.windows.W1
  assert.equal(w1.uniqueTickets, 3)
  assert.equal(w1.routeSegments, 4)
  assert.equal(w1.crossRouteTickets, 1)
  assert.equal(w1.routes.A.effectiveStaysFlow, 2)
  assert.equal(w1.routes.B.effectiveStaysFlow, 1)
})

test('W3 取消/停步和 W4 未公布无观测均不进入可比效果样本', () => {
  const byWindow = Object.fromEntries(analysis.windowClasses.map((w) => [w.window, w]))
  assert.equal(byWindow.W3.comparable, false)
  assert.equal(byWindow.W3.canceled, true)
  assert.equal(byWindow.W3.pathStopped, true)
  assert.equal(byWindow.W4.comparable, false)
  assert.deepEqual(analysis.comparableWindows, ['W0', 'W1', 'W2', 'W5', 'W6'])
})

test('拥堵比率按对应开放 link 计算并保留未知值', () => {
  const find = (w, r) => analysis.congestion.find((c) => c.window === w && c.addedRoute === r && c.observedRoute === (w === 'W1' ? 'B' : 'C'))
  const w1 = find('W1', 'A')
  assert.ok(Math.abs(w1.ratio - 59 / 60) < 1e-12)
  assert.equal(w1.status, 'breach')

  const w2 = find('W2', 'B')
  assert.ok(Math.abs(w2.ratio - 29 / 35) < 1e-12)
  assert.equal(w2.status, 'within_threshold')

  const unknown = analysis.congestion.find((c) => c.window === 'W5' && c.status === 'unknown')
  assert.ok(unknown)
})

test('W7/B 因已公示 A 占用 G1 不可按现记录开展', () => {
  const session = assessSession('W7', 'B', dataset, analysis)
  assert.equal(session.runnable, false)
  assert.match(session.blockers.join(' '), /G1/)
  assert.equal(session.capacity.protectedEgressReserve, 18)
  assert.equal(session.capacity.usableCapacity, 22)
})

test('W9/A 基准场不被加场配额误杀，W9/C 候选被配额阻断', () => {
  const a = assessSession('W9', 'A', dataset, analysis)
  const c = assessSession('W9', 'C', dataset, analysis)
  assert.equal(a.runnable, true)
  assert.equal(a.blockers.length, 0)
  assert.equal(c.runnable, false)
  assert.match(c.blockers.join(' '), /max_added=1/)
})

test('W9/B 保留承诺但识别检查明确 V2 证据不足', () => {
  const plan = buildSchedulePlan(dataset, analysis)
  const b = assessSession('W9', 'B', dataset, analysis)
  assert.equal(b.runnable, true)
  assert.equal(b.decision.state, '已签')
  assert.equal(b.capacity.revision, 2)
  assert.equal(b.capacity.usableCapacity, 29)
  assert.equal(b.capacity.protectedEgressReserve, 18)
  assert.equal(plan.identification.executedTargetObservationWindows.length, 0)
  assert.ok(plan.identification.closedLinks.some((l) => l.from === 'B' && l.to === 'C'))
  assert.match(plan.identification.withdrawal, /直接\+邻场|直接与邻场|W9\/B/)
})

test('A-B 两节点设计矩阵：00+01 可作单点识别，单臂 W8 不满秩', () => {
  assert.equal(abDesignRank({ W7: null, W9: 'B' }).rank, 4)
  assert.equal(abDesignRank({ W8: 'A' }).rank < 4, true)
  assert.equal(abDesignRank({ W7: null, W8: 'A', W9: 'B' }).rank, 4)
})
