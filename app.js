"use strict";
/* ==========================================================================
 * app.js — 路由、渲染、全局事件处理
 *
 * 约定：所有处理函数都是全局函数，从模板字符串里的内联 onclick 调用。
 * 这不是疏忽 —— 正是这个约定让整套视图代码保持无框架、无构建、可直接阅读。
 * 代价是 CSP 必须允许 script-src 'unsafe-inline'，这一点在计划里已记录。
 *
 * 所有用户提供的内容进入模板字符串之前一律过 escapeHtml。
 * ========================================================================== */

var VIEW = "home";
var ST = { records: [], diseases: [], meds: [], targets: {}, ready: false };
var EDIT_ID = null;      // 正在编辑的记录 id；null 表示新建

/* 录入页的分类快捷键。16 个分类全列出来按钮太多，按化验单类型归成 6 组。 */
var SCOPES = {
  common: { label:"生化 + 血脂", cats:["血脂","血糖","肝功能","肾功能","电解质"] },
  blood:  { label:"血常规 + 甲功", cats:["血常规","甲状腺功能","内分泌","肌酶"] },
  urine:  { label:"尿 + 基础",    cats:["尿常规","基础测量"] },
  img:    { label:"影像 + 功能",  cats:["影像与功能","影像所见","心电图","耳鼻喉检查","妇科超声"] },
  inf:    { label:"感染筛查",     cats:["感染筛查"] },
  all:    { label:"全部",         cats:CATS }
};

function uiGet(k, dflt){
  try { var o = JSON.parse(lsGet(LS.ui) || "{}"); return k in o ? o[k] : dflt; }
  catch(e){ return dflt; }
}
function uiSet(k, v){
  var o;
  try { o = JSON.parse(lsGet(LS.ui) || "{}"); } catch(e){ o = {}; }
  o[k] = v;
  lsSet(LS.ui, JSON.stringify(o));
}
function entryScope(){ var s = uiGet("scope", "common"); return SCOPES[s] ? s : "common"; }

/* 带个人目标的字典条目 */
function ind(k){ return withTarget(indByKey(k), ST.targets); }
function disById(id){
  for (var i = 0; i < ST.diseases.length; i++) if (ST.diseases[i].id === id) return ST.diseases[i];
  return null;
}
function disName(id){ var d = disById(id); return d ? d.name : id; }

/* ==========================================================================
 * 启动与路由
 * ========================================================================== */
function boot(){
  openDB()
    .then(seedOnce)
    .then(reload)
    .then(function(){
      ST.ready = true;
      render();
      requestPersist();          // 已安装的 PWA 通常会被批准，但不保证
    })
    .catch(function(e){
      document.getElementById("v-home").innerHTML =
        '<div class="card flag-bad"><h3>打不开本地数据库</h3>' +
        '<p class="lede">浏览器可能处于无痕模式，或禁用了网站数据。' +
        '请用普通标签页打开，或把本应用添加到主屏幕后从图标进入。</p>' +
        '<p class="tiny-note">' + escapeHtml(e && e.message || String(e)) + '</p></div>';
    });
}

function reload(){
  return Promise.all([loadRecords(), loadDiseases(), loadMeds(), loadTargets(),
                      typeof loadAICache === "function" ? loadAICache() : null])
    .then(function(r){
      ST.records = r[0]; ST.diseases = r[1]; ST.meds = r[2]; ST.targets = r[3] || {};
    });
}

var TABS = ["home","hist","meds","more"];
function go(v){
  VIEW = v;
  var all = TABS.concat(["entry","print"]);
  for (var i = 0; i < all.length; i++) {
    var el = document.getElementById("v-" + all[i]);
    if (el) el.hidden = (all[i] !== v);
  }
  for (var j = 0; j < TABS.length; j++) {
    var tb = document.getElementById("t-" + TABS[j]);
    /* entry / print 是从某个标签页推进去的子页面，保持来源标签高亮 */
    var on = TABS[j] === v ||
             (v === "entry" && TABS[j] === "hist") ||
             (v === "print" && TABS[j] === "more");
    if (tb) tb.setAttribute("aria-selected", String(on));
  }
  window.scrollTo(0, 0);
  render();
}

function render(){
  if (!ST.ready) return;
  if (VIEW === "home")  renderHome();
  if (VIEW === "hist")  renderHist();
  if (VIEW === "meds")  renderMeds();
  if (VIEW === "more")  renderMore();
  if (VIEW === "entry") renderEntry();
  if (VIEW === "print") renderPrint();
}

function refresh(){ return reload().then(render); }

/* ==========================================================================
 * 首页
 * ========================================================================== */
function renderHome(){
  var rs = ST.records;
  var h = "";

  h += backupNag();

  /* 打印是这个应用的主要用途，放在首页最上面而不是埋进设置里 */
  if (rs.length)
    h += '<div class="row" style="margin-top:14px">' +
         '<button class="btn solid" onclick="go(\'print\')">按疾病整理，打印给医生</button>' +
         '</div>';

  h += '<h2 class="sec">最近一次</h2>';
  h += rs.length ? latestBanner(rs)
     : '<div class="empty"><p>还没有任何记录。</p>' +
       '<p class="tiny-note">从「记录」页新建，或在「更多」里导入已有的备份文件。</p></div>';

  h += currentMeds();
  h += dueCards();

  document.getElementById("v-home").innerHTML = h;
  setFab(null);
}

/* 备份提醒。这一条比任何 API 都更能防数据丢失 —— Android 会在存储紧张时
   清掉 IndexedDB，手机自带的清理工具也能直接抹掉。 */
function backupNag(){
  if (!ST.records.length) return "";
  var last = lsGet(LS.nag);
  if (!last) return '<div class="card flag-warn tight"><h3>还没备份过</h3>' +
    '<p class="tiny-note">数据只存在这台手机里。到「更多 → 备份」导出一次，' +
    '发给自己存着。</p></div>';
  var days = daysBetween(last, today());
  if (days < 14) return "";
  return '<div class="card flag-warn tight"><h3>上次备份是 ' + days + ' 天前</h3>' +
    '<p class="tiny-note">建议每次录完就导出一份。</p></div>';
}

function latestBanner(rs){
  var r = rs[0];
  var bad = [], warn = [], n = 0;
  for (var k in r.v) {
    if (!Object.prototype.hasOwnProperty.call(r.v, k)) continue;
    if (r.v[k] == null || r.v[k] === "") continue;
    n++;
    var j = judge(ind(k), r.v[k]);
    if (!j) continue;
    var nm = indByKey(k) ? indByKey(k).n : k;
    if (j.lv === "bad") bad.push(nm);
    else if (j.lv === "warn") warn.push(nm);
  }
  var cls, main, sub;
  if (!n) {
    /* 没有数值时要明说，否则光贴出备注会让人以为「一切正常」 */
    cls = ""; main = escapeHtml(r.title || "一条记录") + " · 仅记事，没有可判读的数值";
    sub = r.note ? escapeHtml(r.note.slice(0, 46)) : "";
  } else if (bad.length) {
    cls = " l-bad"; main = "有 " + bad.length + " 项超标";
    sub = escapeHtml(bad.slice(0, 4).join("、")) + (bad.length > 4 ? " 等" : "");
  } else if (warn.length) {
    cls = " l-warn"; main = "有 " + warn.length + " 项轻度偏离";
    sub = escapeHtml(warn.slice(0, 4).join("、")) + (warn.length > 4 ? " 等" : "");
  } else {
    cls = " l-good"; main = n + " 项全部达标"; sub = escapeHtml(r.title || "");
  }
  return '<button class="latest' + cls + '" onclick="openRec(\'' + r.id + '\')">' +
    '<div class="l-date">' + escapeHtml(r.date) + ' · ' + escapeHtml(typeLabel(r.type)) + '</div>' +
    '<div class="l-main">' + main + '</div>' +
    '<div>' + sub + '</div>' +
    '<div class="l-more">看详情 →</div></button>';
}

