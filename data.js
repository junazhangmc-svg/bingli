"use strict";
/* ==========================================================================
 * data.js — 纯数据，无逻辑，无副作用
 *
 * 指标字典 = 两份东西合并：
 *   识别层（alias / units / hints）来自飞牛 fnos-app-health-records（MIT）
 *     —— 视觉模型返回什么名字全看医院怎么印，没有别名表就废
 *   判读层（min / max / hard / t / w / sel / ok）来自「体检记录本」
 *     —— 达标 / 偏离 / 超标 这个核心价值全在这
 *
 * 【重要】这里的 min/max 一律是「人群参考区间」，不是任何人的治疗目标。
 *   糖尿病人的糖化目标是 <7.0，不是人群上限 6.0；
 *   极高危 ASCVD 的 LDL 目标是 <1.4，不是人群 <3.4。
 *   个人目标存在 meta.targets 里，加载时覆盖在字典上（见 store.js）。
 *   这样目标值能扛过 app 升级，字典也能给别人用。
 * ========================================================================== */

/* 改动本文件的指标、别名、单位或判读时必须递增。启动时会据此回补历史记录。 */
var DICT_VERSION = "2026.07.29.1";

/* ---- 复查周期分组 ---------------------------------------------------------
 * days:0 表示没有固定周期（医生开了才查），dueInfo 会跳过。               */
var GRP = {
  q: { name:"每 3 个月 · 核心",   days:90,  why:"在用药物的疗效与安全性" },
  h: { name:"每 6 个月 · 加项",   days:180, why:"专科随访与用药安全性" },
  y: { name:"每年 · 抽血加项",     days:365, why:"年度趋势" },
  i: { name:"每年 · 影像与功能",   days:365, why:"并发症筛查" },
  n: { name:"不定期 · 按需",       days:0,   why:"没有固定周期，医生开了才查" }
};
var GS = ["q","h","y","i","n"];

/* ---- 分类显示顺序（录入表单与打印件按此排） ---- */
var CATS = [
  "血脂","血糖","肝功能","肾功能","电解质","血常规","甲状腺功能",
  "内分泌","肌酶","尿常规","基础测量","影像与功能","影像所见","心电图",
  "耳鼻喉检查","妇科超声","感染筛查"
];

/* ---- 指标字典 -------------------------------------------------------------
 * k     canonicalKey，记录里 v{} 的键，全局唯一
 * n     显示名        cat 分类        spec 标本
 * u     默认单位      units 可接受单位（用于归一化与换算）
 * vt    numeric | text | positive_negative
 * trend 是否进折线趋势（文字/定性项一律 false）
 * alias 别名，识别用；hints 报告小节提示，用于消歧
 * exp   给人看的说明，打印件尾注会用
 * ---- 判读层，全部可选，缺了 judge() 就返回 null 只显示数值 ----
 * min/max 人群参考区间   hard 3 倍上限之类的硬阈值
 * t     目标的人话写法   w  为什么要看它
 * sel/ok 选择型指标的选项与达标集合
 * g     复查周期分组     forDis 哪些疾病关心它（决定打印件的行）
 * ------------------------------------------------------------------------ */
