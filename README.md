# 病历本 · 个人健康档案

把历次检查报告归档，按疾病调取历史，打印给医生看。
纯前端 PWA，无构建、无依赖、无服务器 —— 数据只在你自己的手机里。

## 部署

上传到 GitHub 仓库的 `bingli/` 目录，开启 GitHub Pages 后访问
`https://<用户名>.github.io/bingli/`，用 Chrome 打开 → 菜单 → 添加到主屏幕。

**要上传的文件**（`make-icons.py` 和 `test-*.js` 不用传，但传了也无害）：

```
index.html  data.js  core.js  store.js  ai.js  print.js  app.js
sw.js  manifest.json  icon-192.png  icon-512.png  icon-maskable.png
probe.html
```

改动任何 `.js` 或 `.html` 后，**必须把 `sw.js` 里的 `VERSION` 加一**，
否则手机上会拿到新旧混合的版本。

与同域名下已有的应用互不干扰：Service Worker 作用域自动限定在 `/bingli/`，
localStorage 全部用 `bl_` 前缀，IndexedDB 库名 `bingli`。

## 文件

| 文件 | 内容 |
|---|---|
| `data.js` | 指标字典（70 条）、内置疾病（11 个）、报告类型、单位换算表。纯数据 |
| `core.js` | 判读、日期、单位归一化、指标匹配、用药区间查询、Markdown 子集。纯函数 |
| `store.js` | IndexedDB 六个 store、备份导入导出、ZIP 打包 |
| `ai.js` | DeepSeek 分析：上下文构造、提示词、调用 |
| `print.js` | 按疾病生成打印件 |
| `app.js` | 路由、各页渲染、事件处理 |
| `probe.html` | 独立的诊断页：测各家视觉大模型能否浏览器直连 |

## 测试

```bash
node test-data.js && node test-core.js && node test-store.js \
  && node test-ui.js && node test-print.js && node test-ai.js
```

515 项断言。IndexedDB 那一层不在测试范围内（不装 fake-indexeddb），
靠手机实测；所有能测的逻辑都写成了对普通对象操作的纯函数。

## 几个刻意的设计决定

**字典里的 min/max 是人群参考区间，不是治疗目标。**
糖尿病人的糖化目标是 7.0 而不是人群上限 6.0；已有斑块的人 LDL 目标可能是 1.4
而不是 3.4。个人目标存在 IndexedDB 的 `meta.targets` 里，在「更多 → 个人目标」
里改，改完不会被应用升级冲掉。

**打印件的表格行是疾病的核心项目，不是「所有出现过的项目」。**
每个疾病的 `keyInd` 是有序的，它决定行序。没有这一层，打印一个糖尿病
能出十几页纸，医生一页都不会看。

**异常在黑白打印后必须仍然认得出来。**
医院打印机大多是黑白的，屏幕上的三色体系在纸上会全部消失。
所以超标 = 加粗 + 下划线 + 箭头，偏离 = 加粗 + 箭头。

**同名不同物走 `AMBIG` 表消歧。**
TG（甘油三酯）和 Tg（甲状腺球蛋白）小写后完全相同。分不清时宁可返回
「需人工指定」也不猜 —— 把甲状腺球蛋白记成甘油三酯，比认不出来严重得多。

**备份是一等公民。**
Android 会在存储紧张时清掉 IndexedDB，手机自带的清理工具也能直接抹掉。
`navigator.storage.persist()` 通常会被批准但不是保证。首页有超过 14 天
不备份的提醒。**养成每次录完就导出一次的习惯。**

## 引用

指标字典的识别层（别名、单位、小节提示）取自
[fnos-app-health-records](https://github.com/timor-m/fnos-app-health-records)（MIT），
判读层（目标值、阈值）来自本人的上一个应用「体检记录本」。

## 免责

这是个人记录工具，不是医疗器械。达标与超标的判断依据是你自己设置的目标值，
不构成任何医学诊断或治疗建议。任何决定都请以医院原始报告和医生的判断为准。