function currentMeds(){
  var act = medsActiveOn(ST.meds, today());
  if (!act.length) return "";
  var h = '<h2 class="sec">当前在吃</h2><div class="card tight">';
  for (var i = 0; i < act.length; i++) {
    h += '<div class="v-row"><div class="v-n">' + escapeHtml(act[i].name) + '</div>' +
         '<div class="v-t">' + escapeHtml([act[i].dose, act[i].freq].filter(Boolean).join(" ")) + '</div>' +
         '<div class="v-note">自 ' + escapeHtml(act[i].start) + ' 起</div></div>';
  }
  return h + '</div>';
}

function dueCards(){
  var h = '<h2 class="sec">下次该查什么</h2>', any = false;
  for (var i = 0; i < GS.length; i++) {
    var g = GS[i];
    if (!GRP[g].days) continue;                   // 不定期的组不排期
    var d = dueInfo(ST.records, g);
    any = true;
    var flag = d.state === "over" ? "bad" : (d.state === "soon" ? "warn" : "good");
    var when = d.last == null ? "从未查过"
             : (d.left < 0 ? "已过期 " + (-d.left) + " 天"
                           : (d.left === 0 ? "就是今天" : "还有 " + d.left + " 天"));
    h += '<div class="card tight flag-' + flag + '">' +
         '<h3>' + escapeHtml(GRP[g].name) + ' <span class="pill p-' + flag + '">' + when + '</span></h3>' +
         '<p class="tiny-note">' + escapeHtml(GRP[g].why) +
         (d.last ? ' · 上次 ' + escapeHtml(d.last) + ' → 应于 ' + escapeHtml(d.due) : "") +
         '</p></div>';
  }
  h += '<details class="fold"><summary>每组分别要查哪些项目</summary>';
  for (var j = 0; j < GS.length; j++) {
    var names = IND.filter(function(x){ return x.g === GS[j]; }).map(function(x){ return x.n; });
    if (!names.length) continue;
    h += '<p class="tiny-note"><b>' + escapeHtml(GRP[GS[j]].name) + '</b><br>' +
         escapeHtml(names.join("、")) + '</p>';
  }
  h += '</details>';
  return any ? h : "";
}

/* ==========================================================================
 * 记录列表
 * ========================================================================== */
function renderHist(){
  var rs = ST.records;
  var h = "";
  if (!rs.length) {
    h = '<div class="empty"><p>还没有记录。</p>' +
        '<p class="tiny-note">点下方按钮新建一条，或到「更多」导入备份。</p></div>';
  } else {
    h += '<p class="lede">共 ' + rs.length + ' 条，' +
         escapeHtml(rs[rs.length - 1].date) + ' 至 ' + escapeHtml(rs[0].date) + '</p>';
    for (var i = 0; i < rs.length; i++) h += histItem(rs[i], i === 0);
  }
  document.getElementById("v-hist").innerHTML = h;
  setFab("＋ 新建一条记录", function(){ newRec(); });
}

function histItem(r, open){
  var cnt = { good:0, warn:0, bad:0 }, filled = 0;
  for (var k in r.v) {
    if (!Object.prototype.hasOwnProperty.call(r.v, k)) continue;
    if (r.v[k] == null || r.v[k] === "") continue;
    filled++;
    var j = judge(ind(k), r.v[k]);
    if (j) cnt[j.lv]++;
  }
  var pill = !filled ? '<span class="pill p-idle">仅记事</span>'
    : cnt.bad ? '<span class="pill p-bad">' + cnt.bad + ' 项超标</span>'
    : cnt.warn ? '<span class="pill p-warn">' + cnt.warn + ' 项偏离</span>'
    : '<span class="pill p-good">全部达标</span>';

  var tags = (r.dis || []).map(function(id){
    var d = disById(id);
    return '<span class="pill p-' + (d && d.color || "accent") + '">' +
           escapeHtml(d ? d.short || d.name : id) + '</span>';
  }).join("");

  var prev = Object.keys(r.v || {}).filter(function(k){ return r.v[k] !== ""; })
    .map(function(k){ return indByKey(k) ? indByKey(k).n : k; }).join("、");

  return '<details class="hrec"' + (open ? " open" : "") + '>' +
    '<summary><div class="h-top"><span class="h-date">' + escapeHtml(r.date) + '</span>' +
      '<span class="h-title">' + escapeHtml(r.title || "未命名") + '</span>' + pill + '</div>' +
      '<div class="h-meta">' +
        escapeHtml([typeLabel(r.type), r.hospital, r.dept].filter(Boolean).join(" · ")) +
      '</div>' +
      (tags ? '<div class="h-tags">' + tags + '</div>' : "") +
      (prev ? '<div class="h-prev">' + escapeHtml(prev) + '</div>' : "") +
    '</summary>' +
    '<div class="h-body">' + recBody(r) + '</div></details>';
}

function recBody(r){
  var h = "";
  var texts = [["dx","临床诊断"],["findings","检查所见"],["impression","结论"],
               ["summary","摘要"],["recommendation","复查建议"]];
  for (var i = 0; i < texts.length; i++) {
    var v = r[texts[i][0]];
    if (!v) continue;
    h += '<p class="tiny-note" style="margin-top:10px"><b>' + texts[i][1] + '</b><br>' +
         escapeHtml(v) + '</p>';
  }
  if (r.recheckDue)
    h += '<p class="tiny-note"><b>下次复查</b> ' + escapeHtml(r.recheckDue) + '</p>';

  h += verdictRows(r);

  if (r.note)
    h += '<div class="summary"><b>备注</b><br>' + escapeHtml(r.note) + '</div>';

  var act = medsActiveOn(ST.meds, r.date);
  if (act.length)
    h += '<p class="tiny-note" style="margin-top:10px"><b>这次检查时在用的药</b><br>' +
         escapeHtml(act.map(medLabel).join("；")) + '</p>';

  if (r._dup && r._dup.length)
    h += '<div class="card flag-warn tight"><p class="tiny-note">' +
         '同一张单子上有重复项目（' +
         escapeHtml(r._dup.map(function(k){ return indByKey(k) ? indByKey(k).n : k; }).join("、")) +
         '），只保留了第一条。多半是识别串行了，建议核对原件。</p></div>';

  h += '<div class="row">' +
    '<button class="btn tiny" onclick="editRec(\'' + r.id + '\')">编辑</button>' +
    '<button class="btn tiny" onclick="copyRec(\'' + r.id + '\')">复制文本</button>' +
    '<button class="btn tiny danger no-print" onclick="delRec(\'' + r.id + '\')">删除</button>' +
    '</div>';
  return h;
}