var IND = [

/* ===== 血脂 ===== */
{ k:"lipid_tc", n:"总胆固醇", cat:"血脂", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["TC","TCH","CHO","CHOL","总胆固醇","胆固醇"], hints:["血脂","生化"],
  exp:"血脂总量。真正决定风险的是 LDL，总胆固醇只作参考。",
  max:5.2, t:"< 5.2", g:"q", forDis:["hlp","cad","dm","fld","hypo"] },

{ k:"lipid_tg", n:"甘油三酯", cat:"血脂", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  /* 同上：裸 "TG" 走 AMBIG 消歧 */
  alias:["TRIG","TRIG-GL","甘油三酯","三酰甘油","甘油三脂"], hints:["血脂","生化"],
  exp:"受前一餐影响很大，必须空腹抽血才有意义。",
  max:1.7, t:"< 1.7", g:"q", forDis:["hlp","dm","fld","gout"] },

{ k:"lipid_hdl_c", n:"高密度脂蛋白 HDL-C", cat:"血脂", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["HDL","HDL-C","HDLC","高密度脂蛋白","高密度脂蛋白胆固醇"], hints:["血脂","生化"],
  exp:"越高越好，所以它是唯一一个「低了才算异常」的血脂项。",
  min:1.0, t:"> 1.0", w:"化验单下限常印 1.16（人群参考）；低于 1.0 才是心血管风险阈值",
  g:"q", forDis:["hlp","cad","dm"] },

{ k:"lipid_ldl_c", n:"低密度脂蛋白 LDL-C", cat:"血脂", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["LDL","LDL-C","LDLC","低密度脂蛋白","低密度脂蛋白胆固醇"], hints:["血脂","生化"],
  exp:"降脂治疗唯一的主要靶点。",
  max:3.4, t:"< 3.4",
  w:"3.4 是一般人群上限。已有斑块、糖尿病或冠心病的人目标要严得多（1.8 甚至 1.4），去「设置 → 个人目标」改",
  g:"q", forDis:["hlp","cad","dm"] },

{ k:"lipid_apob", n:"载脂蛋白 B", cat:"血脂", spec:"serum",
  u:"g/L", units:["g/L","mg/dL"], vt:"numeric", trend:true,
  alias:["ApoB","APOB","载脂蛋白B","载脂蛋白 B","apoB"], hints:["血脂","载脂蛋白","生化"],
  exp:"每个致病胆固醇颗粒带且只带一个 ApoB，所以它比 LDL 更能反映真实的颗粒数。",
  max:1.0, t:"< 1.0", g:"q", forDis:["hlp","cad","dm"] },

{ k:"lipid_lpa", n:"脂蛋白 a", cat:"血脂", spec:"serum",
  u:"mg/L", units:["mg/L","mg/dL","nmol/L"], vt:"numeric", trend:true,
  alias:["Lp(a)","LPA","脂蛋白a","脂蛋白(a)","脂蛋白 a"], hints:["血脂","生化"],
  exp:"由基因决定，终生基本不变。查一两次知道基线即可，不必频繁复查。",
  max:300, t:"< 300", g:"n", forDis:["hlp","cad"] },

{ k:"lipid_apoa1", n:"载脂蛋白 A1", cat:"血脂", spec:"serum",
  u:"g/L", units:["g/L","mg/dL"], vt:"numeric", trend:true,
  alias:["ApoA1","APOA1","ApoA-1","载脂蛋白A1","载脂蛋白A-1","载脂蛋白A"],
  hints:["血脂","载脂蛋白","生化"],
  exp:"高密度脂蛋白上的主要蛋白，和 HDL 一样是「越高越好」的那一类。",
  min:1.0, t:"> 1.0", g:"q", forDis:["hlp","cad"] },

{ k:"lipid_sdldl", n:"小而密低密度脂蛋白 sdLDL-C", cat:"血脂", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["sdLDL","sdLDL-C","sd LDL-C","小而密低密度脂蛋白","小而密低密度脂蛋白胆固醇"],
  hints:["血脂","生化"],
  exp:"LDL 里颗粒最小、最容易钻进血管壁的那一部分，致病性比普通 LDL 强。",
  /* 各家实验室方法和区间差异很大，不设统一阈值 —— judge() 缺 min/max 时
     只显示数值不下结论。宁可不判，也不能判错。 */
  w:"各实验室参考区间差异较大，本应用不对它下达标判断，只记录趋势",
  g:"n", forDis:["hlp","cad"] },

/* ===== 血糖 ===== */
{ k:"glucose_fasting", n:"空腹血糖", cat:"血糖", spec:"plasma",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["FPG","FBG","GLU","Glucose","空腹血糖","血糖","葡萄糖","血清葡萄糖"],
  hints:["空腹","血糖","生化"],
  exp:"必须空腹 8 小时以上。报告若写明是随机或餐后血糖，不能和这条混在一起看。",
  min:3.9, max:6.1, t:"3.9 – 6.1", g:"q", forDis:["dm","fld"] },

{ k:"glucose_hba1c", n:"糖化血红蛋白", cat:"血糖", spec:"whole_blood",
  u:"%", units:["%","mmol/mol"], vt:"numeric", trend:true,
  alias:["HbA1c","A1C","HBA1C","糖化血红蛋白","糖化血红蛋白A1c","糖化"], hints:["糖化","血糖"],
  exp:"反映近 2–3 个月的平均血糖，不受当天饮食影响，不用空腹。",
  max:6.0, t:"< 6.0",
  w:"6.0 是人群上限。已确诊糖尿病的治疗目标通常是低于 7.0，去「设置 → 个人目标」改",
  g:"q", forDis:["dm"] },

/* ===== 肝功能 ===== */
{ k:"liver_alt", n:"谷丙转氨酶 ALT", cat:"肝功能", spec:"serum",
  u:"U/L", units:["U/L","IU/L"], vt:"numeric", trend:true,
  alias:["ALT","GPT","谷丙转氨酶","丙氨酸氨基转移酶","丙氨酸转氨酶"], hints:["肝功能","生化"],
  exp:"肝细胞受损时释放到血里。轻度升高很常见，不必紧张。",
  max:50, hard:150, t:"< 50", w:"超过 3 倍上限（150）才需要处理",
  g:"q", forDis:["fld","hbv","hlp"] },

{ k:"liver_ast", n:"谷草转氨酶 AST", cat:"肝功能", spec:"serum",
  u:"U/L", units:["U/L","IU/L"], vt:"numeric", trend:true,
  alias:["AST","GOT","谷草转氨酶","天门冬氨酸氨基转移酶","门冬氨酸氨基转移酶"], hints:["肝功能","生化"],
  exp:"心肌和骨骼肌也含它，所以剧烈运动后会升高。",
  max:40, hard:120, t:"< 40", g:"q", forDis:["fld","hbv"] },

{ k:"liver_ggt", n:"谷氨酰转肽酶 GGT", cat:"肝功能", spec:"serum",
  u:"U/L", units:["U/L","IU/L"], vt:"numeric", trend:true,
  alias:["GGT","γ-GT","r-GT","γ谷氨酰转肽酶","γ-谷氨酰转肽酶","谷氨酰转肽酶","谷氨酰转移酶"],
  hints:["肝功能","生化"],
  exp:"对酒精和胆道问题特别敏感。",
  max:60, hard:180, t:"< 60", g:"q", forDis:["fld","hbv"] },

{ k:"liver_tbil", n:"总胆红素", cat:"肝功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["TBIL","T-BIL","TBil","总胆红素"], hints:["肝功能","生化"],
  exp:"轻度升高常见于 Gilbert 综合征（良性体质），熬夜、饥饿、感冒时更明显。",
  max:23, t:"≤ 23", g:"q", forDis:["fld","hbv"] },

{ k:"liver_alp", n:"碱性磷酸酶 ALP", cat:"肝功能", spec:"serum",
  u:"U/L", units:["U/L","IU/L"], vt:"numeric", trend:true,
  alias:["ALP","AKP","碱性磷酸酶"], hints:["肝功能","生化"],
  exp:"胆道阻塞时明显升高；骨骼疾病和青少年生长期也会高。",
  min:45, max:125, t:"45 – 125", g:"q", forDis:["fld","hbv"] },

{ k:"liver_dbil", n:"直接胆红素 DBIL", cat:"肝功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["DBIL","D-BIL","DBil","直接胆红素","结合胆红素"], hints:["肝功能","生化"],
  exp:"升高更多指向胆道排泄环节的问题。",
  max:8, t:"< 8", g:"q", forDis:["fld","hbv"] },

{ k:"liver_ibil", n:"间接胆红素 IBIL", cat:"肝功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["IBIL","I-BIL","IBil","间接胆红素","非结合胆红素"], hints:["肝功能","生化"],
  exp:"单纯它偏高、其余肝功能都正常，多见于 Gilbert 综合征这类良性体质。",
  max:16, t:"< 16", g:"q", forDis:["fld","hbv"] },

{ k:"liver_tba", n:"总胆汁酸 TBA", cat:"肝功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L"], vt:"numeric", trend:true,
  alias:["TBA","总胆汁酸","胆汁酸"], hints:["肝功能","生化"],
  exp:"对肝细胞损伤和胆汁淤积比较敏感，餐后会生理性升高。",
  max:10, t:"< 10", g:"q", forDis:["fld","hbv"] },

{ k:"liver_tp", n:"总蛋白 TP", cat:"肝功能", spec:"serum",
  u:"g/L", units:["g/L","g/dL"], vt:"numeric", trend:true,
  alias:["TP","TPRO","总蛋白","血清总蛋白"], hints:["肝功能","生化"],
  exp:"白蛋白加球蛋白。",
  min:65, max:85, t:"65 – 85", g:"q", forDis:["fld","hbv","ckd"] },

{ k:"liver_alb", n:"白蛋白 ALB", cat:"肝功能", spec:"serum",
  u:"g/L", units:["g/L","g/dL"], vt:"numeric", trend:true,
  alias:["ALB","白蛋白","血清白蛋白","清蛋白"], hints:["肝功能","生化"],
  exp:"肝脏合成能力的核心指标，长期偏低要同时考虑营养和肾脏丢失。",
  min:40, max:55, t:"40 – 55", g:"q", forDis:["fld","hbv","ckd"] },

{ k:"liver_glb", n:"球蛋白 GLB", cat:"肝功能", spec:"serum",
  u:"g/L", units:["g/L","g/dL"], vt:"numeric", trend:true,
  alias:["GLB","GLO","球蛋白","血清球蛋白"], hints:["肝功能","生化"],
  exp:"慢性炎症和免疫活动时升高。",
  min:20, max:35, t:"20 – 35", g:"q", forDis:["fld","hbv"] },

{ k:"liver_palb", n:"前白蛋白 PALB", cat:"肝功能", spec:"serum",
  u:"mg/L", units:["mg/L","mg/dL"], vt:"numeric", trend:true,
  alias:["PALB","PA","前白蛋白","前清蛋白"], hints:["肝功能","生化"],
  exp:"半衰期只有两天，比白蛋白更早反映肝脏合成能力和营养状态的变化。",
  min:200, max:400, t:"200 – 400", g:"q", forDis:["fld","hbv"] },

