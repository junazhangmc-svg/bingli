"use strict";
/* ==========================================================================
 * pdfin.js — PDF 导入
 *
 * 核心判断：医院导出的体检报告 PDF 大多带**文字层**，字可以直接抠出来。
 * 抠得到就根本不用视觉模型 —— 免费、逐字精确、瞬间完成，
 * 而且不会有拍照识别那种「串行」风险（数值取自隔壁行）。
 * 只有扫描件、拍照转的 PDF 才需要渲染成图再走视觉模型。
 *
 * 所以每一页都要过一道质量闸：
 *   文字够多、CJK 比例正常、没有大片替换字符 → 走文本路径
 *   否则                                    → 渲染成图走视觉路径
 * 判错的代价不对称：把扫描件当文字页会喂给模型一堆空白，
 * 把文字页当扫描件只是多花一次调用。所以闸门宁严勿松。
 *
 * pdf.js 是 ESM，本应用是传统脚本 —— 用动态 import() 懒加载，
 * 平时完全不占启动时间，只有真的打开 PDF 时才拉那 3MB。
 * ========================================================================== */

var PDF_LIB = null;          // 懒加载后的 pdf.js 模块
var PDF_DOC = null;          // 当前打开的文档
var PDF_PAGES = [];          // [{n, kind, text, chars, thumbUrl, sel, _page}]
var PDF_NAME = "";
var pdfBusy = false;

/* 一页至少要有这么多字才可能是文字层。体检报告一页动辄几百字，
   低于这个数基本就是扫描件里蹭出来的页眉页脚。 */
var PDF_MIN_CHARS = 80;
/* 渲染倍数。密集表格用 2 倍能明显提高小字识别率，再高收益递减、内存吃紧。 */
var PDF_RENDER_SCALE = 2;
var PDF_MAX_PAGES = 60;      // 再多就不是体检报告了，防止卡死

function loadPdfLib(){
  if (PDF_LIB) return Promise.resolve(PDF_LIB);
  /* 相对路径，跟着 GitHub Pages 的子目录走 */
  return import("./pdfjs/pdf.mjs").then(function(mod){
    mod.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.mjs";
    PDF_LIB = mod;
    return mod;
  }).catch(function(e){
    /* 最常见的原因不是网络，而是 pdfjs 那个文件夹压根没上传到服务器 ——
       它有 188 个文件，很容易在部署时被漏掉。所以第一条就说它。 */
    throw new Error(
      "PDF 组件加载失败。按可能性排：\n" +
      "1. 服务器上缺 pdfjs 文件夹（它有 188 个文件，部署时最容易漏）。" +
      "在浏览器里打开 " + location.origin + location.pathname.replace(/[^/]*$/, "") +
      "pdfjs/pdf.mjs 试试，404 就是这个原因。\n" +
      "2. 第一次用要下载约 3MB，网络慢时会超时，退出重进再试。\n" +
      "（原始错误：" + (e && e.message || e) + "）");
  });
}

/* 文字质量闸。返回 {ok, why} */
function textQuality(text){
  var s = String(text || "").replace(/\s+/g, "");
  if (s.length < PDF_MIN_CHARS)
    return { ok:false, why:"这一页几乎没有文字（" + s.length + " 字），当作扫描件处理" };
  /* 缺 CMap 或字体编码异常时，抠出来的会是大量替换字符或私用区字符。
     这种「有字但全是乱码」比没字更危险 —— 直接喂给模型会得到一本正经的胡说。 */
  var bad = (s.match(/[�-]/g) || []).length;
  if (bad / s.length > 0.1)
    return { ok:false, why:"抠出来的文字有 " + Math.round(bad / s.length * 100) +
                           "% 是乱码，改用图片识别" };
  var cjk = (s.match(/[一-龥]/g) || []).length;
  var alnum = (s.match(/[0-9A-Za-z]/g) || []).length;
  if (cjk + alnum < s.length * 0.5)
    return { ok:false, why:"文字层内容异常，改用图片识别" };
  return { ok:true, why:"文字层完整，直接读取（不消耗识别次数）" };
}