/* 按分类分组的逐项判读，带与上一次的对比 */
function verdictRows(r){
  var h = "", cat, i, j;
  for (i = 0; i < CATS.length; i++) {
    cat = CATS[i];
    var items = IND.filter(function(x){
      return x.cat === cat && r.v && r.v[x.k] != null && r.v[x.k] !== "";
    });
    if (!items.length) continue;
    h += '<div class="grp-title">' + escapeHtml(cat) + '</div>';
    for (j = 0; j < items.length; j++) {
      var it = ind(items[j].k);
      var val = r.v[it.k];
      var ju = judge(it, val);
      var pill = ju ? '<span class="pill p-' + ju.lv + '">' +
                      (ju.lv === "good" ? "达标" : ju.lv === "warn" ? "偏离" : "超标") +
                      '</span>' : "";
      h += '<div class="v-row">' +
             '<div class="v-n">' + escapeHtml(it.n) + ' ' + pill + '</div>' +
             '<div class="v-v">' + escapeHtml(val) + (it.u ? ' ' + escapeHtml(it.u) : "") +
                trendSpan(r, it.k, val) + '</div>' +
             (it.t ? '<div class="v-t">目标 ' + escapeHtml(it.t) +
                     (it._custom ? '（个人）' : '') + '</div>' : '<div></div>') +
             (it.w ? '<div class="v-note">' + escapeHtml(it.w) + '</div>' : "") +
           '</div>';
    }
  }
  h += unmappedRows(r);
  return h;
}

/* 字典外的项目。存下来了却不显示，等于没存 —— 打印给医生时它们同样要在。 */
function unmappedRows(r){
  var list = (r.obs || []).filter(function(o){
    return o && o.k && o.k.indexOf("x:") === 0 && o.val != null && o.val !== "";
  });
  if (!list.length) return "";
  var h = '<div class="grp-title">其他项目 <span class="pill p-idle">未判读</span></div>';
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    h += '<div class="v-row">' +
      '<div class="v-n">' + escapeHtml(o.name) + '</div>' +
      '<div class="v-v">' + escapeHtml(o.val) +
        (o.unit ? ' ' + escapeHtml(o.unit) : "") + '</div>' +
      '<div class="v-t">字典里没有，不判达标</div>' +
      (o.quote ? '<div class="v-note">原文：' + escapeHtml(o.quote) + '</div>' : "") +
      '</div>';
  }
  return h;
}

function trendSpan(r, k, val){
  var prev = lastWith(ST.records, k, r.date);
  if (!prev) return "";
  var a = parseFloat(prev.val), b = parseFloat(val);
  if (!isFinite(a) || !isFinite(b)) {
    return prev.val === val ? "" :
      '<span class="v-trend">前 ' + escapeHtml(prev.val) + '</span>';
  }
  var d = b - a;
  var arrow = Math.abs(d) < 1e-9 ? "＝" : (d > 0 ? "↑" : "↓");
  var num = Math.abs(d) < 1e-9 ? "持平"
          : (d > 0 ? "+" : "−") + String(parseFloat(Math.abs(d).toPrecision(3)));
  return '<span class="v-trend">' + arrow + " " + num + " 比 " + escapeHtml(prev.date) + '</span>';
}

function openRec(id){
  go("hist");
  setTimeout(function(){
    var rs = ST.records, at = -1;
    for (var i = 0; i < rs.length; i++) if (rs[i].id === id) at = i;
    var items = document.querySelectorAll("#v-hist details.hrec");
    if (at >= 0 && items[at]) {
      items[at].open = true;
      items[at].scrollIntoView({ block:"start" });
    }
  }, 0);
}

function delRec(id){
  var r = null, i;
  for (i = 0; i < ST.records.length; i++) if (ST.records[i].id === id) r = ST.records[i];
  if (!r) return;
  if (!confirm("删除 " + r.date + " 的「" + (r.title || "这条记录") + "」？\n它的原图也会一并删除，不能撤销。")) return;
  delRecord(id).then(refresh).then(function(){ toast("已删除"); });
}

function copyRec(id){
  var r = null, i;
  for (i = 0; i < ST.records.length; i++) if (ST.records[i].id === id) r = ST.records[i];
  if (!r) return;
  var lines = [r.date + " " + (r.title || ""),
               [typeLabel(r.type), r.hospital, r.dept].filter(Boolean).join(" · ")];
  for (i = 0; i < CATS.length; i++) {
    var items = IND.filter(function(x){
      return x.cat === CATS[i] && r.v && r.v[x.k] != null && r.v[x.k] !== ""; });
    if (!items.length) continue;
    lines.push("【" + CATS[i] + "】");
    for (var j = 0; j < items.length; j++) {
      var it = ind(items[j].k), ju = judge(it, r.v[it.k]);
      lines.push("  " + it.n + "：" + r.v[it.k] + (it.u || "") +
        (it.t ? "  目标 " + it.t : "") +
        (ju && ju.lv === "bad" ? "  ← 超标" : ju && ju.lv === "warn" ? "  ← 偏离" : ""));
    }
  }
  if (r.impression) lines.push("结论：" + r.impression);
  if (r.recommendation) lines.push("复查建议：" + r.recommendation);
  if (r.note) lines.push("备注：" + r.note);
  var act = medsActiveOn(ST.meds, r.date);
  if (act.length) lines.push("当时在用：" + act.map(medLabel).join("；"));
  copyText(lines.join("\n"));
}

function copyText(txt){
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(txt).then(function(){ toast("已复制"); },
                                           function(){ fallbackCopy(txt); });
  } else fallbackCopy(txt);
}
function fallbackCopy(txt){
  var ta = document.createElement("textarea");
  ta.value = txt; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  try { document.execCommand("copy"); toast("已复制"); }
  catch(e){ toast("复制失败，请长按选择"); }
  document.body.removeChild(ta);
}

/* ==========================================================================
 * 录入 / 编辑
 * ========================================================================== */
function newRec(){
  EDIT_ID = null;
  if (typeof clearShot === "function") clearShot();
  if (typeof VIS_DRAFT !== "undefined") VIS_DRAFT = null;
  go("entry");
}
function editRec(id){ EDIT_ID = id; go("entry"); }

function curRec(){
  if (!EDIT_ID) return null;
  for (var i = 0; i < ST.records.length; i++)
    if (ST.records[i].id === EDIT_ID) return ST.records[i];
  return null;
}

/* 切分类会重新渲染，所以先把已填内容从 DOM 里读回来当草稿传进去 */
/* 字典里没有的项目。
 * 这些项目以前只出现在折叠的核对块里：看得见、改不了、也算不进「填了东西」，
 * 于是一张单子全是新项目时，保存会被挡住，识别出来的数据整个卡死在中间。
 * 现在把它们渲染成可编辑的行，和正式指标一样能改、能存。
 * 存下来的 k 是 "x:" 前缀，不进趋势、不参与判读，但原文和数值一个都不丢。 */
function unknownObs(base, r){
  var src = (base && base._vision && base._vision.obs) || (r ? r.obs : null) || [];
  return src.filter(function(o){ return o && o.k && o.k.indexOf("x:") === 0; });
}