/* ===== 肾功能 ===== */
{ k:"renal_creatinine", n:"肌酐", cat:"肾功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["CREA","Cr","CRE","Creatinine","肌酐","血肌酐"], hints:["肾功能","生化"],
  exp:"肌肉量大的人天然偏高，所以单看它不准，要配合 eGFR 一起看。",
  min:41, max:111, t:"41 – 111", w:"男性参考区间约 57–111，女性约 41–81",
  g:"q", forDis:["ckd","dm","htn","gout"] },

{ k:"renal_urea", n:"尿素", cat:"肾功能", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["UREA","BUN","尿素","尿素氮","血尿素氮"], hints:["肾功能","生化"],
  exp:"受饮食蛋白量和脱水影响很大，波动比肌酐大。",
  min:3.6, max:9.5, t:"3.6 – 9.5", g:"q", forDis:["ckd"] },

{ k:"renal_egfr", n:"eGFR 估算肾小球滤过率", cat:"肾功能", spec:"serum",
  u:"mL/min", units:["mL/min","mL/min/1.73m²","ml/min"], vt:"numeric", trend:true,
  alias:["eGFR","EGFR","GFR","肾小球滤过率","估算肾小球滤过率"], hints:["肾功能","生化"],
  exp:"由肌酐加年龄性别算出来的，比肌酐本身更能代表真实肾功能。",
  min:90, t:"> 90", w:"60–89 属轻度下降；某些降糖药起始后先降 3–5 属正常现象",
  g:"q", forDis:["ckd","dm","htn","gout"] },

