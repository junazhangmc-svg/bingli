// 渲染层测试。运行：node test-ui.js
// 用手搭的 DOM 桩跑 render*，断言输出的 HTML 里有该有的东西。
// 重点覆盖「错了会静默丢数据」和「错了会误导判读」的两类问题。
require("./test-load").load(["data.js", "core.js"]);

/* ---------- DOM / 浏览器桩 ---------- */
const store = {};
global.localStorage = {
  getItem: k => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = v; },
  removeItem: k => { delete store[k]; },
};
const noop = () => {};
const els = {};
function stub(id){
  if (!els[id]) els[id] = {
    id, innerHTML:"", textContent:"", value:"", hidden:false, checked:false,
    className:"", classList:{ add:noop, remove:noop, toggle:noop },
    setAttribute:(k,v)=>{ els[id][k] = v; }, onclick:null,
    scrollIntoView:noop, parentNode:{ classList:{ toggle:noop } },
  };
  return els[id];
}
global.document = {
  getElementById: stub,
  querySelectorAll: () => [],
  createElement: () => ({ style:{}, select:noop, click:noop, appendChild:noop }),
  body: { appendChild:noop, removeChild:noop },
  addEventListener: noop,
};
global.window = { scrollTo: noop, isSecureContext:false };
global.navigator = {};
global.Blob = class {};
global.URL = { createObjectURL:()=>"", revokeObjectURL:noop };
global.FileReader = class {};
global.confirm = () => true;
global.alert = noop;
global.prompt = () => null;
global.indexedDB = { open: () => ({}) };

/* store.js 里 IDB 那半边在这里用不到，桩掉即可 */
require("./test-load").loadInto("store.js");
global.openDB = () => Promise.resolve({});
global.seedOnce = () => Promise.resolve(false);
global.loadRecords = () => Promise.resolve([]);
global.loadDiseases = () => Promise.resolve([]);
global.loadMeds = () => Promise.resolve([]);
global.loadTargets = () => Promise.resolve({});
global.requestPersist = () => Promise.resolve(false);
global.storageInfo = () => Promise.resolve({ supported:false });

require("./test-load").loadInto("app.js");

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

/* ---------- 固定数据 ---------- */
const RECS = [
  { id:"r3", date:"2026-07-20", updatedAt:"2026-07-20T10:00", type:"laboratory",
    title:"血脂八项", hospital:"某医院", dept:"内分泌科",
    v:{ lipid_ldl_c:"2.59", thyroid_tsh:"5.10", liver_alt:"42" },
    dis:["hlp"], note:"停药后复查", obs:[], imgs:[], manual:[] },
  { id:"r2", date:"2026-01-04", updatedAt:"2026-01-04T10:00", type:"laboratory",
    title:"生化全套", v:{ lipid_ldl_c:"1.30", liver_alt:"38" },
    dis:["hlp","cad"], note:"", obs:[], imgs:[], manual:[] },
  { id:"r1", date:"2025-06-15", updatedAt:"2025-06-15T10:00", type:"other",
    title:"手术记录", v:{}, dis:["thyca"], note:"甲状腺全切", obs:[], imgs:[], manual:[] },
];
const MEDS = [
  { id:"m1", name:"阿托伐他汀", dose:"20mg", freq:"每晚一次",
    start:"2025-08-01", stop:"2026-03-01", dis:["hlp"] },
  { id:"m2", name:"二甲双胍", dose:"0.5g", freq:"每日两次",
    start:"2025-01-01", stop:null, dis:["dm"] },
];
function setup(over){
  ST.records = (over && over.records) || RECS;
  ST.diseases = (over && over.diseases) || SEED_DIS.map(d => Object.assign({}, d));
  ST.meds = (over && over.meds) || MEDS;
  ST.targets = (over && over.targets) || {};
  ST.ready = true;
}

