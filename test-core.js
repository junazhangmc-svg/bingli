// core.js 纯函数测试。运行：node test-core.js
require("./test-load").load();

let pass = 0, fail = 0;
function t(name, got, want){
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else { fail++; console.log(`  FAIL  ${name}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}

console.log("=== 日期：算术走 UTC，今天走本地 ===");
t("加一天", addDays("2026-07-28", 1), "2026-07-29");
t("跨月", addDays("2026-07-31", 1), "2026-08-01");
t("跨年", addDays("2026-12-31", 1), "2027-01-01");
t("闰年 2 月", addDays("2028-02-28", 1), "2028-02-29");
t("平年 2 月", addDays("2026-02-28", 1), "2026-03-01");
t("减一天", addDays("2026-01-01", -1), "2025-12-31");
t("相差天数", daysBetween("2026-07-01", "2026-07-28"), 27);
t("反向为负", daysBetween("2026-07-28", "2026-07-01"), -27);
// 东八区早上 8 点前 toISOString() 会给出昨天，today() 必须用本地 getter
t("today 是本地日期", today(), (() => {
  const d = new Date(), p = n => (n < 10 ? "0" : "") + n;
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
})());

console.log("=== 加月：不许溢出到下个月 ===");
t("1/31 加 1 月落在 2 月末", addMonths("2026-01-31", 1), "2026-02-28");
t("闰年 1/31 加 1 月", addMonths("2028-01-31", 1), "2028-02-29");
t("3/31 加 1 月", addMonths("2026-03-31", 1), "2026-04-30");
t("普通加 3 月", addMonths("2026-07-28", 3), "2026-10-28");
t("加 12 月", addMonths("2026-07-28", 12), "2027-07-28");

console.log("=== 日期解析 ===");
t("斜杠", normDate("2026/07/28"), "2026-07-28");
t("中文", normDate("2026年7月8日"), "2026-07-08");
t("点分隔", normDate("2026.7.8"), "2026-07-08");
t("带时间", normDate("2026-07-28 09:31:00"), "2026-07-28");
t("补零", normDate("2026-7-8"), "2026-07-08");
t("非法月份", normDate("2026-13-01"), "");
t("非法日", normDate("2026-01-45"), "");
t("空", normDate(""), "");
t("垃圾", normDate("下周三"), "");

console.log("=== 复查建议 → 日期 ===");
// 飞牛原版这里有个真 bug：本地时间构造、UTC 输出，东八区差一天。改成走 addMonths。
t("明确日期优先", recheckDate("2026-07-28", "请于2026年10月15日复查").due, "2026-10-15");
t("N 个月", recheckDate("2026-07-28", "建议3个月后复查").due, "2026-10-28");
t("N 个月 · 跨月末", recheckDate("2026-01-31", "1个月后复查").due, "2026-02-28");
t("N 周", recheckDate("2026-07-28", "2周后复查").due, "2026-08-11");
t("N 天", recheckDate("2026-07-28", "10天后复查血常规").due, "2026-08-07");
t("半年", recheckDate("2026-07-28", "半年随访一次").due, "2027-01-28");
t("一年", recheckDate("2026-07-28", "建议一年后复查").due, "2027-07-28");
t("没写间隔时默认 3 个月", recheckDate("2026-07-28", "定期复查").due, "2026-10-28");
t("默认时必须说明是猜的", /只是猜的/.test(recheckDate("2026-07-28", "定期复查").basis), true);
t("basis 里带出原文", /3个月/.test(recheckDate("2026-07-28", "建议3个月后复查").basis), true);

console.log("=== judge：±15% 带 ===");
const ldl = indByKey("lipid_ldl_c");   // max 3.4
t("达标", judge(ldl, "2.59").lv, "good");
t("刚好等于上限算达标", judge(ldl, "3.4").lv, "good");
t("超一点是偏离", judge(ldl, "3.6").lv, "warn");
t("超 15% 以上是超标", judge(ldl, "4.0").lv, "bad");
const hdl = indByKey("lipid_hdl_c");   // min 1.0
t("低于下限是偏离", judge(hdl, "0.95").lv, "warn");
t("低于下限 15% 是超标", judge(hdl, "0.8").lv, "bad");
const alt = indByKey("liver_alt");     // max 50 hard 150
t("ALT 60 只是偏离（有 hard）", judge(alt, "60").lv, "warn");
t("ALT 140 仍是偏离", judge(alt, "140").lv, "warn");
t("ALT 超 3 倍上限才是超标", judge(alt, "160").lv, "bad");
t("空值不判", judge(ldl, ""), null);
t("非数字不判", judge(ldl, "阴性"), null);
t("没有阈值的指标不判", judge(indByKey("body_weight"), "70"), null);
t("显示值去掉多余的零", judge(ldl, "1.30").txt, "1.3");

console.log("=== judge：选择型 ===");
const ket = indByKey("urine_ketone");
t("阴性达标", judge(ket, "阴性").lv, "good");
t("1+ 异常", judge(ket, "1+").lv, "bad");
const hbsab = indByKey("infectious_hbsab");
t("表面抗体阳性才是好事", judge(hbsab, "阳性").lv, "good");
t("表面抗体阴性算异常", judge(hbsab, "阴性").lv, "bad");

console.log("=== 个人目标覆盖字典 ===");
const targets = { lipid_ldl_c: { max:1.4, t:"< 1.4", w:"极高危" } };
const myLdl = withTarget(ldl, targets);
t("覆盖后 2.59 变超标", judge(myLdl, "2.59").lv, "bad");
t("原字典不受影响", judge(ldl, "2.59").lv, "good");
t("标记为个人目标", myLdl._custom, true);
t("没有覆盖时原样返回", withTarget(hdl, targets), hdl);

console.log("=== 单位归一化与换算 ===");
t("小写补正", normUnit("mmol/l"), "mmol/L");
t("u 转 μ", normUnit("umol/L"), "μmol/L");
t("全角斜杠", normUnit("mg／dL"), "mg/dL");
t("乘号统一", normUnit("10*9/L"), "10^9/L");
t("平方符号", normUnit("kg/m2"), "kg/m²");
t("中文单位", normUnit("公斤"), "kg");
t("LDL mg/dL 转 mmol/L", convUnit("lipid_ldl_c", "100", "mg/dL").val, "2.586");
t("换算后单位变了", convUnit("lipid_ldl_c", "100", "mg/dL").unit, "mmol/L");
t("同单位不换算", convUnit("lipid_ldl_c", "2.59", "mmol/L").converted, false);
t("血糖 mg/dL", convUnit("glucose_fasting", "90", "mg/dL").val, "4.995");
t("血红蛋白 g/dL 转 g/L", convUnit("cbc_hgb", "14", "g/dL").val, "140");
t("身高 m 转 cm", convUnit("body_height", "1.75", "m").val, "175");
t("没有换算规则时原样返回", convUnit("liver_alt", "62", "U/L").converted, false);

console.log("=== 指标匹配 ===");
t("英文缩写", matchIndicator({ itemName:"LDL-C", unit:"mmol/L" }).k, "lipid_ldl_c");
t("中文全名", matchIndicator({ itemName:"低密度脂蛋白胆固醇" }).k, "lipid_ldl_c");
t("带括号的写法", matchIndicator({ itemName:"低密度脂蛋白(LDL-C)" }).k, "lipid_ldl_c");
t("带空格", matchIndicator({ itemName:" ALT " }).k, "liver_alt");
t("单位相符提高置信度",
  matchIndicator({ itemName:"ALT", unit:"U/L" }).conf > matchIndicator({ itemName:"ALT" }).conf, true);
t("单位明显不符时拒绝",
  matchIndicator({ itemName:"ALT", unit:"mmol/L" }).k, null);
t("尿里的葡萄糖不是空腹血糖",
  matchIndicator({ itemName:"葡萄糖", sectionName:"尿常规" }).k, null);
t("认不出来的返回 null 而不是抛错",
  matchIndicator({ itemName:"某医院自创指标" }).k, null);
t("认不出来时给出原因",
  matchIndicator({ itemName:"某医院自创指标" }).why, "字典里没有这个名字");

console.log("=== 异常标记：只认报告上印的，不从参考区间反推 ===");
t("上箭头", flagFromText("62 ↑"), "high");
t("下箭头", flagFromText("1.08 ↓"), "low");
t("偏高二字", flagFromText("结果偏高"), "high");
t("阳性", flagFromText("阳性"), "abnormal");
t("没有标记就是 null", flagFromText("62"), null);
t("不从区间反推", flagFromText("62（参考 9-50）"), null);

console.log("=== 一致性检查：模型自相矛盾时要让人看一眼 ===");
t("说正常但超出它自己抄的区间",
  /标为正常/.test(flagConflict({ val:"62", refLow:9, refHigh:50, flag:"normal" })), true);
t("说异常但在区间内",
  /标为异常/.test(flagConflict({ val:"30", refLow:9, refHigh:50, flag:"high" })), true);
t("一致时不报", flagConflict({ val:"30", refLow:9, refHigh:50, flag:"normal" }), null);
t("没有区间时不报", flagConflict({ val:"62", flag:"normal" }), null);

console.log("=== 标题 ===");
t("泛标题要重做", isGenericTitle("检验报告单"), true);
t("带空格的泛标题也算", isGenericTitle(" 体检 报告 "), true);
t("有信息量的标题保留", isGenericTitle("甲状腺功能五项"), false);
t("太短的算泛标题", isGenericTitle("单"), true);
t("按类型合成", makeTitle({ title:"检验报告单", type:"laboratory",
  bodyParts:[{ name:"血常规" }] }), "血常规检验报告");
t("门诊用记录二字", makeTitle({ title:"门诊病历", type:"outpatient", dept:"内分泌科" }),
  "内分泌科门诊记录");
t("体检有兜底部位", makeTitle({ title:"体检报告", type:"checkup" }), "综合体检体检报告");
t("好标题不动", makeTitle({ title:"胸部CT平扫", type:"imaging" }), "胸部CT平扫");

console.log("=== 报告类型映射 ===");
t("模型说 physical_exam", normType("physical_exam"), "checkup");
t("模型说 receipt", normType("receipt"), "billing");
t("模型说中文", normType("影像"), "imaging");
t("没听过的落到 other", normType("weird"), "other");
t("空值落到 other", normType(null), "other");

console.log("=== 用药区间：边界一律闭区间 ===");
const meds = [
  { id:"m1", name:"阿托伐他汀", dose:"20mg", freq:"每晚一次", start:"2025-06-01", stop:"2026-01-10" },
  { id:"m2", name:"二甲双胍",   dose:"0.5g",  freq:"每日两次", start:"2025-01-01", stop:null },
  { id:"m3", name:"某短期药",   dose:"1片",   freq:"每日一次", start:"2026-03-15", stop:"2026-03-15" },
];
const names = rs => rs.map(m => m.name).sort();
t("区间中间", names(medsActiveOn(meds, "2025-09-01")), ["二甲双胍","阿托伐他汀"]);
t("开始当天算在吃", names(medsActiveOn(meds, "2025-06-01")), ["二甲双胍","阿托伐他汀"]);
t("停止当天算在吃", names(medsActiveOn(meds, "2026-01-10")), ["二甲双胍","阿托伐他汀"]);
t("停止次日不算", names(medsActiveOn(meds, "2026-01-11")), ["二甲双胍"]);
t("开始前一天不算（他汀 6/1 起，5/31 不该出现）",
  medsActiveOn(meds, "2025-05-31").some(m => m.name === "阿托伐他汀"), false);
t("stop 为 null 表示还在吃", names(medsActiveOn(meds, "2030-01-01")), ["二甲双胍"]);
t("同日起止的药当天算在吃", names(medsActiveOn(meds, "2026-03-15")), ["二甲双胍","某短期药"]);
t("同日起止的药次日不算", names(medsActiveOn(meds, "2026-03-16")), ["二甲双胍"]);
t("非法日期返回空", medsActiveOn(meds, "乱写"), []);

console.log("=== 用药区间重叠 ===");
t("完全包含", names(medsOverlapping(meds, "2025-01-01", "2030-01-01")).length, 3);
t("部分重叠", names(medsOverlapping(meds, "2026-01-05", "2026-01-20")), ["二甲双胍","阿托伐他汀"]);
t("区间在停药之后", names(medsOverlapping(meds, "2026-02-01", "2026-02-28")), ["二甲双胍"]);
t("区间在开始之前", names(medsOverlapping(meds, "2024-01-01", "2024-12-31")), []);
t("标签拼装", medLabel(meds[0]), "阿托伐他汀 20mg 每晚一次");

console.log("=== 记录检索 ===");
const recs = [
  { id:"r3", date:"2026-07-20", updatedAt:"2026-07-20T10:00", v:{ lipid_ldl_c:"2.59", thyroid_tsh:"3.79" }, dis:["hlp"] },
  { id:"r2", date:"2026-01-04", updatedAt:"2026-01-04T10:00", v:{ lipid_ldl_c:"1.30" }, dis:["hlp","cad"] },
  { id:"r1", date:"2025-06-15", updatedAt:"2025-06-15T10:00", v:{ thyroid_tsh:"0.33" }, dis:["thyca"] },
];
t("找最近一次", lastWith(recs, "lipid_ldl_c", null).val, "2.59");
t("找某日之前的一次", lastWith(recs, "lipid_ldl_c", "2026-07-20").val, "1.30");
t("从未测过返回 null", lastWith(recs, "lipid_apob", null), null);
t("按疾病筛选", recordsForDiseases(recs, ["cad"]).map(r => r.id), ["r2"]);
t("多疾病取并集", recordsForDiseases(recs, ["cad","thyca"]).map(r => r.id), ["r2","r1"]);
t("不传疾病返回全部", recordsForDiseases(recs, []).length, 3);

console.log("=== 同日多条按 updatedAt 取新 ===");
const sameDay = [
  { id:"a", date:"2026-07-20", updatedAt:"2026-07-20T09:00", v:{ lipid_ldl_c:"2.00" } },
  { id:"b", date:"2026-07-20", updatedAt:"2026-07-20T15:00", v:{ lipid_ldl_c:"2.59" } },
];
t("取后录入的那条", lastWith(sameDay, "lipid_ldl_c", null).val, "2.59");

console.log("=== keyInd 并集 ===");
const u = keyIndUnion(SEED_DIS, ["hlp","cad"]);
t("保持首次出现的顺序", u[0], "lipid_ldl_c");
t("去重", u.length, new Set(u).size);
t("包含两个病各自独有的项", u.includes("enzyme_ck") && u.includes("us_carotid"), true);
t("不存在的疾病被忽略", keyIndUnion(SEED_DIS, ["nosuch"]), []);

console.log("=== 疾病标签：确定性规则 ===");
const sug = suggestDiseases({ title:"血脂八项", v:{ lipid_ldl_c:"2.59" } }, SEED_DIS);
t("按指标命中血脂", "hlp" in sug, true);
t("给出了命中原因", /查了|提到/.test(sug.hlp), true);
const sug2 = suggestDiseases({ title:"甲状腺超声", impression:"甲状腺术后改变" }, SEED_DIS);
t("按关键词命中甲状腺癌", "thyca" in sug2, true);
t("无关记录不乱打标", Object.keys(suggestDiseases({ title:"牙科检查" }, SEED_DIS)), []);

console.log("=== mdLite ===");
t("标题", mdLite("## 趋势"), "<h4>趋势</h4>");
t("列表", mdLite("- 甲\n- 乙"), "<ul><li>甲</li><li>乙</li></ul>");
t("有序列表", mdLite("1. 甲"), "<ul><li>甲</li></ul>");
t("加粗", mdLite("**重要**"), "<p><strong>重要</strong></p>");
t("先转义再注入", mdLite("<script>x</" + "script>"),
  "<p>&lt;script&gt;x&lt;/script&gt;</p>");
t("属性注入也被挡住", mdLite('点击"这里"'), "<p>点击&quot;这里&quot;</p>");
t("空行分段", mdLite("甲\n\n乙"), "<p>甲</p><p>乙</p>");

console.log("=== escapeHtml ===");
t("尖括号", escapeHtml("<b>"), "&lt;b&gt;");
t("引号", escapeHtml(`a"b'c`), "a&quot;b&#39;c");
t("null 变空串", escapeHtml(null), "");

console.log("=== 到期计算 ===");
t("不定期分组不算到期", dueInfo(recs, "n").state, "none");
t("从未查过的组判为已过期", dueInfo([], "q").state, "over");
const dq = dueInfo(recs, "q");
t("按最近一次加周期", dq.due, addDays("2026-07-20", 90));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