function extraBlock(base, r){
  var list = unknownObs(base, r);
  if (!list.length) return "";
  var h = '<h2 class="sec">字典里还没有的项目</h2><div class="card flag-warn">';
  h += '<p class="tiny-note">这 ' + list.length + ' 项我暂时不认识，' +
       '所以不会参与达标判断、也不进趋势图 —— 但会原样存进这条记录，' +
       '打印时也会列出来。数值可以直接改。</p>';
  for (var i = 0; i < list.length; i++) {
    var o = list[i];
    h += '<div class="field">' +
      '<label for="in-x-val-' + i + '">' + escapeHtml(o.name) +
        (o.unit ? ' <span class="v-t">' + escapeHtml(o.unit) + '</span>' : "") + '</label>' +
      '<input type="text" inputmode="decimal" id="in-x-val-' + i + '" value="' +
        escapeHtml(o.val == null ? "" : o.val) + '" placeholder="留空则不保存这一项">' +
      '<input type="hidden" id="in-x-name-' + i + '" value="' + escapeHtml(o.name) + '">' +
      '<input type="hidden" id="in-x-unit-' + i + '" value="' + escapeHtml(o.unit || "") + '">' +
      '<input type="hidden" id="in-x-quote-' + i + '" value="' + escapeHtml(o.quote || "") + '">' +
      (o.quote ? '<div class="v-note">原文：' + escapeHtml(o.quote) + '</div>' : "") +
      '</div>';
  }
  /* 显式记下条数，读表单时按它循环。
     靠 getElementById 返回 null 来终止是无界循环，不该写。 */
  h += '<input type="hidden" id="in-x-count" value="' + list.length + '">';
  h += '<p class="tiny-note">经常遇到的项目告诉我，我加进字典，' +
       '以后它们就能判达标、能画趋势了。</p>';
  return h + '</div>';
}

function readForm(){
  var d = { v: {}, xtra: [] };
  var ids = ["date","type","hospital","dept","title","dx","findings",
             "impression","recommendation","note"];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById("in-" + ids[i]);
    if (el) d[ids[i]] = el.value;
  }
  for (var j = 0; j < IND.length; j++) {
    var e2 = document.getElementById("in-k-" + IND[j].k);
    if (e2 && e2.value !== "") d.v[IND[j].k] = e2.value;
  }
  /* 字典外的项目。名字和原文是隐藏字段，值可编辑；留空即视为不要这一项。 */
  var cntEl = document.getElementById("in-x-count");
  var xn = cntEl ? parseInt(cntEl.value, 10) : 0;
  if (!isFinite(xn) || xn < 0) xn = 0;
  for (var x = 0; x < xn; x++) {
    var nameEl = document.getElementById("in-x-name-" + x);
    if (!nameEl || !nameEl.value) continue;
    var valEl = document.getElementById("in-x-val-" + x);
    var vv = valEl ? valEl.value.trim() : "";
    if (!vv) continue;
    var uEl = document.getElementById("in-x-unit-" + x);
    var qEl = document.getElementById("in-x-quote-" + x);
    d.xtra.push({ name: nameEl.value, val: vv,
                  unit: uEl ? uEl.value : "", quote: qEl ? qEl.value : "" });
  }

  d.dis = [];
  for (var m = 0; m < ST.diseases.length; m++) {
    var c = document.getElementById("dis-" + ST.diseases[m].id);
    if (c && c.checked) d.dis.push(ST.diseases[m].id);
  }
  d._touchedDis = document.getElementById("in-date") != null;
  return d;
}

function setScope(s){
  var draft = readForm();
  uiSet("scope", s);
  renderEntry(draft);
}

