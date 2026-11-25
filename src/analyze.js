#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { loadDataset } from './lib/data.js'
import { buildEffectAnalysis } from './lib/analysis.js'
import { buildSchedulePlan } from './lib/planning.js'
import { buildNotifications } from './lib/notify.js'
import { renderBriefing } from './lib/report.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dataDir = new URL('../data/', import.meta.url)
const outputDir = new URL('../output/', import.meta.url)

const dataset = await loadDataset(dataDir)
const analysis = buildEffectAnalysis(dataset)
const plan = buildSchedulePlan(dataset, analysis)
const notifications = buildNotifications(dataset, analysis, plan)
const result = {
  generatedAt: new Date().toISOString(),
  thresholds: dataset.promotion[0],
  analysis,
  plan,
  notifications,
}

await mkdir(outputDir, { recursive: true })
await writeFile(new URL('analysis.json', outputDir), JSON.stringify(result, null, 2), 'utf8')
await writeFile(new URL('schedule.json', outputDir), JSON.stringify(plan.selectedSchedule, null, 2), 'utf8')
await writeFile(new URL('notifications.json', outputDir), JSON.stringify(notifications, null, 2), 'utf8')
await writeFile(new URL('排班说明.md', outputDir), renderBriefing(result, dataset), 'utf8')

console.log(`已写入 ${path.join(root, 'output', 'analysis.json')}`)
console.log(`已写入 ${path.join(root, 'output', 'schedule.json')}`)
console.log(`已写入 ${path.join(root, 'output', 'notifications.json')}`)
console.log(`已写入 ${path.join(root, 'output', '排班说明.md')}`)
