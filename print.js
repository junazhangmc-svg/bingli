"use strict";
/* ==========================================================================
 * print.js — 按疾病生成打印件
 *
 * 这是整个应用存在的理由：选一个或多个病，把相关的历史全调出来，
 * 排成医生三十秒能读完的一页纸。
 *
 * 两个贯穿始终的设计约束：
 *
 * 1. 医院打印机大多是黑白的。屏幕上靠 good/warn/bad 三色区分的异常，
 *    在纸上会全部消失 —— 所以异常必须同时用 ↑↓ 箭头、加粗和下划线表达。
 *    这不是锦上添花，是「打出来还能不能用」的问题。
 *
 * 2. 表格的行是疾病的 keyInd（有序），不是「所有出现过的项目」。
 *    否则打印一个糖尿病能出十几页纸，医生一页都不会看。
 *
 * 做法上用同页隐藏 div + window.print()，不开新窗口：
 * 在 standalone 的 PWA 里，window.open 要么被拦，要么把人踢出应用；
 * 而打印 blob 文档经常出白页（打印管线没有可等待的加载信号）。
 * ========================================================================== */

var PRINT_OPT = null;   // 上次的选择，回到打印页时保留

function defaultPrintOpt(){
  return {
    disIds: [],
    from: "", to: "",
    trend: true, meds: true, visits: true, ai: true, notes: true
  };
}

function renderPrint(){
  if (!PRINT_OPT) PRINT_OPT = defaultPrintOpt();
  var o = PRINT_OPT;
  var h = '<h2 class="sec">打印给医生看</h2>';
  h += '<p class="lede">选一个或多个病，把相关的历史全部调出来，排成一份可以直接递给医生的材料。</p>';

  if (!ST.records.length) {
    document.getElementById("v-print").innerHTML =
      h + '<div class="empty"><p>还没有记录，没什么可打印的。</p></div>';
    setFab(null);
    return;
  }

  /* 疾病选择。只列真的挂了记录的病 —— 列出一堆 0 条的病只会碍事。 */
  h += '<div class="card"><h3>选择疾病</h3><div class="checks">';
  var any = false;
  for (var i = 0; i < ST.diseases.length; i++) {
    var d = ST.diseases[i];
    var n = ST.records.filter(function(r){ return (r.dis || []).indexOf(d.id) >= 0; }).length;
    if (!n) continue;
    any = true;
    var on = o.disIds.indexOf(d.id) >= 0;
    h += '<label class="' + (on ? "on" : "") + '" for="pd-' + d.id + '">' +
         '<input type="checkbox" id="pd-' + d.id + '"' + (on ? " checked" : "") +
         ' onchange="onPrintOpt()">' + escapeHtml(d.name) + '（' + n + '）</label>';
  }
  h += '</div>';
  if (!any) h += '<p class="tiny-note">还没有给任何记录打过疾病标签。' +
                 '到「记录」里编辑一条，勾上它属于哪个病。不选也可以打印全部历史。</p>';
  h += '<p class="tiny-note">一个都不选 = 打印全部记录。</p></div>';

  h += '<div class="card"><h3>时间范围</h3>' +
       '<label for="p-from">从（留空表示最早）</label>' +
       '<input type="date" id="p-from" value="' + escapeHtml(o.from) + '" onchange="onPrintOpt()">' +
       '<label for="p-to">到（留空表示最新）</label>' +
       '<input type="date" id="p-to" value="' + escapeHtml(o.to) + '" onchange="onPrintOpt()">' +
       '</div>';

  h += '<div class="card"><h3>包含哪些部分</h3><div class="checks">' +
    optBox("trend",  "关键指标趋势表", o.trend) +
    optBox("meds",   "用药时间线",     o.meds) +
    optBox("visits", "逐次就诊详情",   o.visits) +
    optBox("notes",  "指标说明尾注",   o.notes) +
    optBox("ai",     "AI 分析（如果有）", o.ai) +
    '</div></div>';

  h += '<div class="row">' +
    '<button class="btn solid" onclick="doPrint()">打印 / 存成 PDF</button>' +
    '<button class="btn" onclick="savePrintHtml()">导出 HTML</button>' +
    '</div>';
  h += '<p class="tiny-note">手机上点「打印」后，在弹出的对话框里选「另存为 PDF」，' +
       '出来的是文字可选、中文清晰的正规 PDF。<br>' +
       '导出 HTML 是一个自带样式的单文件，发到电脑上打开，打印效果完全一样。</p>';

  /* AI 分析放在这里而不是单独一页：它的范围就该和打印范围一致，
     分析完直接勾上「AI 分析」就能带进打印件。 */
  h += (typeof aiBlock === "function") ? aiBlock(o.disIds) : "";

  h += '<h2 class="sec">预览</h2>';
  h += '<p class="tiny-note">下面就是要打印的内容，不用盲打。</p>';
  h += '<div class="card" id="p-prev" style="font-size:14px">' + buildPrintDoc(o) + '</div>';

  document.getElementById("v-print").innerHTML = h;
  setFab(null);
}