function renderEntry(draft){
  var r = curRec();
  /* 识别完之后切到别的标签页再回来时，renderEntry 拿不到 draft。
     这时必须从 VIS_DRAFT 重新推出表单内容 —— 否则核对块还在，
     上面的字段却全空了，人会以为识别结果丢了。 */
  if (!draft && !r && typeof VIS_DRAFT !== "undefined" && VIS_DRAFT)
    draft = visionToForm(VIS_DRAFT);
  var base = draft || (r ? {
    date:r.date, type:r.type, hospital:r.hospital, dept:r.dept, title:r.title,
    dx:r.dx, findings:r.findings, impression:r.impression,
    recommendation:r.recommendation, note:r.note, v:r.v || {}, dis:r.dis || []
  } : { date: today(), type:"laboratory", v:{}, dis:[] });

  function val(k){ return base[k] == null ? "" : base[k]; }
  var scope = entryScope();

  var h = '<h2 class="sec">' + (r ? "编辑记录" : "新建记录") + '</h2>';

  /* 拍照识别只在新建时给，编辑已有记录时不该再拍一张覆盖掉 */
  if (!r && typeof vlSettingsBlock === "function") {
    if (typeof VIS_DRAFT !== "undefined" && VIS_DRAFT) {
      h += visionWarnBlock(VIS_DRAFT);
    } else {
      h += '<div class="card"><h3>拍化验单自动填</h3>' +
        '<p class="tiny-note">' +
        (vlReady() ? "拍完会自动填进下面的表单，但每一项都要你核对后才保存。"
                   : "还没配置识别服务。到「更多 → 拍照识别」选一家并填密钥，也可以直接手填。") +
        '</p>' +
        /* 必须是两个 input：capture="environment" 会强制直接开相机、
           把相册入口整个去掉，补录旧化验单就没法选图了。
           不带 capture 的那个才会弹出相册/文件选择。 */
        '<input type="file" id="shot-camera" accept="image/*" capture="environment" hidden ' +
          'onchange="onPhoto(event)">' +
        '<input type="file" id="shot-input" accept="image/*" hidden ' +
          'onchange="onPhoto(event)">' +
        (vlReady()
          ? '<div class="row">' +
              '<button class="btn" onclick="takePhoto()">拍照</button>' +
              '<button class="btn" onclick="pickPhoto()">从相册选</button>' +
            '</div>'
          : '<div class="row"><button class="btn tiny" onclick="go(\'more\')">去配置</button></div>') +
        '<div id="shot-box"></div></div>';
    }
  }

  h += '<div class="card">';
  h += '<label for="in-date">报告日期（以报告上写的为准，不是今天）</label>' +
       '<input type="date" id="in-date" value="' + escapeHtml(val("date")) + '">';
  h += '<label for="in-type">类型</label><select id="in-type">' +
       REPORT_TYPES.map(function(t){
         return '<option value="' + t.v + '"' + (val("type") === t.v ? " selected" : "") +
                '>' + escapeHtml(t.n) + '</option>'; }).join("") + '</select>';
  h += '<label for="in-title">标题（留空会按类型自动生成）</label>' +
       '<input type="text" id="in-title" value="' + escapeHtml(val("title")) + '" placeholder="如 甲状腺功能五项">';
  h += '<label for="in-hospital">医院</label>' +
       '<input type="text" id="in-hospital" value="' + escapeHtml(val("hospital")) + '">';
  h += '<label for="in-dept">科室</label>' +
       '<input type="text" id="in-dept" value="' + escapeHtml(val("dept")) + '">';
  h += '</div>';

  /* 疾病标签 —— 「按疾病调取历史」全靠这里 */
  h += '<h2 class="sec">这条属于哪些病</h2>';
  h += '<p class="lede">打了标签，才能在打印页按病把历史全调出来。没标签也能存。</p>';
  h += '<div class="card"><div class="checks">';
  var picked = base.dis || [];
  for (var i = 0; i < ST.diseases.length; i++) {
    var d = ST.diseases[i];
    var on = picked.indexOf(d.id) >= 0;
    h += '<label class="' + (on ? "on" : "") + '" for="dis-' + d.id + '">' +
         '<input type="checkbox" id="dis-' + d.id + '"' + (on ? " checked" : "") +
         ' onchange="this.parentNode.classList.toggle(\'on\', this.checked)">' +
         escapeHtml(d.name) + '</label>';
  }
  h += '</div><div class="sug" id="dis-sug"></div></div>';

  /* 指标。所有输入框都渲染出来，未选中的分组只是 hidden ——
     否则切分类时读不到已填的值，一切就白填了。 */
  h += '<h2 class="sec">化验与检查项目</h2>';
  h += '<div class="picker">';
  for (var s in SCOPES) {
    if (!Object.prototype.hasOwnProperty.call(SCOPES, s)) continue;
    h += '<button aria-pressed="' + (s === scope) + '" onclick="setScope(\'' + s + '\')">' +
         escapeHtml(SCOPES[s].label) + '</button>';
  }
  h += '</div>';
  h += '<p class="tiny-note">只影响显示。没展开的项目照样能保存已填的值。</p>';

  var shown = SCOPES[scope].cats;
  for (var c = 0; c < CATS.length; c++) {
    var cat = CATS[c];
    var items = IND.filter(function(x){ return x.cat === cat; });
    if (!items.length) continue;
    var hide = shown.indexOf(cat) < 0;
    h += '<div class="card"' + (hide ? " hidden" : "") + '>';
    h += '<h3>' + escapeHtml(cat) + '</h3>';
    for (var m = 0; m < items.length; m++) {
      var it = ind(items[m].k);
      var cur = base.v && base.v[it.k] != null ? base.v[it.k] : "";
      var inp = it.sel
        ? '<select id="in-k-' + it.k + '"><option value="">—</option>' +
          it.sel.map(function(o){
            return '<option' + (o === cur ? " selected" : "") + '>' + escapeHtml(o) + '</option>';
          }).join("") + '</select>'
        : '<input type="text" inputmode="decimal" id="in-k-' + it.k + '" placeholder="—" value="' +
          escapeHtml(cur) + '">';
      h += '<div class="field"><div class="f-n">' + escapeHtml(it.n) + '</div>' +
           '<div class="f-t">' + escapeHtml(it.t || (it.u ? it.u : "")) +
           (it._custom ? " ·个人" : "") + '</div>' + inp + '</div>';
    }
    h += '</div>';
  }

  h += extraBlock(base, r);

  h += '<h2 class="sec">报告文字</h2>';
  h += '<div class="card">';
  h += '<label for="in-dx">临床诊断</label><input type="text" id="in-dx" value="' +
       escapeHtml(val("dx")) + '">';
  h += '<label for="in-impression">结论 / 检查提示</label><textarea id="in-impression">' +
       escapeHtml(val("impression")) + '</textarea>';
  h += '<details class="fold"><summary>检查所见、复查建议</summary>' +
       '<label for="in-findings">检查所见</label><textarea id="in-findings">' +
       escapeHtml(val("findings")) + '</textarea>' +
       '<label for="in-recommendation">复查建议（写「3个月后复查」会自动算出日期）</label>' +
       '<textarea id="in-recommendation">' + escapeHtml(val("recommendation")) + '</textarea>' +
       '</details>';
  h += '<label for="in-note">备注（自己写的，随便记）</label><textarea id="in-note">' +
       escapeHtml(val("note")) + '</textarea>';
  h += '</div>';

  h += '<div class="row"><button class="btn" onclick="cancelEntry()">取消</button></div>';

  document.getElementById("v-entry").innerHTML = h;
  setFab(r ? "保存修改" : "保存这条记录", saveEntry);
  updateSug();
}

/* 实时给出疾病标签建议（确定性规则那一层，即时且免费） */
function updateSug(){
  var box = document.getElementById("dis-sug");
  if (!box) return;
  var d = readForm();
  var sug = suggestDiseases({
    title:d.title, dx:d.dx, impression:d.impression, findings:d.findings,
    note:d.note, v:d.v
  }, ST.diseases);
  var miss = Object.keys(sug).filter(function(id){ return (d.dis || []).indexOf(id) < 0; });
  box.innerHTML = miss.length
    ? "建议也勾上：" + miss.map(function(id){
        return escapeHtml(disName(id)) + "（" + escapeHtml(sug[id]) + "）"; }).join("；")
    : "";
}

function saveEntry(){
  var d = readForm();
  if (!isDate(d.date)) { toast("请先填报告日期"); return; }

  /* 数值项逐个校验，第一个错就停下并点名，不要静默丢掉 */
  var v = {};
  for (var i = 0; i < IND.length; i++) {
    var it = IND[i];
    var raw = d.v[it.k];
    if (raw == null || raw === "") continue;
    if (it.sel) { v[it.k] = raw; continue; }
    if (it.vt === "numeric") {
      var x = parseFloat(raw);
      if (!isFinite(x)) { toast(it.n + " 填的不是数字：" + raw); return; }
      v[it.k] = String(x);
    } else v[it.k] = raw;
  }

  /* 字典外的项目同样算「填了东西」。不算的话，一张单子上全是新项目时
     保存会被挡住，识别出来的数据就整个卡死在中间 —— 看得见、存不下。 */
  var xtra = d.xtra || [];
  var filled = Object.keys(v).length + xtra.length;
  var hasText = !!(d.title || d.impression || d.findings || d.note || d.dx);
  if (!filled && !hasText) { toast("至少填一个项目或写点文字"); return; }

  var old = curRec();
  /* 拍照识别来的记录：保留每一项的原文出处，但值以表单为准（人可能改过） */
  var vis = (VIS_DRAFT && !EDIT_ID) ? VIS_DRAFT : null;
  /* 编辑旧记录时要接着用它原来的 obs，否则原文出处会被整个抹掉 */
  var baseObs = vis ? vis.obs : (old ? old.obs : null);
  var rec = {
    id: EDIT_ID || undefined,
    obs: baseObs ? reconcileObs(baseObs, v, xtra) : undefined,
    date: d.date, type: d.type,
    title: d.title || "", hospital: d.hospital || "", dept: d.dept || "",
    dx: d.dx || "", findings: d.findings || "", impression: d.impression || "",
    summary: old ? old.summary || "" : "",
    recommendation: d.recommendation || "",
    dis: d.dis || [], v: v, note: d.note || "",
    bodyParts: old ? old.bodyParts : [],
    imgs: old ? old.imgs : [],
    /* 人工碰过的字段，此后任何 AI 结果都不能覆盖 */
    manual: uniq((old ? old.manual : []).concat(["dis","title","v"])),
    ai: old ? old.ai : null,
    createdAt: old ? old.createdAt : undefined
  };

  /* 复查日期由 normalizeRecord 统一算，这里不重复。
     但改了复查建议就得让它重算，所以先清掉旧值。 */
  if (!old || old.recommendation !== rec.recommendation) rec.recheckDue = null;
  else rec.recheckDue = old.recheckDue;

  saveRecord(rec).then(function(saved){
    /* 照片跟着记录一起存。存不下（配额满了）也不能让整条记录白填，
       所以图片失败只提示，不回滚。 */
    if (vis && SHOT) {
      return saveImage(saved.id, SHOT.blob, SHOT.thumbBlob,
                       { w: SHOT.w, h: SHOT.h, seq: 0 })
        .then(function(){ return saved; })
        .catch(function(){ toast("记录已存，但原图没能存下（可能空间不足）"); return saved; });
    }
    return saved;
  }).then(function(saved){
    EDIT_ID = null; VIS_DRAFT = null; DRAFT = null;
    if (typeof clearShot === "function") clearShot();
    return refresh().then(function(){
      toast(old ? "已保存修改" : "已保存");
      openRec(saved.id);
    });
  }).catch(function(e){
    toast("保存失败：" + (e && e.message || e));
  });
}