function openPdf(file){
  PDF_NAME = file.name || "报告.pdf";
  return loadPdfLib().then(function(lib){
    return file.arrayBuffer().then(function(buf){
      return lib.getDocument({
        data: buf,
        cMapUrl: "./pdfjs/cmaps/", cMapPacked: true,
        standardFontDataUrl: "./pdfjs/standard_fonts/",
        /* 关掉 eval：PDF 是外部来源，这个页面里有病历和密钥，
           不给构造过的 PDF 任何执行机会。 */
        isEvalSupported: false
      }).promise;
    });
  }).then(function(doc){
    PDF_DOC = doc;
    var n = Math.min(doc.numPages, PDF_MAX_PAGES);
    var jobs = [];
    for (var i = 1; i <= n; i++) jobs.push(scanPage(doc, i));
    return Promise.all(jobs).then(function(pages){
      PDF_PAGES = pages;
      return { total: doc.numPages, scanned: n, pages: pages };
    });
  });
}

/* 逐页：抠文字 + 出缩略图。先不渲染大图，那一步等勾选之后再做。 */
function scanPage(doc, n){
  return doc.getPage(n).then(function(page){
    return page.getTextContent().then(function(tc){
      var text = tc.items.map(function(it){ return it.str; }).join("");
      var q = textQuality(text);
      return renderPage(page, 0.28).then(function(thumbUrl){
        return { n:n, kind: q.ok ? "text" : "image", why: q.why,
                 text: text, chars: text.replace(/\s+/g, "").length,
                 thumbUrl: thumbUrl, sel: false, _page: page };
      });
    });
  });
}

function renderPage(page, scale){
  var vp = page.getViewport({ scale: scale });
  var cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(vp.width));
  cv.height = Math.max(1, Math.floor(vp.height));
  var g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  return page.render({ canvasContext: g, viewport: vp }).promise.then(function(){
    return new Promise(function(resolve){
      cv.toBlob(function(b){ resolve(URL.createObjectURL(b)); }, "image/jpeg", 0.75);
    });
  });
}

/* 勾选的页要送去识别时，才渲染成够清楚的大图 */
function pageToDataUrl(p){
  var vp = p._page.getViewport({ scale: PDF_RENDER_SCALE });
  var cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.floor(vp.width));
  cv.height = Math.max(1, Math.floor(vp.height));
  var g = cv.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
  return p._page.render({ canvasContext: g, viewport: vp }).promise.then(function(){
    return cv.toDataURL("image/jpeg", 0.82);
  });
}

function clearPdf(){
  for (var i = 0; i < PDF_PAGES.length; i++)
    if (PDF_PAGES[i].thumbUrl) URL.revokeObjectURL(PDF_PAGES[i].thumbUrl);
  PDF_PAGES = [];
  if (PDF_DOC && PDF_DOC.destroy) { try { PDF_DOC.destroy(); } catch(e){} }
  PDF_DOC = null; PDF_NAME = "";
}

/* ==========================================================================
 * 界面
 * ========================================================================== */
function pickPdf(){
  var el = document.getElementById("pdf-input");
  if (el) el.click();
}

function onPdf(ev){
  var f = ev.target.files && ev.target.files[0];
  ev.target.value = "";
  if (!f) return;
  if (pdfBusy) return;
  if (!/\.pdf$/i.test(f.name || "") && f.type !== "application/pdf") {
    showShotStatus("选中的不是 PDF 文件", true);
    return;
  }
  pdfBusy = true;
  clearShot();
  clearPdf();
  showShotStatus("正在打开 PDF……第一次用要下载约 3MB 组件，请稍候");

  openPdf(f).then(function(r){
    pdfBusy = false;
    renderPdfPages(r);
  }).catch(function(e){
    pdfBusy = false;
    showShotStatus(e && e.message ? e.message : "PDF 打开失败", true);
  });
}

function renderPdfPages(r){
  var box = document.getElementById("shot-box");
  if (!box) return;
  var textPages = PDF_PAGES.filter(function(p){ return p.kind === "text"; }).length;

  var h = '<div class="card"><h3>' + escapeHtml(PDF_NAME) + '</h3>';
  h += '<p class="tiny-note">共 ' + r.total + ' 页' +
       (r.scanned < r.total ? '（只处理前 ' + r.scanned + ' 页）' : '') + '。' +
       (textPages
         ? '其中 <b>' + textPages + ' 页带文字层</b>，可以直接读取 —— ' +
           '逐字精确，而且不消耗识别次数。'
         : '没有检测到文字层，都要按图片识别。') + '</p>';
  h += '<p class="tiny-note"><b>勾选要录入的页。</b>体检报告通常只有「检验结果」' +
       '和「总检结论」那几页有用，封面和须知不用勾 —— 勾多了又慢又贵，' +
       '还会把无关内容混进记录。</p>';

  for (var i = 0; i < PDF_PAGES.length; i++) {
    var p = PDF_PAGES[i];
    h += '<label class="pdf-page" for="pg-' + p.n + '">' +
      '<input type="checkbox" id="pg-' + p.n + '" onchange="togglePage(' + p.n + ')"' +
        (p.sel ? " checked" : "") + '>' +
      '<img src="' + p.thumbUrl + '" alt="第 ' + p.n + ' 页">' +
      '<div><b>第 ' + p.n + ' 页</b> ' +
        '<span class="pill p-' + (p.kind === "text" ? "good" : "idle") + '">' +
        (p.kind === "text" ? "文字层" : "需识别") + '</span>' +
        '<div class="tiny-note">' + escapeHtml(p.why) + '</div>' +
        (p.kind === "text" && p.text
          ? '<div class="tiny-note">' + escapeHtml(p.text.slice(0, 60)) + '…</div>' : "") +
      '</div></label>';
  }

  h += '<div class="row">' +
    '<button class="btn solid" onclick="runPdf()">读取勾选的页</button>' +
    '<button class="btn tiny" onclick="selectSuggested()">帮我勾</button>' +
    '<button class="btn tiny" onclick="clearPdf();renderShot()">取消</button>' +
    '</div><div id="vis-out"></div></div>';
  box.innerHTML = h;
}