function optBox(key, label, on){
  return '<label class="' + (on ? "on" : "") + '" for="po-' + key + '">' +
         '<input type="checkbox" id="po-' + key + '"' + (on ? " checked" : "") +
         ' onchange="onPrintOpt()">' + escapeHtml(label) + '</label>';
}

function onPrintOpt(){
  var o = defaultPrintOpt();
  for (var i = 0; i < ST.diseases.length; i++) {
    var c = document.getElementById("pd-" + ST.diseases[i].id);
    if (c && c.checked) o.disIds.push(ST.diseases[i].id);
  }
  var f = document.getElementById("p-from"), t2 = document.getElementById("p-to");
  o.from = f ? f.value : ""; o.to = t2 ? t2.value : "";
  ["trend","meds","visits","ai","notes"].forEach(function(k){
    var b = document.getElementById("po-" + k);
    o[k] = b ? b.checked : true;
  });
  PRINT_OPT = o;
  renderPrint();
}

/* ==========================================================================
 * 取数
 * ========================================================================== */
function printRecords(o){
  var rs = recordsForDiseases(ST.records, o.disIds);
  if (o.from) rs = rs.filter(function(r){ return r.date >= o.from; });
  if (o.to)   rs = rs.filter(function(r){ return r.date <= o.to; });
  return rs;                    // 已是日期倒序
}

/* 趋势表的行：所选疾病的 keyInd 并集；一个病都没选时退回到
   「这批记录里实际出现过的项目」，仍按字典顺序排，不按出现顺序。 */
function printRows(o, rs){
  var keys = keyIndUnion(ST.diseases, o.disIds);
  if (!keys.length) {
    var seen = {};
    for (var i = 0; i < rs.length; i++)
      for (var k in rs[i].v)
        if (rs[i].v[k] != null && rs[i].v[k] !== "") seen[k] = 1;
    keys = IND.filter(function(x){ return seen[x.k]; }).map(function(x){ return x.k; });
  }
  /* 一项都没测过的行不要出现在纸上 */
  return keys.filter(function(k){
    for (var i = 0; i < rs.length; i++)
      if (rs[i].v && rs[i].v[k] != null && rs[i].v[k] !== "") return true;
    return false;
  });
}

/* 列：有数值的日期，最新在右（视线落点就是「现在」）。
   超过 12 列时保留最早一列加最近 11 列 —— 基线和近况都不能丢。 */
var MAX_COLS = 12;
function printCols(rs, rows){
  var dates = [];
  for (var i = rs.length - 1; i >= 0; i--) {          // 反过来 = 时间正序
    var r = rs[i], has = false;
    for (var j = 0; j < rows.length; j++)
      if (r.v && r.v[rows[j]] != null && r.v[rows[j]] !== "") { has = true; break; }
    if (has) dates.push(r.date);
  }
  dates = dates.filter(function(d, i2){ return dates.indexOf(d) === i2; });
  if (dates.length <= MAX_COLS) return { dates: dates, omitted: 0, total: dates.length };
  var keep = [dates[0]].concat(dates.slice(dates.length - (MAX_COLS - 1)));
  return { dates: keep, omitted: dates.length - keep.length, total: dates.length };
}

/* 某日期该指标的值，取当天最后录入的那条 */
function valOn(rs, date, k){
  for (var i = 0; i < rs.length; i++)
    if (rs[i].date === date && rs[i].v && rs[i].v[k] != null && rs[i].v[k] !== "")
      return rs[i].v[k];
  return null;
}

/* ==========================================================================
 * 生成文档
 * ========================================================================== */
function buildPrintDoc(o){
  var rs = printRecords(o);
  if (!rs.length)
    return '<p class="lede">这些条件下没有记录。放宽疾病或时间范围试试。</p>';

  var h = "";
  h += pCover(o, rs);
  if (o.trend)  h += pTrend(o, rs);
  if (o.meds)   h += pMeds(o, rs);
  if (o.visits) h += pVisits(o, rs);
  if (o.ai)     h += pAI(o);
  if (o.notes)  h += pNotes(o, rs);
  h += pFooter();
  return h;
}