/* 取消时必须把照片和识别草稿一起丢掉，否则下次新建会带着上一次的残留 */
function cancelEntry(){
  EDIT_ID = null;
  if (typeof clearShot === "function") clearShot();
  if (typeof VIS_DRAFT !== "undefined") VIS_DRAFT = null;
  go("hist");
}

function uniq(a){
  var out = [], seen = {};
  for (var i = 0; i < a.length; i++) if (!seen[a[i]]) { seen[a[i]] = 1; out.push(a[i]); }
  return out;
}

/* ==========================================================================
 * 用药
 * ========================================================================== */
var MED_EDIT = null;

function renderMeds(){
  var act = medsActiveOn(ST.meds, today());
  var actIds = {};
  for (var a = 0; a < act.length; a++) actIds[act[a].id] = 1;

  var h = "";
  if (!ST.meds.length) {
    h += '<div class="empty"><p>还没有用药记录。</p>' +
         '<p class="tiny-note">记下起止日期，AI 分析和打印件才能对上' +
         '「这段时间在吃什么、指标怎么变的」。</p></div>';
  } else {
    h += '<h2 class="sec">在吃（' + act.length + '）</h2>';
    h += act.length ? act.map(medCard).join("")
       : '<p class="lede">今天没有在吃的药。</p>';
    var past = ST.meds.filter(function(m){ return !actIds[m.id]; });
    if (past.length) {
      h += '<h2 class="sec">已停（' + past.length + '）</h2>';
      h += past.map(medCard).join("");
    }
  }
  document.getElementById("v-meds").innerHTML = h;
  setFab("＋ 添加一种药", function(){ MED_EDIT = null; medForm(); });
}

function medCard(m){
  var on = !m.stop;
  var tags = (m.dis || []).map(function(id){
    var d = disById(id);
    return '<span class="pill p-idle">' + escapeHtml(d ? d.short || d.name : id) + '</span>';
  }).join(" ");
  return '<div class="card tight' + (on ? " flag-good" : "") + '">' +
    '<h3>' + escapeHtml(m.name) + ' ' + tags + '</h3>' +
    '<p class="tiny-note">' + escapeHtml([m.dose, m.freq].filter(Boolean).join(" · ")) + '<br>' +
    escapeHtml(m.start) + ' 起' + (m.stop ? '，' + escapeHtml(m.stop) + ' 停' : "，至今") + '</p>' +
    (m.note ? '<p class="tiny-note">' + escapeHtml(m.note) + '</p>' : "") +
    '<div class="row">' +
      '<button class="btn tiny" onclick="medForm(\'' + m.id + '\')">编辑</button>' +
      (on ? '<button class="btn tiny" onclick="stopMed(\'' + m.id + '\')">今天停用</button>' : "") +
      '<button class="btn tiny danger" onclick="removeMed(\'' + m.id + '\')">删除</button>' +
    '</div></div>';
}

function medForm(id){
  MED_EDIT = id || null;
  var m = null;
  for (var i = 0; i < ST.meds.length; i++) if (ST.meds[i].id === id) m = ST.meds[i];
  m = m || { name:"", dose:"", freq:"", start:today(), stop:"", dis:[], note:"" };

  var h = '<h2 class="sec">' + (id ? "编辑用药" : "添加用药") + '</h2><div class="card">';
  h += '<label for="m-name">药名</label><input id="m-name" value="' + escapeHtml(m.name) +
       '" placeholder="如 阿托伐他汀钙片">';
  h += '<label for="m-dose">剂量</label><input id="m-dose" value="' + escapeHtml(m.dose || "") +
       '" placeholder="如 20mg">';
  h += '<label for="m-freq">频次</label><input id="m-freq" value="' + escapeHtml(m.freq || "") +
       '" placeholder="如 每晚一次">';
  h += '<label for="m-start">开始日期</label><input type="date" id="m-start" value="' +
       escapeHtml(m.start) + '">';
  h += '<label for="m-stop">停用日期（还在吃就留空）</label><input type="date" id="m-stop" value="' +
       escapeHtml(m.stop || "") + '">';
  h += '<label>为哪个病吃的</label><div class="checks">';
  for (var j = 0; j < ST.diseases.length; j++) {
    var d = ST.diseases[j], on = (m.dis || []).indexOf(d.id) >= 0;
    h += '<label class="' + (on ? "on" : "") + '" for="md-' + d.id + '">' +
         '<input type="checkbox" id="md-' + d.id + '"' + (on ? " checked" : "") +
         ' onchange="this.parentNode.classList.toggle(\'on\', this.checked)">' +
         escapeHtml(d.name) + '</label>';
  }
  h += '</div>';
  h += '<label for="m-note">备注</label><textarea id="m-note">' + escapeHtml(m.note || "") + '</textarea>';
  h += '</div><div class="row"><button class="btn" onclick="renderMeds()">取消</button></div>';

  document.getElementById("v-meds").innerHTML = h;
  setFab("保存", saveMedForm);
}

function saveMedForm(){
  var name = document.getElementById("m-name").value.trim();
  if (!name) { toast("药名不能为空"); return; }
  var start = document.getElementById("m-start").value;
  var stop  = document.getElementById("m-stop").value;
  if (!isDate(start)) { toast("请填开始日期"); return; }
  if (stop && isDate(stop) && stop < start) { toast("停用日期不能早于开始日期"); return; }

  var dis = [];
  for (var i = 0; i < ST.diseases.length; i++) {
    var c = document.getElementById("md-" + ST.diseases[i].id);
    if (c && c.checked) dis.push(ST.diseases[i].id);
  }
  saveMed({
    id: MED_EDIT || undefined, name: name,
    dose: document.getElementById("m-dose").value.trim(),
    freq: document.getElementById("m-freq").value.trim(),
    start: start, stop: stop || null, dis: dis,
    note: document.getElementById("m-note").value.trim()
  }).then(function(){
    MED_EDIT = null;
    return refresh();
  }).then(function(){ renderMeds(); toast("已保存"); });
}

