// 字典完整性。运行：node test-data.js
// 这些是结构性错误 —— 一旦犯了，界面上表现得千奇百怪却很难定位到字典。
const fs = require("fs");
require("./test-load").load();   // 把 data.js + core.js 装进全局

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

console.log("=== 规模 ===");
console.log(`  指标 ${IND.length} 条 · 疾病 ${SEED_DIS.length} 个 · 分类 ${CATS.length} 个`);
t("指标数量在预期区间", IND.length >= 55 && IND.length <= 75, true);

console.log("=== 键的唯一性 ===");
t("k 无重复", IND.length - new Set(IND.map(i => i.k)).size, 0);
t("疾病 id 无重复", SEED_DIS.length - new Set(SEED_DIS.map(d => d.id)).size, 0);
t("报告类型 v 无重复", REPORT_TYPES.length - new Set(REPORT_TYPES.map(r => r.v)).size, 0);

console.log("=== 必填字段 ===");
t("每条都有 k/n/cat/vt/g", IND.filter(i => !i.k || !i.n || !i.cat || !i.vt || !i.g).map(i => i.k), []);
t("vt 取值合法", IND.filter(i => !["numeric","text","positive_negative"].includes(i.vt)).map(i => i.k), []);
t("g 都在 GS 里", IND.filter(i => !GS.includes(i.g)).map(i => i.k), []);
t("cat 都在 CATS 里", IND.filter(i => !CATS.includes(i.cat)).map(i => i.k), []);
t("GS 覆盖 GRP 的全部键", GS.slice().sort(), Object.keys(GRP).sort());

console.log("=== 判读层自洽 ===");
t("有 sel 的必有 ok",  IND.filter(i => i.sel && !Array.isArray(i.ok)).map(i => i.k), []);
t("ok 必须是 sel 的子集",
  IND.filter(i => i.sel && i.ok && i.ok.some(o => !i.sel.includes(o))).map(i => i.k), []);
t("min 必须小于 max",
  IND.filter(i => i.min != null && i.max != null && i.min >= i.max).map(i => i.k), []);
t("hard 必须大于 max",
  IND.filter(i => i.hard != null && i.max != null && i.hard <= i.max).map(i => i.k), []);
t("有阈值就得有 t（给人看的写法）",
  IND.filter(i => (i.min != null || i.max != null || i.sel) && !i.t).map(i => i.k), []);
t("trend 为 true 的必须是 numeric",
  IND.filter(i => i.trend && i.vt !== "numeric").map(i => i.k), []);
t("文字/定性项不进趋势",
  IND.filter(i => i.vt !== "numeric" && i.trend).map(i => i.k), []);

console.log("=== 单位 ===");
t("numeric 项必须声明 units",
  IND.filter(i => i.vt === "numeric" && (!i.units || !i.units.length)).map(i => i.k), []);
t("默认单位 u 必须出现在 units 里",
  IND.filter(i => i.vt === "numeric" && i.u && !i.units.includes(i.u)).map(i => i.k), []);
t("UNIT_CONV 的键都存在于字典",
  Object.keys(UNIT_CONV).filter(k => !IND.some(i => i.k === k)), []);
t("UNIT_CONV 的源单位必须在该指标的 units 里",
  Object.keys(UNIT_CONV).flatMap(k => {
    const ind = IND.find(i => i.k === k);
    return Object.keys(UNIT_CONV[k]).filter(u => !ind.units.includes(u)).map(u => k + ":" + u);
  }), []);
t("UNIT_CONV 的目标单位也必须在 units 里",
  Object.keys(UNIT_CONV).flatMap(k => {
    const ind = IND.find(i => i.k === k);
    return Object.values(UNIT_CONV[k]).filter(r => !ind.units.includes(r.to)).map(r => k + "->" + r.to);
  }), []);

console.log("=== 别名不冲突 ===");
// 两个指标共用一个压缩后的别名 = 识别时随机挑一个，必错
const seen = {}, clash = [];
for (const ind of IND) {
  for (const nm of [ind.n].concat(ind.alias || [])) {
    const c = compactKey(nm);
    if (!c) continue;
    if (seen[c] && seen[c] !== ind.k) clash.push(`${nm} → ${seen[c]} / ${ind.k}`);
    else seen[c] = ind.k;
  }
}
t("别名无跨指标冲突", clash, []);
t("每条至少有一个别名", IND.filter(i => !i.alias || !i.alias.length).map(i => i.k), []);

console.log("=== 疾病 ===");
t("keyInd 都能解析到真实指标",
  SEED_DIS.flatMap(d => (d.keyInd || []).filter(k => !IND.some(i => i.k === k)).map(k => d.id + ":" + k)), []);