function pCover(o, rs){
  var who = lsGet(LS.bg);
  var names = o.disIds.length
    ? o.disIds.map(disName).join(" · ")
    : "全部记录";
  var span = rs[rs.length - 1].date + " 至 " + rs[0].date;
  return '<div class="p-block" style="border-bottom:2px solid var(--rule);padding-bottom:10px;margin-bottom:14px">' +
    '<h2 style="font-family:var(--serif);font-size:19px;margin:0 0 4px">' +
      escapeHtml(names) + ' · 历次检查汇总</h2>' +
    '<p class="tiny-note" style="margin:0">' +
      escapeHtml(span) + ' 共 ' + rs.length + ' 次记录　·　生成于 ' + today() + '</p>' +
    (who ? '<p class="tiny-note" style="margin:6px 0 0">' + escapeHtml(who) + '</p>' : "") +
  '</div>';
}

/* ---- 关键指标趋势表 ---- */
function pTrend(o, rs){
  var rows = printRows(o, rs);
  if (!rows.length) return "";
  var col = printCols(rs, rows);
  if (!col.dates.length) return "";

  var h = '<div class="p-block"><h3 class="grp-title">关键指标</h3>';
  if (col.omitted)
    h += '<p class="tiny-note">共 ' + col.total + ' 次，为便于阅读只列出最早一次和最近 ' +
         (col.dates.length - 1) + ' 次。</p>';

  h += '<div style="overflow-x:auto"><table style="border-collapse:collapse;width:100%;font-size:13px">';
  h += '<thead><tr><th style="text-align:left;padding:5px 6px;border-bottom:1.5px solid var(--rule)">项目</th>';
  for (var c = 0; c < col.dates.length; c++)
    h += '<th style="text-align:right;padding:5px 6px;border-bottom:1.5px solid var(--rule);' +
         'font-family:var(--mono);font-weight:600;white-space:nowrap">' +
         escapeHtml(col.dates[c].slice(2)) + '</th>';
  h += '</tr></thead><tbody>';

  var lastCat = null;
  for (var i = 0; i < rows.length; i++) {
    var it = ind(rows[i]);
    if (!it) continue;
    if (it.cat !== lastCat) {
      lastCat = it.cat;
      h += '<tr><td colspan="' + (col.dates.length + 1) + '" ' +
           'style="padding:9px 6px 2px;font-weight:600;color:var(--accent);font-size:12.5px">' +
           escapeHtml(it.cat) + '</td></tr>';
    }
    h += '<tr><td style="padding:5px 6px;border-bottom:1px solid var(--rule-soft)">' +
         escapeHtml(it.n) +
         (it.t ? ' <span style="color:var(--ink-faint);font-size:11.5px">目标 ' +
                 escapeHtml(it.t) + (it._custom ? "（个人）" : "") + '</span>' : "") +
         (it.u ? ' <span style="color:var(--ink-faint);font-size:11.5px">' +
                 escapeHtml(it.u) + '</span>' : "") +
         '</td>';
    for (var d2 = 0; d2 < col.dates.length; d2++) {
      var v = valOn(rs, col.dates[d2], it.k);
      h += '<td style="padding:5px 6px;text-align:right;font-family:var(--mono);' +
           'white-space:nowrap;border-bottom:1px solid var(--rule-soft)">' +
           cellHtml(it, v) + '</td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table></div>';
  h += '<p class="tiny-note" style="margin-top:6px">' +
       '↑ 高于目标　↓ 低于目标　<span class="p-abn">加粗下划线 = 超标</span>　— 未测</p>';
  return h + '</div>';
}

/* 偏离方向。
 * 定性项必须先判掉：parseFloat("2+") 会返回 2，
 * 走数值分支的话尿蛋白 2+ 会因为没有 min/max 而丢掉异常标记。 */
function dirArrow(it, v){
  if (it.sel) return "!";                 // 定性项没有方向可言，只标「异常」
  var x = parseFloat(v);
  if (!isFinite(x)) return "!";
  if (it.max != null && x > it.max) return "↑";
  if (it.min != null && x < it.min) return "↓";
  return "!";
}

/* 单元格。黑白打印后颜色全没了，所以异常必须靠箭头和字重表达。 */
function cellHtml(it, v){
  if (v == null || v === "") return '<span style="color:var(--ink-faint)">—</span>';
  var j = judge(it, v);
  var txt = escapeHtml(v);
  if (!j || j.lv === "good") return txt;
  var dir = dirArrow(it, v);
  return (j.lv === "bad" ? '<span class="p-abn">' : '<span style="font-weight:600">') +
         txt + " " + dir + '</span>';
}

/* ---- 用药时间线 ---- */
function pMeds(o, rs){
  var first = rs[rs.length - 1].date, last = rs[0].date;
  var ms = medsOverlapping(ST.meds, first, last);
  if (!ms.length) return "";

  var h = '<div class="p-block"><h3 class="grp-title">用药</h3>';
  h += '<table style="border-collapse:collapse;width:100%;font-size:13px"><thead><tr>' +
    ["药名","剂量","频次","开始","停用"].map(function(x){
      return '<th style="text-align:left;padding:5px 6px;font-size:12px;' +
             'border-bottom:1.5px solid var(--rule)">' + x + '</th>';
    }).join("") +
    '</tr></thead><tbody>';
  for (var i = 0; i < ms.length; i++) {
    var m = ms[i];
    h += '<tr>' +
      td(m.name, true) + td(m.dose || "—") + td(m.freq || "—") +
      td(m.start) + td(m.stop || "至今") + '</tr>';
  }
  h += '</tbody></table>';

  /* 医生真正想看的是这个：每次抽血时人在吃什么。
     指标的变化只有放在用药背景里才有意义。 */
  h += '<p class="tiny-note" style="margin-top:9px;font-weight:600">每次检查时正在服用</p>';
  for (var j = rs.length - 1; j >= 0; j--) {
    var act = medsActiveOn(ST.meds, rs[j].date);
    h += '<p class="tiny-note" style="margin:2px 0">' +
         '<span style="font-family:var(--mono)">' + escapeHtml(rs[j].date) + '</span>　' +
         (act.length ? escapeHtml(act.map(function(m2){
                          return m2.name + (m2.dose ? " " + m2.dose : ""); }).join("、"))
                     : '<span style="color:var(--ink-faint)">无记录</span>') +
         '</p>';
  }
  return h + '</div>';

  function td(s, bold){
    return '<td style="padding:5px 6px;border-bottom:1px solid var(--rule-soft)' +
           (bold ? ";font-weight:600" : "") + '">' + escapeHtml(s) + '</td>';
  }
}

/* ---- 逐次就诊 ---- */
function pVisits(o, rs){
  var h = '<div class="p-block"><h3 class="grp-title">逐次记录</h3>';
  for (var i = 0; i < rs.length; i++) {
    var r = rs[i];
    h += '<div class="p-visit" style="margin:12px 0;padding-bottom:10px;' +
         'border-bottom:1px solid var(--rule-soft)">';
    h += '<p style="margin:0 0 3px;font-weight:600;font-size:14px">' +
         '<span style="font-family:var(--mono)">' + escapeHtml(r.date) + '</span>　' +
         escapeHtml(r.title || "未命名") + '</p>';
    var meta = [typeLabel(r.type), r.hospital, r.dept].filter(Boolean).join(" · ");
    if (meta) h += '<p class="tiny-note" style="margin:0 0 5px">' + escapeHtml(meta) + '</p>';

    var texts = [["dx","临床诊断"],["findings","检查所见"],["impression","结论"],
                 ["recommendation","复查建议"]];
    for (var m = 0; m < texts.length; m++) {
      if (!r[texts[m][0]]) continue;
      h += '<p class="tiny-note" style="margin:3px 0"><b>' + texts[m][1] + '：</b>' +
           escapeHtml(r[texts[m][0]]) + '</p>';
    }

    /* 这次测了哪些、结果如何。异常项排在前面 —— 医生先看的就是这些。 */
    var items = IND.filter(function(x){
      return r.v && r.v[x.k] != null && r.v[x.k] !== ""; });
    if (items.length) {
      var abn = [], nor = [];
      for (var j = 0; j < items.length; j++) {
        var it = ind(items[j].k), ju = judge(it, r.v[it.k]);
        var s = escapeHtml(it.n) + " " + escapeHtml(r.v[it.k]) + (it.u ? escapeHtml(it.u) : "");
        if (ju && ju.lv === "bad")
          abn.push('<span class="p-abn">' + s + " " + dirArrow(it, r.v[it.k]) + "</span>");
        else if (ju && ju.lv === "warn")
          abn.push('<span style="font-weight:600">' + s + " " + dirArrow(it, r.v[it.k]) + "</span>");
        else nor.push(s);
      }
      if (abn.length) h += '<p class="tiny-note" style="margin:4px 0"><b>需关注：</b>' +
                           abn.join("　") + '</p>';
      if (nor.length) h += '<p class="tiny-note" style="margin:2px 0;color:var(--ink-faint)">' +
                           '其余正常：' + nor.join("　") + '</p>';
    }
    if (r.note) h += '<p class="tiny-note" style="margin:4px 0"><b>本人备注：</b>' +
                     escapeHtml(r.note) + '</p>';
    h += '</div>';
  }
  return h + '</div>';
}

/* ---- AI 分析（有存档才出现） ---- */
function pAI(o){
  if (typeof lastAI !== "function") return "";
  var a = lastAI(o.disIds);
  if (!a || !a.output) return "";
  return '<div class="p-block" style="border:1px solid var(--rule);border-radius:6px;' +
    'padding:10px 12px;margin-top:14px">' +
    '<p style="margin:0 0 4px;font-weight:600;font-size:13px">' +
      'AI 整理的观察（不是诊断，仅供参考）</p>' +
    '<p class="tiny-note" style="margin:0 0 6px">' +
      '由 ' + escapeHtml(a.model || "大模型") + ' 生成于 ' + escapeHtml((a.at || "").slice(0, 10)) +
      '。内容未经医生审核，如与医生判断不一致，以医生为准。</p>' +
    '<div class="ai-res" style="font-size:13px">' + mdLite(a.output) + '</div></div>';
}

/* ---- 尾注：只解释这份材料里真正用到的指标 ---- */
function pNotes(o, rs){
  var rows = printRows(o, rs);
  var used = rows.map(function(k){ return indByKey(k); })
                 .filter(function(x){ return x && x.exp; });
  if (!used.length) return "";
  var h = '<div class="p-block" style="margin-top:14px"><h3 class="grp-title">指标说明</h3>';
  for (var i = 0; i < used.length; i++)
    h += '<p class="tiny-note" style="margin:3px 0"><b>' + escapeHtml(used[i].n) + '</b>　' +
         escapeHtml(used[i].exp) + '</p>';
  return h + '</div>';
}

function pFooter(){
  return '<div class="p-block" style="margin-top:16px;padding-top:8px;' +
    'border-top:1px solid var(--rule)">' +
    '<p class="tiny-note" style="margin:0">' +
    '本材料由个人健康记录应用「病历本」自动汇总，数据由本人录入或拍照识别后人工核对，' +
    '可能存在录入误差，<b>请以医院原始报告为准</b>。达标与超标的判断依据是本人设置的目标值，' +
    '不构成任何医学诊断或治疗建议。</p></div>';
}

/* ==========================================================================
 * 输出
 * ========================================================================== */
function doPrint(){
  var root = document.getElementById("print-root");
  root.innerHTML = buildPrintDoc(PRINT_OPT || defaultPrintOpt());
  /* afterprint 在部分安卓浏览器上不触发，所以再挂一个兜底定时清理，
     否则打印内容会一直留在 DOM 里。 */
  var cleaned = false;
  function cleanup(){
    if (cleaned) return;
    cleaned = true;
    root.innerHTML = "";
    window.removeEventListener("afterprint", cleanup);
  }
  window.addEventListener("afterprint", cleanup);
  setTimeout(cleanup, 60000);
  setTimeout(function(){ window.print(); }, 30);   // 给一帧时间完成布局
}

/* 导出成自带样式的单文件 HTML —— 发到电脑上打开，打印效果完全一样 */
function savePrintHtml(){
  var css = "";
  var sheets = document.styleSheets;
  for (var i = 0; i < sheets.length; i++) {
    try {
      var rules = sheets[i].cssRules;
      for (var j = 0; j < rules.length; j++) css += rules[j].cssText + "\n";
    } catch (e) { /* 跨域样式表读不到，这里没有 */ }
  }
  var body = buildPrintDoc(PRINT_OPT || defaultPrintOpt());
  var html = '<!doctype html>\n<html lang="zh-CN">\n<head>\n' +
    '<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>检查汇总 ' + today() + '</title>\n<style>\n' + css +
    '\n/* 导出版：没有应用外壳，正文直接铺开 */\n' +
    'body{padding:24px 18px;max-width:900px;margin:0 auto}\n' +
    '#print-root{display:block}\n' +
    '</style>\n</head>\n<body><div id="print-root">' + body + '</div></body>\n</html>';
  /* 加 BOM：有些安卓文件管理器和 Windows 记事本不看 meta charset，会出乱码 */
  download("检查汇总-" + today() + ".html", "﻿" + html, "text/html;charset=utf-8");
  toast("已导出，可发到电脑上打印");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { defaultPrintOpt, buildPrintDoc, printRecords, printRows,
                     printCols, valOn, cellHtml, MAX_COLS };
}
