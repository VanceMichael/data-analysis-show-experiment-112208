# 流动演出加场的溢出效应与试验调整

游线之间以邻接和运力状况表示可能的相互影响。分配表与实际场控分别保存。 所有资料均为合成记录。文件编码为 UTF-8，数字、日期及标记在原始记录中均以字符串保存。问号表示来源未能提供该值；加号分隔来源系统使用的组合编号。

## 资料

一次持续同路线至少二十分钟的签到停留计作有效停留，判定依流转记录而非重复扫码次数。原排期的比较单位是游线和时段，route 表的相邻且开放关系定义相互影响资格。场控占用以人数计。

- `slots.json` 记录字段为 `window`、`route`、`weather`、`assigned`、`version`、`announced`。
- `links.json` 记录字段为 `version`、`from`、`to`、`state`、`limit`。
- `observations.json` 记录字段为 `ticket`、`window`、`route`、`entry`、`exit`、`checkin`、`repeat`。
- `control.json` 记录字段为 `window`、`route`、`start`、`end`、`event`、`occupancy`。
- `decision_windows.json` 记录字段为 `window`、`options`、`version`、`max_added`、`min_usable_comparisons`。

## 运行

使用 Node.js 22。项目无需下载第三方依赖。

```sh
npm ci --offline --ignore-scripts
npm test
```

`npm run data:check` 检查合成资料能否读取并核对相关记录的引用。资料校验脚本可以独立运行。