console.log("=== 首页 ===");
setup();
renderHome();
const home = els["v-home"].innerHTML;
t("有最近一次摘要条", /class="latest/.test(home), true);
t("摘要条给出结论而非逐项", /项超标|项轻度偏离|全部达标/.test(home), true);
t("摘要条能点进详情", home.includes("看详情"), true);
t("首页不渲染逐项判读", /class="v-row"[\s\S]*目标/.test(home), false);
t("有到期卡片", home.includes("下次该查什么"), true);
t("项目清单收进折叠", /<details class="fold"><summary>每组分别要查哪些项目/.test(home), true);
// 到期卡片只该给有固定周期的组出；「不定期」组仍会出现在折叠的项目清单里，
// 那是对的 —— 用户需要知道有哪些项目是按需查的。
t("到期卡片数 = 有周期的组数",
  (home.match(/class="card tight flag-/g) || []).length,
  GS.filter(g => GRP[g].days).length);

console.log("=== 摘要条判读 ===");
// 断言必须只看摘要条本身 —— 折叠里列了全部 70 个指标名，
// 直接在整页 HTML 里搜项目名一定会误判。
const banner = home.slice(home.indexOf('class="latest'), home.indexOf("看详情"));
// LDL 2.59 达标（人群上限 3.4）；ALT 42 达标（上限 50）；
// TSH 5.10 超上限 4.2 且超过 15%（4.83）→ 超标
t("标为超标", /l-bad/.test(banner), true);
t("点名了超标项", banner.includes("促甲状腺素 TSH"), true);
t("达标项不出现在摘要条里", banner.includes("低密度脂蛋白"), false);
t("报出超标数量", banner.includes("有 1 项超标"), true);

setup({ records:[{ id:"a", date:"2026-07-20", updatedAt:"x", type:"laboratory",
  title:"体检", v:{ lipid_ldl_c:"5.00" }, dis:[], note:"" }] });
renderHome();
t("超标标红", /l-bad/.test(els["v-home"].innerHTML), true);

setup({ records:[{ id:"a", date:"2026-07-20", updatedAt:"x", type:"other",
  title:"手术", v:{}, dis:[], note:"只有文字" }] });
renderHome();
t("只有文字时明说没有可判读的数值",
  /仅记事，没有可判读的数值/.test(els["v-home"].innerHTML), true);
t("不误标成绿色（会被读成一切正常）", /l-good/.test(els["v-home"].innerHTML), false);
t("备注仍然显示", els["v-home"].innerHTML.includes("只有文字"), true);

setup({ records:[] });
renderHome();
t("空状态", /还没有任何记录/.test(els["v-home"].innerHTML), true);
t("空状态不显示备份提醒", /还没备份过/.test(els["v-home"].innerHTML), false);

console.log("=== 备份提醒 ===");
setup();
delete store["bl_backup_nag"];
renderHome();
t("从没备份过要提醒", /还没备份过/.test(els["v-home"].innerHTML), true);
store["bl_backup_nag"] = today();
renderHome();
t("刚备份过不提醒", /还没备份过|上次备份是/.test(els["v-home"].innerHTML), false);
store["bl_backup_nag"] = addDays(today(), -20);
renderHome();
t("超过 14 天要提醒", /上次备份是 20 天前/.test(els["v-home"].innerHTML), true);
delete store["bl_backup_nag"];

console.log("=== 当前在吃 ===");
setup();
renderHome();
t("列出今天在吃的", els["v-home"].innerHTML.includes("二甲双胍"), true);
t("已停的不列", els["v-home"].innerHTML.includes("阿托伐他汀"), false);

console.log("=== 记录列表 ===");
setup();
renderHist();
const hist = els["v-hist"].innerHTML;
t("三条都在", (hist.match(/class="hrec"/g) || []).length, 3);
t("第一条默认展开", /<details class="hrec" open>/.test(hist), true);
t("显示疾病标签", hist.includes("血脂"), true);
t("显示时间跨度", hist.includes("2025-06-15 至 2026-07-20"), true);
t("仅记事的标出来", hist.includes("仅记事"), true);
t("有逐项判读", /class="v-row"/.test(hist), true);
t("显示目标值", hist.includes("目标 &lt; 3.4"), true);
t("显示与上次的对比", /比 2026-01-04/.test(hist), true);
t("对比方向正确（LDL 从 1.30 升到 2.59）", /↑ \+1\.29 比 2026-01-04/.test(hist), true);
t("列出当时在用的药", hist.includes("这次检查时在用的药"), true);

console.log("=== 个人目标覆盖后判读要变 ===");
setup({ targets:{ lipid_ldl_c:{ max:1.4, t:"< 1.4", w:"极高危" } } });
renderHist();
const hist2 = els["v-hist"].innerHTML;
t("2.59 变成超标", /低密度脂蛋白 LDL-C <span class="pill p-bad"/.test(hist2), true);
t("标注是个人目标", hist2.includes("（个人）"), true);
t("首页摘要也跟着变红", (renderHome(), /l-bad/.test(els["v-home"].innerHTML)), true);

console.log("=== 录入页 ===");
setup();
EDIT_ID = null;
renderEntry();
const entry = els["v-entry"].innerHTML;
t("六个分类按钮都在",
  Object.keys(SCOPES).every(s => entry.includes(SCOPES[s].label)), true);
t("当前分类高亮", /aria-pressed="true"/.test(entry), true);
// 所有指标的输入框都必须存在，未选中的组只是 hidden ——
// 否则切分类时 readForm 读不到，已填的内容会静默丢失
const inputs = (entry.match(/id="in-k-[a-z0-9_:]+"/g) || []).length;
t("每个指标都有输入框（未显示的只是 hidden）", inputs, IND.length);
t("非当前分类的卡片被 hidden", /class="card" hidden/.test(entry), true);
// 注意别把 id="dis-sug"（建议提示框）算进来
t("有疾病勾选框",
  SEED_DIS.filter(d => !entry.includes('id="dis-' + d.id + '"')).map(d => d.id), []);
t("日期默认今天", entry.includes('id="in-date" value="' + today() + '"'), true);
t("有报告日期的提醒", entry.includes("不是今天"), true);

console.log("=== 编辑已有记录时要回填 ===");
EDIT_ID = "r3";
renderEntry();
const edit = els["v-entry"].innerHTML;
t("标题回填", edit.includes('id="in-title" value="血脂八项"'), true);
t("日期回填", edit.includes('id="in-date" value="2026-07-20"'), true);
t("医院回填", edit.includes('id="in-hospital" value="某医院"'), true);
t("数值回填", edit.includes('id="in-k-lipid_ldl_c" placeholder="—" value="2.59"'), true);
t("疾病标签回填", /id="dis-hlp" checked/.test(edit), true);
t("未选中的疾病不勾", /id="dis-thyca" checked/.test(edit), false);
t("备注回填", edit.includes("停药后复查"), true);
t("按钮文案是保存修改", els["fab-btn"].textContent, "保存修改");
EDIT_ID = null;

console.log("=== 切分类不丢已填内容 ===");
setup();
EDIT_ID = null;
renderEntry();
document.getElementById("in-date").value = "2026-08-01";
document.getElementById("in-k-lipid_ldl_c").value = "1.55";
document.getElementById("in-note").value = "测试备注";
document.getElementById("dis-hlp").checked = true;
const draft = readForm();
t("读到日期", draft.date, "2026-08-01");
t("读到数值", draft.v.lipid_ldl_c, "1.55");
t("读到备注", draft.note, "测试备注");
t("读到疾病勾选", draft.dis, ["hlp"]);
setScope("img");
const after = els["v-entry"].innerHTML;
t("分类确实切了", entryScope(), "img");
t("日期被保留", after.includes('value="2026-08-01"'), true);
t("数值被保留", after.includes('value="1.55"'), true);
t("备注被保留", after.includes("测试备注"), true);
t("疾病勾选被保留", /id="dis-hlp" checked/.test(after), true);
uiSet("scope", "common");

console.log("=== 分类覆盖所有指标 ===");
const covered = [...new Set(Object.values(SCOPES).flatMap(s => s.cats))];
t("每个分类都能被某个快捷键选到", CATS.filter(c => !covered.includes(c)), []);
t("「全部」确实是全部", SCOPES.all.cats.slice().sort(), CATS.slice().sort());
t("每个指标的分类都被覆盖", IND.filter(i => !covered.includes(i.cat)).map(i => i.k), []);

console.log("=== 用药页 ===");
setup();
renderMeds();
const meds = els["v-meds"].innerHTML;
t("分成在吃和已停", meds.includes("在吃（1）") && meds.includes("已停（1）"), true);
t("在吃的标绿", /flag-good[\s\S]*二甲双胍/.test(meds), true);
t("显示起止", meds.includes("2025-08-01 起，2026-03-01 停"), true);
t("还在吃的写至今", meds.includes("2025-01-01 起，至今"), true);
setup({ meds:[] });
renderMeds();
t("空状态说明了为什么要记", /指标怎么变的/.test(els["v-meds"].innerHTML), true);

console.log("=== 更多页 ===");
setup();
renderMore();
const more = els["v-more"].innerHTML;
t("有导出", more.includes("导出 JSON"), true);
t("有导入", more.includes("导入备份"), true);
t("有 zip 完整备份", more.includes("导出 zip（含原图）"), true);
t("列出全部疾病", SEED_DIS.every(d => more.includes(d.name)), true);
t("显示每个疾病挂了几条记录", more.includes("2 条记录"), true);
t("说明目标值是人群参考", more.includes("人群参考值"), true);
t("有清空数据入口", more.includes("清空全部数据"), true);
t("清空前提示先备份", more.includes("先导出备份再点"), true);

console.log("=== 转义：任何用户内容都不能变成标签 ===");
setup({ records:[{ id:"x", date:"2026-07-20", updatedAt:"x", type:"laboratory",
  title:'<img src=x onerror=alert(1)>', hospital:'"><b>hi</b>',
  v:{ lipid_ldl_c:"2.59" }, dis:[], note:"<script>bad</" + "script>" }] });
renderHist();
const esc = els["v-hist"].innerHTML;
t("标题被转义", esc.includes("&lt;img src=x"), true);
t("没有真的 img 标签", /<img /.test(esc), false);
t("备注被转义", esc.includes("&lt;script&gt;"), true);
t("医院名里的引号被转义", esc.includes("&quot;&gt;&lt;b&gt;"), true);
renderHome();
t("首页也转义", /<img /.test(els["v-home"].innerHTML), false);

console.log("=== 疾病建议 ===");
setup();
EDIT_ID = null;
renderEntry();
document.getElementById("in-title").value = "甲状腺功能五项";
document.getElementById("in-k-thyroid_tsh").value = "5.1";
updateSug();
t("建议勾上甲状腺相关", /甲状腺/.test(els["dis-sug"].innerHTML), true);
t("给出了理由", /查了|提到/.test(els["dis-sug"].innerHTML), true);

console.log("=== 路由 ===");
go("hist");
t("切到记录页", VIEW, "hist");
t("记录页可见", els["v-hist"].hidden, false);
t("首页隐藏", els["v-home"].hidden, true);
t("标签高亮", els["t-hist"]["aria-selected"], "true");
go("entry");
t("录入页仍高亮记录标签", els["t-hist"]["aria-selected"], "true");
t("录入页可见", els["v-entry"].hidden, false);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
