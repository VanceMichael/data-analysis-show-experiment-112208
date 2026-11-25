# 流动演出加场的溢出效应与试验调整

游线之间以邻接和运力状况表示可能的相互影响。分配表与实际场控分别保存。 所有资料均为合成记录。文件编码为 UTF-8，数字、日期及标记在原始记录中均以字符串保存。问号表示来源未能提供该值；加号分隔来源系统使用的组合编号。

## 资料

一次持续同路线至少二十分钟的签到停留计作有效停留，判定依流转记录而非重复扫码次数。原排期的比较单位是游线和时段，route 表的相邻且开放关系定义相互影响资格。场控占用以人数计。

- `slots.json` 记录字段为 `window`、`route`、`weather`、`assigned`、`version`、`announced`。
- `links.json` 记录字段为 `version`、`from`、`to`、`state`、`limit`。
- `observations.json` 记录字段为 `ticket`、`window`、`route`、`entry`、`exit`、`checkin`、`repeat`。
- `control.json` 记录字段为 `window`、`route`、`start`、`end`、`event`、`occupancy`。
- `decision_windows.json` 记录字段为 `window`、`options`、`version`、`max_added`、`min_usable_comparisons`。
- `booking.json` 记录字段为 `window`、`route`、`guide`、`actor`、`role`、`reserved`、`state`。
- `operations.json` 记录字段为 `window`、`route`、`planned_capacity`、`egress_reserve`、`source`、`revision`、`condition`。
- `decisions.json` 记录字段为 `accepted_window`、`route`、`evidence_version`、`kind`、`state`。
- `promotion.json` 记录字段为 `version`、`min_observations`、`min_advantage`、`max_congestion`。

## 运行

使用 Node.js 22。项目无需下载第三方依赖。

```sh
npm ci --offline --ignore-scripts
npm test
npm run analyze
```

`npm run analyze` 会生成：

- `output/analysis.json`：窗口可比性、有效停留、净流量、拥堵比率、推广阈值和识别矩阵；
- `output/schedule.json`：建议的 W7–W9 场次选择、承诺场、阻断候选和条件改派；
- `output/notifications.json`：需要发给游线/排班会的识别条件、人员和配额通知；
- `output/排班说明.md`：可直接带到排班会的中文说明。

单场查询：

```sh
node src/cli.js session W1 A
node src/cli.js session W7 B
node src/cli.js session W9 B
node src/cli.js notify
```

查询结果区分未公布备选、公开约定场和现场取消场，并给出版本化邻线、拥堵责任方向、容量/人员阻断以及该场仍可回答的分析问题。分析代码只读取 `data/`，不会改写原始排期或 `decisions.json`。

`npm run data:check` 检查合成资料能否读取并核对相关记录的引用。资料校验脚本可以独立运行。