function togglePage(n){
  for (var i = 0; i < PDF_PAGES.length; i++)
    if (PDF_PAGES[i].n === n) {
      var el = document.getElementById("pg-" + n);
      PDF_PAGES[i].sel = !!(el && el.checked);
    }
}

/* 按内容猜哪几页有用。只是建议，最终还是你勾。 */
var PDF_USEFUL = /检验|生化|血常规|血脂|肝功|肾功|甲功|尿常规|结论|总检|小结|建议|异常|超声|彩超|CT|心电/;
function selectSuggested(){
  var n = 0;
  for (var i = 0; i < PDF_PAGES.length; i++) {
    var p = PDF_PAGES[i];
    /* 图片页看不到内容，无从判断，一律不替人勾 */
    p.sel = p.kind === "text" && PDF_USEFUL.test(p.text);
    var el = document.getElementById("pg-" + p.n);
    if (el) el.checked = p.sel;
    if (p.sel) n++;
  }
  toast(n ? "勾了 " + n + " 页，请自己再过一遍" : "没找到明显相关的页，请手动勾");
}

function runPdf(){
  var sel = PDF_PAGES.filter(function(p){ return p.sel; });
  var out = document.getElementById("vis-out");
  if (!sel.length) { toast("先勾几页"); return; }
  if (!vlReady()) {
    out.innerHTML = '<div class="card flag-warn"><p class="tiny-note">' +
      '还没配置识别服务。到「更多 → 拍照识别」选一家并填密钥。</p></div>';
    return;
  }
  if (vlBusy) return;
  vlBusy = true;

  var textPages = sel.filter(function(p){ return p.kind === "text"; });
  var imgPages  = sel.filter(function(p){ return p.kind !== "text"; });
  out.innerHTML = '<p class="lede">正在处理 ' + sel.length + ' 页' +
    (imgPages.length ? '（其中 ' + imgPages.length + ' 页要走图片识别，约需 ' +
                       (imgPages.length * 20) + ' 秒）' : '（全是文字层，很快）') + '……</p>';

  /* 文字页合并成一次调用 —— 这几页本来就属于同一份报告，
     分开调用反而会让模型看不到全貌。 */
  var work = [];
  if (textPages.length) {
    var joined = textPages.map(function(p){
      return "【第 " + p.n + " 页】\n" + p.text;
    }).join("\n\n");
    work.push(callVisionText(joined));
  }
  imgPages.forEach(function(p){
    work.push(pageToDataUrl(p).then(function(u){ return callVision(u, ST.diseases); }));
  });

  Promise.all(work).then(function(results){
    vlBusy = false;
    var merged = mergeDrafts(results.map(function(r){
      return draftFromVision(r.data, ST.diseases);
    }));
    merged._model = results[0] && results[0].model;
    merged._meta  = results[0] && results[0].meta;
    merged._pdf   = { name: PDF_NAME, pages: sel.map(function(p){ return p.n; }),
                      fromText: textPages.length, fromImage: imgPages.length };
    VIS_DRAFT = merged;
    renderEntry(visionToForm(merged));
    setTimeout(function(){
      var w = document.getElementById("vis-warn");
      if (w) w.scrollIntoView({ block:"start" });
    }, 0);
    toast("读取完成，请核对");
  }).catch(function(e){
    vlBusy = false;
    out.innerHTML = '<div class="card flag-bad"><h3>处理失败</h3>' +
      '<p class="tiny-note">' + escapeHtml(e && e.message || e) + '</p>' +
      '<p class="tiny-note">PDF 还在，可以重试或改勾别的页。</p>' +
      '<div class="row"><button class="btn tiny" onclick="runPdf()">重试</button></div></div>';
  });
}