function stopMed(id){
  var m = null;
  for (var i = 0; i < ST.meds.length; i++) if (ST.meds[i].id === id) m = ST.meds[i];
  if (!m) return;
  if (!confirm("把「" + m.name + "」标记为今天（" + today() + "）停用？")) return;
  m.stop = today();
  saveMed(m).then(refresh).then(function(){ renderMeds(); toast("已停用"); });
}
function removeMed(id){
  if (!confirm("删除这条用药记录？历史分析会失去这段用药信息。")) return;
  delMed(id).then(refresh).then(function(){ renderMeds(); toast("已删除"); });
}

/* ==========================================================================
 * 更多：疾病、个人目标、备份、存储
 * ========================================================================== */
/* ==========================================================================
 * 未识别项目汇总
 *
 * 扩字典最省事的办法不是去抄一份通用表，而是让应用自己把「实际遇到过、
 * 但字典里没有」的项目攒起来。攒出来的一定是你真的会查的项目，
 * 而不是照着教科书补一堆一辈子用不上的。
 * ========================================================================== */
function unmappedStats(){
  var m = {};
  for (var i = 0; i < ST.records.length; i++) {
    var r = ST.records[i];
    for (var j = 0; j < (r.obs || []).length; j++) {
      var o = r.obs[j];
      if (!o || !o.k || o.k.indexOf("x:") !== 0) continue;
      if (o.val == null || o.val === "") continue;
      if (!m[o.k]) m[o.k] = { name:o.name, unit:o.unit || "", n:0,
                              vals:[], refText:o.refText || "" };
      m[o.k].n++;
      if (m[o.k].vals.length < 3) m[o.k].vals.push(o.val + (o.unit ? " " + o.unit : ""));
      if (!m[o.k].refText && o.refText) m[o.k].refText = o.refText;
    }
  }
  var out = [];
  for (var k in m) if (Object.prototype.hasOwnProperty.call(m, k)) out.push(m[k]);
  /* 出现次数多的排前面 —— 那些才值得优先加进字典 */
  return out.sort(function(a, b){ return b.n - a.n; });
}

function unmappedSummary(){
  var list = unmappedStats();
  if (!list.length) return "";
  var h = '<h2 class="sec">字典里还没有的项目</h2><div class="card">';
  h += '<p class="lede">这 ' + list.length + ' 个项目你的报告里出现过，但我不认识。' +
       '它们照常存着、照常打印，只是<b>不参与达标判断、不进趋势图</b>。</p>';
  h += '<p class="tiny-note">按出现次数排序 —— 排在前面的才值得优先加进字典。</p>';
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    h += '<div class="v-row">' +
      '<div class="v-n">' + escapeHtml(e.name) +
        ' <span class="pill p-idle">' + e.n + ' 次</span></div>' +
      '<div class="v-v">' + escapeHtml(e.vals.join("、")) + '</div>' +
      (e.refText ? '<div class="v-t">报告参考范围 ' + escapeHtml(e.refText) + '</div>' : '<div></div>') +
      '</div>';
  }
  h += '<div class="row"><button class="btn" onclick="copyUnmapped()">复制这份清单</button></div>';
  h += '<details class="fold"><summary>为什么不干脆抄一份通用参考区间表</summary>' +
    '<p class="tiny-note">中国的检验参考区间是<b>按实验室定</b>的 —— 同一个项目，' +
    '不同医院、不同仪器、不同检测方法，范围能差出一截。' +
    '所以任何通用表格都不如化验单上自己印的那一行「参考范围」权威，' +
    '而那一行应用已经抽出来了（上面就显示着）。<br><br>' +
    '要查权威资料的话：参考区间看卫健委行业标准 <b>WS/T 404</b> 系列（生化）' +
    '和 <b>WS/T 405</b>（血常规）；项目的标准命名和常见缩写看 <b>LOINC</b>（有官方中文翻译）。<br><br>' +
    '注意区分：参考区间是「健康人群的范围」，治疗目标是「你这个病该控到多少」，' +
    '两者不是一回事 —— 后者在「个人目标」里单独设。</p></details>';
  return h + '</div>';
}

function copyUnmapped(){
  var list = unmappedStats();
  if (!list.length) { toast("没有未识别的项目"); return; }
  var lines = ["字典里还没有的项目（按出现次数排序）", ""];
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    lines.push("- " + e.name +
      "｜出现 " + e.n + " 次" +
      "｜示例值 " + e.vals.join("、") +
      (e.refText ? "｜报告参考范围 " + e.refText : "｜报告未印参考范围"));
  }
  var txt = lines.join("\n");
  if (navigator.clipboard && window.isSecureContext)
    navigator.clipboard.writeText(txt).then(
      function(){ toast("已复制 " + list.length + " 项"); },
      function(){ toast("复制失败，请长按选择"); });
  else toast("复制失败，请长按选择");
}

function renderMore(){
  var h = "";

  h += '<h2 class="sec">打印</h2>';
  h += '<div class="card"><p class="lede">选一个或多个病，把相关历史全部调出来，' +
       '排成可以直接递给医生的材料。</p>' +
       '<div class="row"><button class="btn solid" onclick="go(\'print\')">去打印页</button></div></div>';

  h += (typeof vlSettingsBlock === "function") ? vlSettingsBlock() : "";

  h += unmappedSummary();

  h += '<h2 class="sec">备份</h2>';
  h += '<div class="card"><p class="lede">数据只存在这台手机里。' +
       'Android 在存储紧张时会清掉网页数据，手机自带的清理工具也能抹掉它。' +
       '<b>定期导出是唯一可靠的保险。</b></p>';
  var last = lsGet(LS.nag);
  h += '<p class="tiny-note">' + (last ? "上次备份：" + escapeHtml(last) : "还没备份过") + '</p>';
  h += '<div class="row">' +
    '<button class="btn solid" onclick="doExport()">导出 JSON</button>' +
    '<button class="btn" onclick="document.getElementById(\'imp\').click()">导入备份</button>' +
    '</div>' +
    '<input type="file" id="imp" accept=".json,application/json" hidden onchange="doImport(event)">' +
    '<details class="fold"><summary>带原图的完整备份</summary>' +
    '<p class="tiny-note">JSON 里只有结构化数据，不含原图（几十张照片会让 JSON 大到手机处理不了）。' +
    '需要连原图一起存时用下面这个，导出的是 zip。</p>' +
    '<div class="row"><button class="btn tiny" onclick="doExportZip()">导出 zip（含原图）</button></div>' +
    '</details></div>';

  h += '<h2 class="sec">疾病</h2>';
  h += '<p class="lede">打印件按疾病调取历史，靠的就是这里的「核心项目」顺序。</p>';
  for (var i = 0; i < ST.diseases.length; i++) {
    var d = ST.diseases[i];
    var n = ST.records.filter(function(r){ return (r.dis || []).indexOf(d.id) >= 0; }).length;
    h += '<div class="card tight"><h3>' + escapeHtml(d.name) +
         ' <span class="pill p-idle">' + n + ' 条记录</span></h3>' +
         '<p class="tiny-note">核心项目：' +
         escapeHtml((d.keyInd || []).map(function(k){
           return indByKey(k) ? indByKey(k).n : k; }).join("、") || "（未设置）") + '</p>' +
         '<div class="row"><button class="btn tiny danger" onclick="removeDisease(\'' +
         d.id + '\')">删除</button></div></div>';
  }

  h += '<h2 class="sec">个人目标</h2>';
  h += '<div class="card"><p class="lede">字典里的区间是<b>人群参考值</b>，不是治疗目标。' +
       '有糖尿病、斑块、甲状腺术后这类情况的，医生给的目标要严得多 —— 在这里改，' +
       '改完不会被 app 升级冲掉。</p>';
  var tks = Object.keys(ST.targets);
  if (tks.length) {
    for (var j = 0; j < tks.length; j++) {
      var it = indByKey(tks[j]);
      if (!it) continue;
      var o = ST.targets[tks[j]];
      h += '<div class="v-row"><div class="v-n">' + escapeHtml(it.n) + '</div>' +
           '<div class="v-v">' + escapeHtml(o.t || ((o.min != null ? o.min + "–" : "") +
             (o.max != null ? o.max : ""))) + '</div>' +
           '<div class="v-t">字典值 ' + escapeHtml(it.t || "") + '</div></div>';
    }
  } else h += '<p class="tiny-note">还没设置任何个人目标，全部按人群参考区间判读。</p>';
  h += '<div class="row"><button class="btn" onclick="editTarget()">设置一项</button>' +
       (tks.length ? '<button class="btn tiny" onclick="clearTargets()">全部清除</button>' : "") +
       '</div></div>';

  h += '<h2 class="sec">存储</h2><div class="card" id="sto">' +
       '<p class="tiny-note">读取中…</p></div>';

  h += '<h2 class="sec">危险操作</h2><div class="card">' +
       '<div class="row"><button class="btn danger" onclick="doWipe()">清空全部数据</button></div>' +
       '<p class="tiny-note">先导出备份再点。清空不可撤销。</p></div>';

  document.getElementById("v-more").innerHTML = h;
  setFab(null);

  storageInfo().then(function(s){
    var box = document.getElementById("sto");
    if (!box) return;
    box.innerHTML = s.supported
      ? '<p class="tiny-note">已用 ' + fmtBytes(s.usage) +
        (s.quota ? ' / 可用约 ' + fmtBytes(s.quota) : "") + '<br>' +
        '持久化存储：' + (s.persisted ? "已授予（数据更不容易被系统清掉）"
                                      : "未授予 —— 更要靠定期导出") + '</p>'
      : '<p class="tiny-note">这个浏览器不支持查询存储用量。</p>';
  });
}

