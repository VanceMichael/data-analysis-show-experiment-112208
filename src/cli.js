#!/usr/bin/env node
import { loadDataset } from './lib/data.js'
import { buildEffectAnalysis } from './lib/analysis.js'
import { assessSession, buildSchedulePlan } from './lib/planning.js'
import { buildNotifications } from './lib/notify.js'

const [command, window, route] = process.argv.slice(2)
const dataset = await loadDataset(new URL('../data/', import.meta.url))
const analysis = buildEffectAnalysis(dataset)

function printSession(session) {
  console.log(`场次 ${session.window}/${session.route}（证据/排期版本：${session.version}）`)
  console.log(`结论：${session.runnable ? '可开展或属于必须继续的承诺场' : '按当前记录不可直接开展/不能作为有效效果样本'}`)
  if (session.classification.length) console.log(`性质：${session.classification.join('；')}`)
  if (session.resourcesLocked) {
    console.log('人员锁定：该场次已公布/已接受，演员与疏导角色在本执行窗口内锁定；即使现场取消也不能改派给同窗另一场')
  }
  if (session.blockers.length) {
    console.log('阻断/限制：')
    for (const blocker of session.blockers) console.log(`  - ${blocker}`)
  }
  if (session.dataGaps?.length) {
    console.log('资料边界：')
    for (const gap of session.dataGaps) console.log(`  - ${gap}`)
  }
  if (session.capacity.hasOperations) {
    const c = session.capacity
    console.log(
      `容量：计划 ${c.plannedCapacity}，出口预留 ${c.protectedEgressReserve}（受保护、不可挪用），可用 ${c.usableCapacity}，已预留 ${c.reserved}，剩余 ${c.remainingAfterReservations}${c.condition ? `，状态 ${c.condition}/rev${c.revision}` : ''}`,
    )
  }
  if (session.openNeighbors.length) console.log(`当前版本开放邻线：${session.openNeighbors.join('、')}`)
  if (session.ownControl.length) {
    console.log('本场 control 记录：')
    for (const c of session.ownControl) {
      console.log(`  - ${c.start}-${c.end} ${c.event} occupancy=${c.occupancy}`)
    }
  }
  if (session.upstreamAddedResponsibility.length) {
    console.log('拥堵责任方向：')
    for (const r of session.upstreamAddedResponsibility) {
      console.log(`  - 本场${r.controlEvent}场控记录与邻线 ${r.addedRoute} 加场同期；开放连接 ${r.link}，排期层面的溢出关联指向 ${r.addedRoute}；是否构成唯一因果责任需由重复对照判断`)
    }
  }
  if (session.adjacentControl.length) {
    console.log('邻线拥堵观测：')
    for (const c of session.adjacentControl) {
      console.log(`  - ${c.observedRoute}: ${c.event} occupancy=${c.occupancy ?? '?'} link=${c.link ?? '无'} ratio=${c.ratio == null ? '未知' : c.ratio.toFixed(3)} status=${c.status}`)
    }
  }
  if (session.analysisQuestions.length) {
    console.log('仍可回答的分析问题：')
    for (const q of session.analysisQuestions) console.log(`  - ${q}`)
  }
}

if (command === 'session' && window && route) {
  printSession(assessSession(window, route, dataset, analysis))
} else if (command === 'notify') {
  const plan = buildSchedulePlan(dataset, analysis)
  console.log(JSON.stringify(buildNotifications(dataset, analysis, plan), null, 2))
} else if (command === 'schedule') {
  const plan = buildSchedulePlan(dataset, analysis)
  console.log(JSON.stringify(plan.recommendations, null, 2))
} else {
  console.error('用法：node src/cli.js <session W R | notify | schedule>')
  process.exitCode = 1
}