/* 多页结果合并成一条记录。表头字段先到先得，观测值按键去重。 */
function mergeDrafts(list){
  if (list.length === 1) return list[0];
  var out = null, seen = {};
  for (var i = 0; i < list.length; i++) {
    var d = list[i];
    if (!out) {
      /* 浅拷贝，并把要往里追加的数组也复制一份 ——
         直接拿 list[0] 当累加器会就地改掉调用方的对象。 */
      out = {}; for (var f in d) if (Object.prototype.hasOwnProperty.call(d, f)) out[f] = d[f];
      out.obs = d.obs.slice();
      out.dis = d.dis.slice();
      out.warnings = {
        unknown: d.warnings.unknown, countOff: d.warnings.countOff,
        conflicts: d.warnings.conflicts.slice(), noDate: d.warnings.noDate
      };
      for (var a = 0; a < out.obs.length; a++) seen[out.obs[a].k] = 1;
      continue;
    }
    /* 表头只在原来是空的时候才补 —— 先出现的那页通常是正文页，更可信 */
    ["date","type","title","hospital","dept","dx"].forEach(function(f){
      if (!out[f] && d[f]) out[f] = d[f];
    });
    ["findings","impression","recommendation"].forEach(function(f){
      if (d[f]) out[f] = out[f] ? (out[f] + "\n" + d[f]) : d[f];
    });
    for (var j = 0; j < d.obs.length; j++) {
      if (seen[d.obs[j].k]) continue;      // 同一项目在多页重复出现，只留第一次
      seen[d.obs[j].k] = 1;
      out.obs.push(d.obs[j]);
    }
    for (var m = 0; m < d.dis.length; m++)
      if (out.dis.indexOf(d.dis[m]) < 0) out.dis.push(d.dis[m]);
    out.warnings.unknown += d.warnings.unknown;
    out.warnings.conflicts = out.warnings.conflicts.concat(d.warnings.conflicts);
  }
  out.warnings.noDate = !out.date;
  out.warnings.countOff = null;            // 多页合并后自报条数没有意义
  return out;
}

/* 文字路径：同一个模型、同一套提示词，只是把图片换成文本。 */
function callVisionText(text){
  var p = vlProvider(), key = lsGet(LS.vlKey);
  if (!p) return Promise.reject(new Error("还没选识别服务"));
  if (!key) return Promise.reject(new Error("还没填识别服务的密钥"));

  var ctl = new AbortController();
  var timer = setTimeout(function(){ ctl.abort(); }, VL_TIMEOUT);
  var MAX = 24000;
  if (text.length > MAX) text = text.slice(0, MAX) + "\n（后续内容因长度限制被截断）";

  return fetch(p.url, {
    method: "POST",
    headers: { "Content-Type":"application/json", "Authorization":"Bearer " + key },
    body: JSON.stringify({
      model: vlModel(), temperature: 0, max_tokens: (p.maxTokens || 4000),
      messages: [{ role:"user", content:
        visionPrompt(ST.diseases) +
        "\n\n下面是从 PDF 文字层里原样抠出来的内容（不是图片，不需要识别，" +
        "但排版可能错乱，同一行的内容可能被拆开）：\n\n" + text }]
    }),
    signal: ctl.signal
  }).then(function(res){
    clearTimeout(timer);
    return res.text().then(function(txt){
      var data = null;
      try { data = JSON.parse(txt); } catch(e){}
      if (!res.ok) {
        if (/temperature/i.test(txt)) throw new Error("模型参数不接受，请重试");
        throw new Error((data && data.error && data.error.message) || ("服务返回 " + res.status));
      }
      var ch = data && data.choices && data.choices[0];
      var content = ch && ch.message && ch.message.content;
      if (!content) throw new Error("服务返回内容为空");
      return { data: parseJsonLoose(content), model: (data && data.model) || vlModel(),
               meta: { raw: content, model: (data && data.model) || vlModel(),
                       finish: ch.finish_reason || "", usage: (data && data.usage) || null } };
    });
  }).catch(function(e){
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("处理超时，可以少勾几页再试");
    throw e;
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { textQuality, mergeDrafts, PDF_MIN_CHARS, PDF_RENDER_SCALE,
                     PDF_USEFUL, PDF_MAX_PAGES };
}