t("每个疾病都有 keyInd（否则打印件是流水账）",
  SEED_DIS.filter(d => !d.keyInd || !d.keyInd.length).map(d => d.id), []);
t("每个疾病都有 keywords", SEED_DIS.filter(d => !d.keywords || !d.keywords.length).map(d => d.id), []);
t("recTypes 都是合法类型",
  SEED_DIS.flatMap(d => (d.recTypes || []).filter(v => !REPORT_TYPES.some(r => r.v === v))
    .map(v => d.id + ":" + v)), []);
t("color 只用现有 CSS 变量",
  SEED_DIS.filter(d => !["good","warn","bad","accent"].includes(d.color)).map(d => d.id), []);
t("forDis 引用的疾病都存在",
  IND.flatMap(i => (i.forDis || []).filter(d => !SEED_DIS.some(s => s.id === d)).map(d => i.k + ":" + d)), []);

// 双向一致：疾病说关心 X，X 也该说自己 for 这个病（反过来不强求，
// 因为 forDis 是「相关」，keyInd 是「核心」，核心必然相关）
t("keyInd 与 forDis 双向一致",
  SEED_DIS.flatMap(d => (d.keyInd || []).filter(k => {
    const ind = IND.find(i => i.k === k);
    return ind && !(ind.forDis || []).includes(d.id);
  }).map(k => d.id + " 关心 " + k + "，但该指标 forDis 里没有它")), []);

console.log("=== 报告类型 ===");
t("TYPE_ALIAS 的值都是合法类型",
  Object.values(TYPE_ALIAS).filter(v => !REPORT_TYPES.some(r => r.v === v)), []);
t("每个类型的 aiName 都能被 TYPE_ALIAS 映射回来",
  REPORT_TYPES.filter(r => TYPE_ALIAS[r.aiName] !== r.v).map(r => r.v), []);

console.log("=== 目标值是人群参考，不是任何人的治疗目标 ===");
// 这条是防止把上一个 app 的个人目标误抄进来
t("LDL 用人群上限 3.4", IND.find(i => i.k === "lipid_ldl_c").max, 3.4);
t("糖化用人群上限 6.0", IND.find(i => i.k === "glucose_hba1c").max, 6.0);
t("TSH 用人群区间 0.27–4.2",
  [IND.find(i => i.k === "thyroid_tsh").min, IND.find(i => i.k === "thyroid_tsh").max], [0.27, 4.2]);
t("需要个体化的项目都在 w 里点明了要去改",
  ["lipid_ldl_c","glucose_hba1c","thyroid_tsh","thyroid_tg"]
    .filter(k => !/个人目标/.test(IND.find(i => i.k === k).w || "")), []);

console.log("=== 同名不同物的消歧 ===");
// TG（甘油三酯）和 Tg（甲状腺球蛋白）小写后完全一样。
// 猜错的后果是把甲状腺球蛋白记成血脂，比认不出来严重得多。
t("tg 在 AMBIG 表里", Array.isArray(AMBIG["tg"]) && AMBIG["tg"].length === 2, true);
t("裸 TG 不在任何指标的 alias 里",
  IND.filter(i => (i.alias || []).some(a => compactKey(a) === "tg")).map(i => i.k), []);
t("按单位判为甘油三酯",
  matchIndicator({ itemName:"TG", unit:"mmol/L" }).k, "lipid_tg");
t("按单位判为甲状腺球蛋白",
  matchIndicator({ itemName:"Tg", unit:"ng/mL" }).k, "thyroid_tg");
t("按小节判为甲状腺球蛋白",
  matchIndicator({ itemName:"Tg", sectionName:"甲功五项" }).k, "thyroid_tg");
t("没有线索时拒绝猜", matchIndicator({ itemName:"TG" }).k, null);
t("拒绝时说明了原因", /不同科室指不同的东西/.test(matchIndicator({ itemName:"TG" }).why), true);

console.log("=== 不含任何病历数据 ===");
const src = fs.readFileSync("data.js", "utf8");
t("不含具体日期", (src.match(/20\d{2}-\d{2}-\d{2}/g) || []), []);
// 药名本身可以出现（它们是识别疾病用的通用关键词），
// 要防的是把某个人的在用药清单硬编码进来。
t("没有硬编码的在用药清单", /在用药[：:]/.test(src), false);
t("药名只出现在疾病关键词里",
  ["优甲乐","恩替卡韦","非布司他","他汀"].filter(name => {
    const inKeywords = SEED_DIS.some(d => (d.keywords || []).includes(name));
    return src.includes(name) && !inKeywords;
  }), []);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