{ k:"renal_uric_acid", n:"尿酸", cat:"肾功能", spec:"serum",
  u:"μmol/L", units:["μmol/L","umol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["UA","URIC","Uric Acid","尿酸","血尿酸","血清尿酸"], hints:["肾功能","肾脏功能","生化"],
  exp:"痛风的直接原因。啤酒、海鲜、内脏后会明显升高。",
  min:155, max:428, t:"155 – 428", w:"男性上限约 428，女性约 357",
  g:"q", forDis:["gout","ckd","htn"] },

/* ===== 电解质 ===== */
{ k:"electrolyte_potassium", n:"血钾", cat:"电解质", spec:"serum",
  u:"mmol/L", units:["mmol/L","mEq/L"], vt:"numeric", trend:true,
  alias:["K","K+","钾","血钾","钾离子"], hints:["电解质","生化"],
  exp:"高了低了都影响心脏。某些降压药（普利、沙坦、沙库巴曲）会升钾，用这类药要盯紧。",
  min:3.5, max:5.5, t:"3.5 – 5.5", g:"q", forDis:["ckd","htn"] },

{ k:"electrolyte_sodium", n:"血钠", cat:"电解质", spec:"serum",
  u:"mmol/L", units:["mmol/L","mEq/L"], vt:"numeric", trend:true,
  alias:["Na","Na+","钠","血钠","钠离子"], hints:["电解质","生化"],
  exp:"反映体液平衡。",
  min:135, max:145, t:"135 – 145", g:"q", forDis:["ckd","htn"] },

{ k:"electrolyte_calcium", n:"血钙", cat:"电解质", spec:"serum",
  u:"mmol/L", units:["mmol/L","mg/dL"], vt:"numeric", trend:true,
  alias:["Ca","Ca2+","钙","血钙","钙离子","总钙"], hints:["电解质","生化"],
  exp:"受白蛋白影响 —— 白蛋白低的时候，实际有活性的钙可能比测出来的高。",
  min:2.11, max:2.52, t:"2.11 – 2.52", g:"q", forDis:["ckd"] },

{ k:"electrolyte_chloride", n:"血氯", cat:"电解质", spec:"serum",
  u:"mmol/L", units:["mmol/L","mEq/L"], vt:"numeric", trend:true,
  alias:["Cl","Cl-","氯","血氯","氯离子"], hints:["电解质","生化"],
  exp:"通常跟着血钠一起变化。",
  min:99, max:110, t:"99 – 110", g:"q", forDis:["ckd"] },

/* ===== 血常规 ===== */
{ k:"cbc_wbc", n:"白细胞计数", cat:"血常规", spec:"whole_blood",
  u:"10^9/L", units:["10^9/L","×10^9/L","10*9/L","10^3/μL"], vt:"numeric", trend:true,
  alias:["WBC","白细胞","白细胞数","白细胞计数","白血球"], hints:["血常规","全血细胞","五分类","三分类"],
  exp:"感染、炎症时升高。",
  min:3.5, max:9.5, t:"3.5 – 9.5", g:"n", forDis:["anemia"] },

{ k:"cbc_rbc", n:"红细胞计数", cat:"血常规", spec:"whole_blood",
  u:"10^12/L", units:["10^12/L","×10^12/L","10*12/L","10^6/μL"], vt:"numeric", trend:true,
  alias:["RBC","红细胞","红细胞数","红细胞计数"], hints:["血常规","全血细胞"],
  exp:"和血红蛋白一起看贫血。",
  min:3.8, max:5.8, t:"3.8 – 5.8", g:"n", forDis:["anemia"] },

{ k:"cbc_hgb", n:"血红蛋白", cat:"血常规", spec:"whole_blood",
  u:"g/L", units:["g/L","g/dL"], vt:"numeric", trend:true,
  alias:["HGB","Hb","HB","血红蛋白","血色素"], hints:["血常规","全血细胞"],
  exp:"判断贫血最直接的一项。",
  min:115, max:175, t:"115 – 175", w:"男性参考约 130–175，女性约 115–150",
  g:"n", forDis:["anemia","ckd"] },

{ k:"cbc_plt", n:"血小板计数", cat:"血常规", spec:"whole_blood",
  u:"10^9/L", units:["10^9/L","×10^9/L","10*9/L","10^3/μL"], vt:"numeric", trend:true,
  alias:["PLT","血小板","血小板数","血小板计数"], hints:["血常规","全血细胞"],
  exp:"太低容易出血，肝硬化时会下降。",
  min:125, max:350, t:"125 – 350", g:"n", forDis:["hbv","anemia"] },

{ k:"cbc_hct", n:"红细胞压积", cat:"血常规", spec:"whole_blood",
  u:"%", units:["%","L/L"], vt:"numeric", trend:true,
  alias:["HCT","Hct","红细胞压积","红细胞比容","血细胞比容"], hints:["血常规","全血细胞"],
  exp:"红细胞占血液体积的比例。脱水或某些降糖药（列净类）会让它升高。",
  min:35, max:50, t:"35 – 50", g:"n", forDis:["dm","anemia"] },

/* ===== 甲状腺功能 ===== */
{ k:"thyroid_tsh", n:"促甲状腺素 TSH", cat:"甲状腺功能", spec:"serum",
  u:"mIU/L", units:["mIU/L","μIU/mL","uIU/mL"], vt:"numeric", trend:true,
  alias:["TSH","促甲状腺激素","促甲状腺素"], hints:["甲功","甲状腺"],
  exp:"调节甲状腺的上游激素。甲减时它升高，甲亢或补药过量时它降低。",
  min:0.27, max:4.2, t:"0.27 – 4.2",
  w:"这是人群区间。甲状腺癌术后需要刻意压低（如 0.5–2.0 或更低），甲减替代也有各自目标，去「设置 → 个人目标」改",
  g:"h", forDis:["thyca","hypo"] },

{ k:"thyroid_ft3", n:"游离 T3", cat:"甲状腺功能", spec:"serum",
  u:"pmol/L", units:["pmol/L","pg/mL"], vt:"numeric", trend:true,
  alias:["FT3","游离T3","游离三碘甲状腺原氨酸"], hints:["甲功","甲状腺"],
  exp:"活性最强的甲状腺激素。",
  min:3.1, max:6.8, t:"3.1 – 6.8", g:"h", forDis:["thyca","hypo"] },

{ k:"thyroid_ft4", n:"游离 T4", cat:"甲状腺功能", spec:"serum",
  u:"pmol/L", units:["pmol/L","ng/dL"], vt:"numeric", trend:true,
  alias:["FT4","游离T4","游离甲状腺素"], hints:["甲功","甲状腺"],
  exp:"甲状腺激素的主要储备形式。",
  min:12, max:22, t:"12 – 22", g:"h", forDis:["thyca","hypo"] },

{ k:"thyroid_t3", n:"总 T3", cat:"甲状腺功能", spec:"serum",
  u:"nmol/L", units:["nmol/L","ng/mL","ng/dL"], vt:"numeric", trend:true,
  /* 注意别名里不能出现「游离三碘甲状腺原氨酸」，那是 FT3。
     两者单位差一个数量级（nmol/L vs pmol/L），认错会很离谱。 */
  alias:["T3","总T3","TT3","三碘甲状腺原氨酸","血清三碘甲状腺原氨酸"],
  hints:["甲功","甲状腺"],
  exp:"包含了和蛋白结合的部分，所以受蛋白水平影响；判断甲状腺功能主要还是看 FT3、FT4 和 TSH。",
  min:1.3, max:3.1, t:"1.3 – 3.1", g:"h", forDis:["thyca","hypo"] },

{ k:"thyroid_t4", n:"总 T4", cat:"甲状腺功能", spec:"serum",
  u:"nmol/L", units:["nmol/L","μg/dL","ug/dL"], vt:"numeric", trend:true,
  alias:["T4","总T4","TT4","甲状腺素","血清甲状腺素"], hints:["甲功","甲状腺"],
  exp:"同上，主要作参考。",
  min:66, max:181, t:"66 – 181", g:"h", forDis:["thyca","hypo"] },

{ k:"thyroid_tg", n:"甲状腺球蛋白 Tg", cat:"甲状腺功能", spec:"serum",
  u:"ng/mL", units:["ng/mL","μg/L","ug/L"], vt:"numeric", trend:true,
  /* 注意：裸写的 "Tg" 不放在这里 —— 它和甘油三酯的 "TG" 小写后完全相同，
     必须走下面的 AMBIG 表按单位和小节消歧，否则甲功单上的 Tg 会被记成血脂。 */
  alias:["甲状腺球蛋白","人甲状腺球蛋白","甲状腺球蛋白定量"], hints:["甲功","甲状腺","肿瘤标志"],
  exp:"只有甲状腺组织会产生它。甲状腺全切后它应该几乎测不出，升高提示复发。",
  max:77, t:"< 77",
  w:"77 是有甲状腺的人的上限。全切术后目标是低于 1.0，去「设置 → 个人目标」改",
  g:"h", forDis:["thyca"] },

{ k:"thyroid_tgab", n:"抗甲状腺球蛋白抗体 TgAb", cat:"甲状腺功能", spec:"serum",
  u:"IU/mL", units:["IU/mL","U/mL"], vt:"numeric", trend:true,
  alias:["TgAb","TGAB","抗Tg抗体","抗-Tg","甲状腺球蛋白抗体","抗甲状腺球蛋白抗体"],
  hints:["甲功","甲状腺","抗体"],
  exp:"它阳性会让甲状腺球蛋白 Tg 测出来假性偏低，所以两个必须一起查。",
  max:115, t:"< 115", g:"h", forDis:["thyca","hypo"] },

/* ===== 内分泌 ===== */
{ k:"endo_cpeptide", n:"空腹 C 肽", cat:"内分泌", spec:"serum",
  u:"ng/mL", units:["ng/mL","nmol/L","pmol/L"], vt:"numeric", trend:true,
  alias:["C-P","C肽","C-肽","空腹C肽","C-peptide"], hints:["胰岛","血糖","内分泌"],
  exp:"胰岛素分泌时按 1:1 一起放出来，但不受注射胰岛素干扰，所以更能代表自身胰岛功能。",
  min:0.8, max:4.0, t:"0.8 – 4.0", g:"y", forDis:["dm"] },

{ k:"endo_insulin", n:"空腹胰岛素", cat:"内分泌", spec:"serum",
  u:"μIU/mL", units:["μIU/mL","uIU/mL","mIU/L","pmol/L"], vt:"numeric", trend:true,
  alias:["INS","胰岛素","空腹胰岛素","Insulin"], hints:["胰岛","血糖","内分泌"],
  exp:"配合空腹血糖可以算胰岛素抵抗程度。",
  min:2.6, max:24.9, t:"2.6 – 24.9", g:"y", forDis:["dm"] },

{ k:"vit_d25", n:"25-羟维生素 D", cat:"内分泌", spec:"serum",
  u:"ng/mL", units:["ng/mL","nmol/L"], vt:"numeric", trend:true,
  alias:["25-羟维生素D","25羟维生素D","25-OH-VitD","25(OH)D","25-OH-VIT D",
         "25-羟基维生素D","维生素D"],
  hints:["内分泌","维生素","骨代谢"],
  exp:"反映体内维生素 D 储备。缺乏在国内很普遍，尤其是室内工作者和冬季。",
  min:30, t:"> 30", w:"30 以上为充足，20–30 为不足，20 以下为缺乏",
  g:"n", forDis:[] },

{ k:"enzyme_ck", n:"肌酸激酶 CK", cat:"肌酶", spec:"serum",
  u:"U/L", units:["U/L","IU/L"], vt:"numeric", trend:true,
  alias:["CK","CPK","肌酸激酶","肌酸磷酸激酶"], hints:["生化","心肌酶","肌酶"],
  exp:"他汀类降脂药若引起肌肉损伤，这一项会升高。",
  max:200, hard:1000, t:"< 200", w:"抽血前 48 小时别剧烈运动，否则假性升高",
  g:"h", forDis:["hlp","cad"] },

/* ===== 尿常规 ===== */
{ k:"urine_protein", n:"尿蛋白", cat:"尿常规", spec:"urine",
  u:"", units:["","+","阴性","阳性"], vt:"positive_negative", trend:false,
  alias:["PRO","尿蛋白","蛋白质","尿蛋白定性"], hints:["尿常规","尿液"],
  exp:"持续阳性提示肾脏滤过屏障受损。",
  sel:["阴性","±","1+","2+","3+"], ok:["阴性","±"], t:"应为阴性",
  g:"q", forDis:["ckd","dm","htn"] },

{ k:"urine_ketone", n:"尿酮", cat:"尿常规", spec:"urine",
  u:"", units:["","+","阴性","阳性"], vt:"positive_negative", trend:false,
  alias:["KET","尿酮","酮体","尿酮体"], hints:["尿常规","尿液"],
  exp:"饥饿、生酮饮食时也会阳性；但在用列净类降糖药时阳性要当回事。",
  sel:["阴性","±","1+","2+","3+"], ok:["阴性"], t:"应为阴性",
  w:"用 SGLT2 抑制剂（各种「列净」）时阳性要警惕正常血糖酮症酸中毒",
  g:"q", forDis:["dm"] },

{ k:"urine_acr", n:"尿微量白蛋白/肌酐比", cat:"尿常规", spec:"urine",
  u:"mg/g", units:["mg/g","mg/mmol"], vt:"numeric", trend:true,
  alias:["UACR","ACR","尿微量白蛋白肌酐比","微量白蛋白/肌酐","尿白蛋白肌酐比"],
  hints:["尿常规","尿液","肾功能"],
  exp:"比尿蛋白定性灵敏得多，是糖尿病和高血压伤肾最早的信号。",
  max:30, t:"< 30", g:"h", forDis:["ckd","dm","htn"] },

/* ===== 基础测量 ===== */
{ k:"body_weight", n:"体重", cat:"基础测量", spec:"other",
  u:"kg", units:["kg","千克","公斤","g","克"], vt:"numeric", trend:true,
  alias:["体重","身体重量","Weight","WT","BW"],
  hints:["一般检查","基础测量","体格检查","体检","人体成分"],
  exp:"", g:"n", forDis:["dm","fld","htn"] },

{ k:"body_height", n:"身高", cat:"基础测量", spec:"other",
  u:"cm", units:["cm","厘米","m","米","mm","毫米"], vt:"numeric", trend:true,
  alias:["身高","身体高度","Height","HT"],
  hints:["一般检查","基础测量","体格检查","体检","生长发育"],
  exp:"", g:"n", forDis:[] },

{ k:"body_bmi", n:"体重指数 BMI", cat:"基础测量", spec:"other",
  u:"kg/m²", units:["kg/m²","kg/m2","kg/㎡"], vt:"numeric", trend:true,
  alias:["BMI","体重指数","体重指数BMI","身体质量指数","身体质量指数BMI"],
  hints:["一般检查","基础测量","体格检查","体检"],
  exp:"体重除以身高的平方。",
  min:18.5, max:23.9, t:"18.5 – 23.9", w:"用的是中国标准（24 以上超重，28 以上肥胖），比国际标准严",
  g:"n", forDis:["dm","fld","htn"] },

{ k:"body_waist", n:"腰围", cat:"基础测量", spec:"other",
  u:"cm", units:["cm","厘米","m","米","mm","毫米"], vt:"numeric", trend:true,
  alias:["腰围","腰部周径","腰周","Waist","Waist Circumference","WC"],
  hints:["一般检查","基础测量","体格检查","体检","人体成分"],
  exp:"比 BMI 更能反映内脏脂肪。",
  max:90, t:"< 90", w:"男性低于 90，女性低于 85",
  g:"n", forDis:["dm","fld","htn"] },

{ k:"bp_systolic", n:"收缩压", cat:"基础测量", spec:"other",
  u:"mmHg", units:["mmHg","kPa"], vt:"numeric", trend:true,
  alias:["SBP","收缩压","高压","血压高压"], hints:["一般检查","血压","体格检查","体检"],
  exp:"心脏收缩把血打出去时的压力，也就是「高压」。",
  min:90, max:139, t:"< 140", g:"q", forDis:["htn","cad","ckd","dm"] },

{ k:"bp_diastolic", n:"舒张压", cat:"基础测量", spec:"other",
  u:"mmHg", units:["mmHg","kPa"], vt:"numeric", trend:true,
  alias:["DBP","舒张压","低压","血压低压"], hints:["一般检查","血压","体格检查","体检"],
  exp:"心脏舒张时血管里剩余的压力，也就是「低压」。",
  min:60, max:89, t:"< 90", g:"q", forDis:["htn","cad","ckd","dm"] },

/* ===== 影像与功能（选择型，可判读） ===== */
{ k:"us_carotid", n:"颈动脉超声", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["颈动脉超声","颈动脉彩超","颈部血管超声","颈动脉血管超声"],
  hints:["超声","血管","颈动脉"],
  exp:"最便宜、最直观的动脉粥样硬化窗口。",
  sel:["未报狭窄率","狭窄 < 50%","狭窄 50–69%","狭窄 ≥ 70%"],
  ok:["未报狭窄率","狭窄 < 50%"], t:"狭窄 < 50%",
  w:"50% 以上意味着 LDL 目标要收紧，并需要评估抗血小板治疗",
  g:"i", forDis:["cad","hlp","htn"] },

{ k:"us_thyroid_bed", n:"甲状腺床 + 颈部淋巴结超声", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["甲状腺超声","甲状腺彩超","甲状腺床超声","颈部淋巴结超声"],
  hints:["超声","甲状腺","颈部"],
  exp:"甲状腺癌术后随访的两大支柱之一（另一个是 Tg）。",
  sel:["正常","可疑","异常"], ok:["正常"], t:"正常",
  g:"i", forDis:["thyca"] },

{ k:"exam_fundus", n:"眼底检查", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["眼底","眼底检查","眼底照相","眼底镜"], hints:["眼科","眼底"],
  exp:"全身唯一能直接看到血管的地方，糖尿病和高血压伤血管在这里最早显形。",
  sel:["正常","轻度病变","需治疗"], ok:["正常"], t:"正常",
  g:"i", forDis:["dm","htn"] },

{ k:"exam_ecg", n:"心电图", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["心电图","ECG","EKG","十二导联心电图"], hints:["心电图","心电"],
  exp:"几分钟、几十块钱，主要筛房颤和陈旧性心梗。",
  sel:["正常","异常"], ok:["正常"], t:"正常",
  g:"i", forDis:["cad","htn"] },

{ k:"exam_neuropathy", n:"周围神经病变筛查", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["神经病变筛查","周围神经病变","糖尿病周围神经病变","尼龙丝试验","震动觉"],
  hints:["神经","糖尿病足","内分泌"],
  exp:"尼龙丝加音叉，门诊几分钟就能做完。",
  sel:["正常","异常"], ok:["正常"], t:"正常",
  g:"i", forDis:["dm"] },

{ k:"ct_chest", n:"胸部 CT", cat:"影像与功能", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["胸部CT","肺CT","胸部平扫","低剂量胸部CT","肺部CT"], hints:["CT","胸部","肺"],
  exp:"发现肺小结节后要按医生说的间隔复查，对比大小变化比单次大小更重要。",
  sel:["无结节","结节稳定","结节增大需处理"], ok:["无结节","结节稳定"], t:"结节稳定",
  g:"i", forDis:[] },

/* ===== 影像所见（文字型，给 AI 抽取一个稳定的键） ===== */
{ k:"finding_thyroid_nodule", n:"甲状腺结节", cat:"影像所见", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["甲状腺结节","左叶甲状腺结节","右叶甲状腺结节","甲状腺左叶结节","甲状腺右叶结节"],
  hints:["甲状腺","超声","超声成像检查","检查提示"],
  exp:"影像里的结构性所见。要结合分级（TI-RADS）、大小变化和医生建议看，单次描述说明不了什么。",
  g:"n", forDis:["thyca"] },

{ k:"finding_arterial_plaque", n:"动脉斑块", cat:"影像所见", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["动脉斑块","斑块形成","颈动脉斑块","锁骨下动脉斑块","右侧锁骨下动脉斑块形成","左侧锁骨下动脉斑块形成"],
  hints:["超声","血管","颈动脉","锁骨下动脉"],
  exp:"血管超声里的结构性所见。斑块一旦形成基本不会消失，治疗目标是让它稳定不长大。",
  g:"n", forDis:["cad","hlp"] },

{ k:"finding_fatty_liver", n:"脂肪肝", cat:"影像所见", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["脂肪肝","轻度脂肪肝","中度脂肪肝","重度脂肪肝","脂肪肝中度","肝脏脂肪浸润"],
  hints:["超声","肝胆","腹部"],
  exp:"超声对脂肪肝的分级比较粗，主要看趋势。减重是唯一确定有效的办法。",
  g:"n", forDis:["fld","dm"] },

{ k:"finding_liver_calcification", n:"肝钙化灶", cat:"影像所见", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["肝钙化灶","肝右叶局灶性钙化灶","肝左叶局灶性钙化灶","肝内钙化灶"],
  hints:["超声","肝胆","腹部"],
  exp:"陈旧性改变，绝大多数不需要处理，但要在报告里留个底以便下次对比。",
  g:"n", forDis:[] },

{ k:"finding_sinus_rhythm", n:"窦性心律", cat:"心电图", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["窦性心律","窦性心动过速","窦性心动过缓","窦性心律不齐"], hints:["心电图","心电"],
  exp:"「窦性心律」本身就是正常节律的意思。",
  g:"n", forDis:["cad","htn"] },

{ k:"finding_chronic_pharyngitis", n:"慢性咽炎", cat:"耳鼻喉检查", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["慢性咽炎"], hints:["耳鼻喉","咽喉"],
  exp:"", g:"n", forDis:[] },

{ k:"finding_cerumen_impaction", n:"外耳道耵聍堵塞", cat:"耳鼻喉检查", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["外耳道耵聍堵塞","右侧外耳道耵聍堵塞","左侧外耳道耵聍堵塞","耵聍堵塞"],
  hints:["耳鼻喉","外耳道"],
  exp:"", g:"n", forDis:[] },

/* ===== 妇科超声（保留：这个 app 不该假设使用者的性别） ===== */
{ k:"gyn_endometrium_thickness", n:"子宫内膜厚度", cat:"妇科超声", spec:"other",
  u:"mm", units:["mm","cm"], vt:"numeric", trend:true,
  alias:["内膜厚度","子宫内膜厚度","宫内膜厚度"],
  hints:["妇科","超声","检查所见","阴道超声","子宫附件"],
  exp:"必须结合月经周期看，同一个数字在不同时期意义完全不同。",
  g:"n", forDis:[] },

{ k:"gyn_endometrium_echo", n:"子宫内膜回声", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["内膜回声","子宫内膜回声"], hints:["妇科","超声","检查所见","子宫附件"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_ovarian_follicle", n:"卵巢卵泡", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["卵巢卵泡","右侧卵巢卵泡","左侧卵巢卵泡"], hints:["妇科","超声","检查所见","卵巢"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_ovary_size", n:"卵巢大小", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["卵巢大小","右侧卵巢大小","左侧卵巢大小"], hints:["妇科","超声","检查所见","卵巢"],
  exp:"含长宽高多个值，不合并成单一趋势。", g:"n", forDis:[] },

{ k:"gyn_uterus_position", n:"子宫位置", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["子宫位置"], hints:["妇科","超声","检查所见","子宫"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_uterus_size", n:"子宫大小", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["子宫大小"], hints:["妇科","超声","检查所见","子宫"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_uterine_cavity_mass", n:"宫腔内团块", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["宫腔内团块","宫腔内稍高回声团块"], hints:["妇科","超声","检查所见","子宫","宫腔"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_pelvic_effusion", n:"盆腔积液", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["盆腔积液"], hints:["妇科","超声","检查所见","盆腔"],
  exp:"", g:"n", forDis:[] },

{ k:"gyn_myometrium_echo", n:"肌层回声", cat:"妇科超声", spec:"other",
  u:"", units:[], vt:"text", trend:false,
  alias:["肌层回声","子宫肌层回声"], hints:["妇科","超声","检查所见","子宫"],
  exp:"", g:"n", forDis:[] },

/* ===== 感染筛查 ===== */
{ k:"infectious_hbv_dna", n:"乙肝病毒 DNA 定量", cat:"感染筛查", spec:"serum",
  u:"IU/mL", units:["IU/mL","copies/mL"], vt:"numeric", trend:true,
  alias:["HBV-DNA","HBVDNA","乙肝病毒DNA","乙型肝炎病毒DNA","乙型肝炎病毒核酸定量"],
  hints:["乙肝","乙型肝炎","病毒核酸","感染"],
  exp:"直接反映病毒复制活跃程度，是决定要不要抗病毒治疗的关键。",
  g:"n", forDis:["hbv"] },

{ k:"infectious_hbsag", n:"乙肝表面抗原 HBsAg", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["HBsAg","乙型肝炎表面抗原","乙肝表面抗原","乙型肝炎表面抗原定性","表面抗原"],
  hints:["乙肝","乙肝两对半","乙型肝炎"],
  exp:"阳性代表体内有乙肝病毒。",
  sel:["阴性","阳性"], ok:["阴性"], t:"阴性", g:"n", forDis:["hbv"] },

{ k:"infectious_hbsab", n:"乙肝表面抗体 HBsAb", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI","mIU/mL"], vt:"positive_negative", trend:false,
  alias:["HBsAb","抗-HBs","乙型肝炎表面抗体","乙肝表面抗体","表面抗体"],
  hints:["乙肝","乙肝两对半","乙型肝炎"],
  exp:"这一项反过来 —— 阳性是好事，代表有免疫力（打过疫苗或感染后康复）。",
  sel:["阴性","阳性"], ok:["阳性"], t:"阳性（有免疫力）", g:"n", forDis:["hbv"] },

{ k:"infectious_hbeag", n:"乙肝 e 抗原 HBeAg", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["HBeAg","乙型肝炎e抗原","乙肝e抗原","乙型肝炎e抗原定性","e抗原"],
  hints:["乙肝","乙肝两对半","乙型肝炎"],
  exp:"阳性通常代表病毒复制活跃、传染性强。",
  sel:["阴性","阳性"], ok:["阴性"], t:"阴性", g:"n", forDis:["hbv"] },

{ k:"infectious_hbeab", n:"乙肝 e 抗体 HBeAb", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["HBeAb","抗-HBe","乙型肝炎e抗体","乙肝e抗体","e抗体"],
  hints:["乙肝","乙肝两对半","乙型肝炎"],
  exp:"", g:"n", forDis:["hbv"] },

{ k:"infectious_hbcab", n:"乙肝核心抗体 HBcAb", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["HBcAb","抗-HBc","乙型肝炎核心抗体","乙肝核心抗体","核心抗体"],
  hints:["乙肝","乙肝两对半","乙型肝炎"],
  exp:"阳性代表曾经感染过，不一定还有病毒。", g:"n", forDis:["hbv"] },

{ k:"infectious_hiv_agab", n:"HIV 抗原抗体", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["HIV","HIV抗原抗体","人类免疫缺陷病毒抗原抗体","人类免疫缺陷病毒抗体"],
  hints:["感染","免疫缺陷","HIV"],
  exp:"筛查项目，初筛阳性必须做确证试验才算数。",
  sel:["阴性","阳性"], ok:["阴性"], t:"阴性", g:"n", forDis:[] },

{ k:"infectious_syphilis_antibody", n:"梅毒螺旋体抗体", cat:"感染筛查", spec:"serum",
  u:"", units:["","S/CO","COI"], vt:"positive_negative", trend:false,
  alias:["梅毒螺旋体抗体","TP抗体","TPPA","TP-Ab","梅毒抗体"],
  hints:["感染","梅毒","螺旋体"],
  exp:"", sel:["阴性","阳性"], ok:["阴性"], t:"阴性", g:"n", forDis:[] }

];

/* ---- 同名不同物 -----------------------------------------------------------
 * 有些缩写在不同科室指的是完全不同的东西。别名表是扁平的「先登记的赢」，
 * 处理不了这种情况 —— 而认错的后果是把甲状腺球蛋白记成甘油三酯，
 * 比认不出来严重得多。
 *
 * 规则：候选按 units（单位相符 +40）和 hints（小节相符 +30）打分；
 * 没有任何信号能区分时，matchIndicator 宁可返回 null 交给人工确认。
 * ------------------------------------------------------------------------ */
var AMBIG = {
  /* TG = 甘油三酯（生化单）/ Tg = 甲状腺球蛋白（甲功单）。单位差得很远，好区分。 */
  "tg": [
    { k:"lipid_tg",   units:["mmol/L","mg/dL"],      hints:["血脂","生化","脂类"] },
    { k:"thyroid_tg", units:["ng/mL","μg/L","ug/L"], hints:["甲功","甲状腺","肿瘤标志"] }
  ]
};

/* ---- 内置疾病 -------------------------------------------------------------
 * keyInd 是有序的 —— 它决定打印件里趋势表的行序，
 * 也决定「按疾病调取历史」时哪些项目算这个病的核心项目。
 * 没有 keyInd 的疾病，打印出来就是一堆流水账。                             */
var SEED_DIS = [
  { id:"dm",    name:"糖尿病",              short:"糖尿病", color:"warn",
    keyInd:["glucose_hba1c","glucose_fasting","endo_cpeptide","endo_insulin",
            "urine_acr","renal_egfr","lipid_ldl_c","body_bmi"],
    keywords:["糖尿病","血糖","糖化","胰岛","葡萄糖耐量","OGTT","糖耐量"],
    recTypes:["laboratory","checkup","outpatient"] },

  { id:"hlp",   name:"血脂异常",            short:"血脂",   color:"warn",
    keyInd:["lipid_ldl_c","lipid_apob","lipid_tc","lipid_tg","lipid_hdl_c",
            "lipid_lpa","enzyme_ck","liver_alt"],
    keywords:["血脂","高脂血症","胆固醇","甘油三酯","脂蛋白","他汀"],
    recTypes:["laboratory","checkup"] },

  { id:"htn",   name:"高血压",              short:"高血压", color:"warn",
    keyInd:["bp_systolic","bp_diastolic","electrolyte_potassium",
            "renal_creatinine","renal_egfr","urine_acr","exam_fundus"],
    keywords:["高血压","血压","动态血压","降压"],
    recTypes:["laboratory","checkup","outpatient","functional"] },

  { id:"thyca", name:"甲状腺癌术后",        short:"甲状腺", color:"bad",
    keyInd:["thyroid_tg","thyroid_tgab","thyroid_tsh","thyroid_ft4","thyroid_ft3",
            "us_thyroid_bed"],
    keywords:["甲状腺","乳头状癌","滤泡癌","颈部淋巴结","甲功","甲状腺球蛋白","碘131"],
    recTypes:["laboratory","imaging","pathology","outpatient"] },

  { id:"hypo",  name:"甲状腺功能减退",      short:"甲减",   color:"warn",
    keyInd:["thyroid_tsh","thyroid_ft4","thyroid_ft3","thyroid_tgab","lipid_tc"],
    keywords:["甲减","甲状腺功能减退","优甲乐","左甲状腺素","桥本"],
    recTypes:["laboratory","outpatient"] },

  { id:"cad",   name:"冠心病 · 动脉粥样硬化", short:"心血管", color:"bad",
    keyInd:["lipid_ldl_c","lipid_apob","lipid_lpa","us_carotid",
            "finding_arterial_plaque","exam_ecg","bp_systolic"],
    keywords:["冠心病","冠状动脉","斑块","狭窄","心肌","支架","搭桥","钙化积分",
              "CTA","动脉硬化","粥样硬化"],
    recTypes:["imaging","functional","laboratory","outpatient","inpatient"] },

  { id:"fld",   name:"脂肪肝",              short:"脂肪肝", color:"warn",
    keyInd:["finding_fatty_liver","liver_alt","liver_ast","liver_ggt",
            "lipid_tg","body_bmi","body_waist","glucose_fasting"],
    keywords:["脂肪肝","肝脏回声","肝功能","转氨酶"],
    recTypes:["imaging","laboratory","checkup"] },

  { id:"ckd",   name:"慢性肾病",            short:"肾",     color:"bad",
    keyInd:["renal_egfr","renal_creatinine","urine_acr","urine_protein",
            "renal_urea","electrolyte_potassium","cbc_hgb"],
    keywords:["肾","肌酐","蛋白尿","肾小球","慢性肾脏病","CKD","尿微量白蛋白"],
    recTypes:["laboratory","imaging","outpatient"] },

  { id:"gout",  name:"痛风 · 高尿酸",       short:"痛风",   color:"warn",
    keyInd:["renal_uric_acid","renal_creatinine","renal_egfr","lipid_tg"],
    keywords:["痛风","尿酸","高尿酸","关节","秋水仙碱","非布司他"],
    recTypes:["laboratory","outpatient","imaging"] },

  { id:"hbv",   name:"乙肝",                short:"乙肝",   color:"warn",
    keyInd:["infectious_hbv_dna","infectious_hbsag","infectious_hbeag",
            "liver_alt","liver_ast","liver_tbil","cbc_plt"],
    keywords:["乙肝","乙型肝炎","两对半","HBV","抗病毒","恩替卡韦","替诺福韦"],
    recTypes:["laboratory","imaging","outpatient"] },

  { id:"anemia",name:"贫血",                short:"贫血",   color:"warn",
    keyInd:["cbc_hgb","cbc_rbc","cbc_hct","cbc_plt","cbc_wbc"],
    keywords:["贫血","血红蛋白","缺铁","铁蛋白","叶酸","维生素B12"],
    recTypes:["laboratory","checkup"] }
];

/* ---- 报告类型 ----------------------------------------------------------
 * v 与飞牛的枚举保持一致，方便将来互导。
 * aiName 是给模型看的词（模型对 physical_exam 比对 checkup 更敏感），
 * 拿回来再用 TYPE_ALIAS 映射成 v。                                       */
var REPORT_TYPES = [
  { v:"checkup",     n:"体检",     aiName:"physical_exam", bodyFallback:"综合体检" },
  { v:"laboratory",  n:"检验",     aiName:"laboratory",    bodyFallback:"" },
  { v:"imaging",     n:"影像",     aiName:"imaging",       bodyFallback:"" },
  { v:"functional",  n:"功能检查", aiName:"functional",    bodyFallback:"" },
  { v:"pathology",   n:"病理",     aiName:"pathology",     bodyFallback:"" },
  { v:"outpatient",  n:"门诊",     aiName:"outpatient",    bodyFallback:"" },
  { v:"inpatient",   n:"住院",     aiName:"inpatient",     bodyFallback:"" },
  { v:"prescription",n:"处方",     aiName:"prescription",  bodyFallback:"用药" },
  { v:"billing",     n:"票据",     aiName:"receipt",       bodyFallback:"费用" },
  { v:"vaccination", n:"疫苗",     aiName:"vaccine",       bodyFallback:"" },
  { v:"other",       n:"其他",     aiName:"other",         bodyFallback:"" }
];

/* 模型可能吐出的写法 → 我们的 v */
var TYPE_ALIAS = {
  physical_exam:"checkup", checkup:"checkup", "体检":"checkup",
  laboratory:"laboratory", lab:"laboratory", "检验":"laboratory",
  imaging:"imaging", "影像":"imaging",
  functional:"functional", "功能检查":"functional",
  pathology:"pathology", "病理":"pathology",
  outpatient:"outpatient", "门诊":"outpatient",
  inpatient:"inpatient", "住院":"inpatient",
  prescription:"prescription", "处方":"prescription",
  receipt:"billing", billing:"billing", "票据":"billing",
  vaccine:"vaccination", vaccination:"vaccination", "疫苗":"vaccination",
  other:"other", "其他":"other"
};

/* 泛标题黑名单：命中就说明这个标题没信息量，要按类型加部位重新生成。
 * 一个全是「检验报告单」的时间轴等于没有时间轴。 */
var GENERIC_TITLES = [
  "检验报告单","检验报告","检查报告单","检查报告","体检报告","体检报告单",
  "健康体检报告","门诊病历","门诊记录","病历","报告单","报告","化验单",
  "检验结果","检查结果","医学影像报告","影像报告","超声报告","超声检查报告",
  "彩超报告","放射科报告","病理报告","诊断报告","检验单","检查单"
];

/* ---- 单位归一化表（照搬飞牛，NFKC + 小写之后再查） ---- */
var UNIT_ALIAS = {
  "mmol/l":"mmol/L", "umol/l":"μmol/L", "μmol/l":"μmol/L",
  "nmol/l":"nmol/L", "pmol/l":"pmol/L", "mol/l":"mol/L",
  "mg/dl":"mg/dL", "g/dl":"g/dL", "ng/dl":"ng/dL", "μg/dl":"μg/dL", "ug/dl":"μg/dL",
  "g/l":"g/L", "mg/l":"mg/L", "μg/l":"μg/L", "ug/l":"μg/L", "ng/l":"ng/L",
  "ng/ml":"ng/mL", "μg/ml":"μg/mL", "ug/ml":"μg/mL", "mg/ml":"mg/mL",
  "iu/l":"U/L", "u/l":"U/L", "iu/ml":"IU/mL", "miu/l":"mIU/L", "miu/ml":"mIU/mL",
  "uiu/ml":"μIU/mL", "μiu/ml":"μIU/mL",
  "meq/l":"mEq/L", "mosm/kg":"mOsm/kg",
  "kg/m2":"kg/m²", "kg/㎡":"kg/m²", "kg/m^2":"kg/m²",
  "10*9/l":"10^9/L", "10^9/l":"10^9/L", "×10^9/l":"10^9/L", "10e9/l":"10^9/L",
  "10*12/l":"10^12/L", "10^12/l":"10^12/L", "×10^12/l":"10^12/L",
  "10^3/ul":"10^3/μL", "10^6/ul":"10^6/μL",
  "千克":"kg", "公斤":"kg", "克":"g", "厘米":"cm", "毫米":"mm", "米":"m",
  "mmhg":"mmHg", "kpa":"kPa", "s/co":"S/CO", "coi":"COI",
  "copies/ml":"copies/mL", "ml/min":"mL/min", "ml/min/1.73m2":"mL/min/1.73m²"
};

/* ---- 单位换算：{canonicalKey: {原单位: {to:目标单位, f:乘数}}}
 * 归一值 = 原始值 * f                                                   */
var UNIT_CONV = {
  lipid_tc:       { "mg/dL":{ to:"mmol/L", f:1/38.67 } },
  lipid_hdl_c:    { "mg/dL":{ to:"mmol/L", f:1/38.67 } },
  lipid_ldl_c:    { "mg/dL":{ to:"mmol/L", f:1/38.67 } },
  lipid_tg:       { "mg/dL":{ to:"mmol/L", f:1/88.57 } },
  glucose_fasting:{ "mg/dL":{ to:"mmol/L", f:1/18.018 } },
  cbc_hgb:        { "g/dL":{ to:"g/L", f:10 } },
  body_weight:    { "g":{ to:"kg", f:1/1000 } },
  body_height:    { "m":{ to:"cm", f:100 }, "mm":{ to:"cm", f:1/10 } },
  body_waist:     { "m":{ to:"cm", f:100 }, "mm":{ to:"cm", f:1/10 } },
  gyn_endometrium_thickness: { "cm":{ to:"mm", f:10 } },
  bp_systolic:    { "kPa":{ to:"mmHg", f:7.5006 } },
  bp_diastolic:   { "kPa":{ to:"mmHg", f:7.5006 } }
};

/* Node 测试用；浏览器里 module 未定义，这段会被跳过 */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { DICT_VERSION, IND, GRP, GS, CATS, SEED_DIS, AMBIG,
                     REPORT_TYPES, TYPE_ALIAS, GENERIC_TITLES, UNIT_ALIAS, UNIT_CONV };
}