function doExport(){
  exportBackup().then(function(b){
    download("bingli-" + today() + ".json", b.json, "application/json;charset=utf-8");
    lsSet(LS.nag, today());
    render();
    toast("已导出 " + b.data.records.length + " 条记录");
  }).catch(function(e){ toast("导出失败：" + (e && e.message || e)); });
}

function doExportZip(){
  toast("正在打包，图片多时要等一会…");
  exportFullZip().then(function(blob){
    download("bingli-full-" + today() + ".zip", blob, "application/zip");
    lsSet(LS.nag, today());
    render();
    toast("已导出（" + fmtBytes(blob.size) + "）");
  }).catch(function(e){ toast("打包失败：" + (e && e.message || e)); });
}

function doImport(ev){
  var f = ev.target.files && ev.target.files[0];
  ev.target.value = "";                       // 重选同一个文件时也要能触发
  if (!f) return;
  var fr = new FileReader();
  fr.onload = function(){
    var res;
    try { res = parseBackup(String(fr.result)); }
    catch (e) { alert("导入失败：" + e.message); return; }
    var what = res.kind === "legacy" ? "这是「体检记录本」的备份" : "这是本应用的备份";
    if (!confirm(what + "，含 " + res.records.length + " 条记录。\n" +
                 "同一条记录会按修改时间取新的那份，不会重复。\n继续导入？")) return;
    importBackup(String(fr.result)).then(function(r){
      return refresh().then(function(){
        var msg = "新增 " + r.added + "，更新 " + r.updated + "，跳过 " + r.skipped;
        if (r.missingImages) msg += "；有 " + r.missingImages + " 张原图不在这个文件里";
        alert("导入完成。\n" + msg);
      });
    }).catch(function(e){ alert("导入失败：" + (e && e.message || e)); });
  };
  fr.readAsText(f);
}

function removeDisease(id){
  var d = disById(id);
  var n = ST.records.filter(function(r){ return (r.dis || []).indexOf(id) >= 0; }).length;
  if (!confirm("删除「" + (d ? d.name : id) + "」？\n" +
               (n ? "有 " + n + " 条记录上的这个标签会一并摘掉（记录本身不会删）。" : ""))) return;
  delDisease(id).then(refresh).then(function(){ renderMore(); toast("已删除"); });
}

function editTarget(){
  var name = prompt("要给哪一项设个人目标？填指标名或缩写，如 LDL、糖化、TSH");
  if (!name) return;
  var m = matchIndicator({ itemName: name });
  if (!m.k) { alert("没找到这个指标。\n" + m.why); return; }
  var it = indByKey(m.k);
  var cur = ST.targets[m.k] || {};
  var maxs = prompt(it.n + "\n人群参考上限：" + (it.max != null ? it.max : "无") +
                    "\n\n填你的目标上限（留空表示不限）：",
                    cur.max != null ? String(cur.max) : (it.max != null ? String(it.max) : ""));
  if (maxs === null) return;
  var mins = prompt(it.n + "\n人群参考下限：" + (it.min != null ? it.min : "无") +
                    "\n\n填你的目标下限（留空表示不限）：",
                    cur.min != null ? String(cur.min) : (it.min != null ? String(it.min) : ""));
  if (mins === null) return;

  var o = {};
  if (maxs.trim() !== "") { if (!isFinite(parseFloat(maxs))) { alert("上限不是数字"); return; }
                            o.max = parseFloat(maxs); }
  if (mins.trim() !== "") { if (!isFinite(parseFloat(mins))) { alert("下限不是数字"); return; }
                            o.min = parseFloat(mins); }
  if (o.min != null && o.max != null && o.min >= o.max) { alert("下限必须小于上限"); return; }
  if (o.min == null && o.max == null) { delete ST.targets[m.k]; }
  else {
    o.t = (o.min != null && o.max != null) ? o.min + " – " + o.max
        : (o.max != null ? "< " + o.max : "> " + o.min);
    o.w = "这是你设置的个人目标，不是化验单上的人群参考值";
    ST.targets[m.k] = o;
  }
  saveTargets(ST.targets).then(refresh).then(function(){ renderMore(); toast("已保存"); });
}

function clearTargets(){
  if (!confirm("清除全部个人目标，恢复成人群参考区间？")) return;
  ST.targets = {};
  saveTargets({}).then(refresh).then(function(){ renderMore(); toast("已清除"); });
}

function doWipe(){
  if (!confirm("清空全部数据？\n记录、原图、疾病、用药、个人目标全部删除，不可撤销。")) return;
  if (!confirm("再确认一次：你已经导出过备份了吗？\n点确定将立即清空。")) return;
  wipeAll().then(function(){
    return seedOnce();
  }).then(refresh).then(function(){ go("home"); toast("已清空"); });
}

/* 表单里任何输入变化都刷新一次疾病建议 */
document.addEventListener("input", function(e){
  if (VIEW === "entry" && e.target && /^in-/.test(e.target.id || "")) updateSug();
});

boot();
