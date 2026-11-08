/* app.js — 回送員シフト表ツール（Muse版）の画面・操作ロジック
* 計算は solver.js（ShiftSolver）に任せる。データは localStorage に端末内保存。
* 登録・配布・送信などサーバーが要る機能は端末内の疑似動作。
* 実在の個人情報はコードにも初期データにも入れていない（初期値は架空メンバー）。
*/
"use strict";
const S = window.ShiftSolver;
const LS_KEY = "museShiftAppV1";
const PREFIX = "MUSE1:"; // Muse版データ文字列の接頭辞（自前設計）
const WD = ["日", "月", "火", "水", "木", "金", "土"]; // getDay() 順
const WD_PY = ["月", "火", "水", "木", "金", "土", "日"];

/* ---------------- 初期データ（架空メンバーのみ） ---------------- */
function defaultPerson() {
return { "毎週どれか休み": [], "連休の日": null, "土日祝休": null, "月末月初": null,
"連勤数": "3連勤まで", "連休回数": "月1、2回", "飛び石なし": true};
}
function seedState() {
const dummyMembers = [
["100001", "回送員A", "東西"], ["100002", "回送員B", "東西"], ["100003", "回送員C", "東西"],
["100004", "回送員D", "東西"], ["100005", "回送員E", "ジャパン"], ["100006", "回送員F", "東西"],
["100007", "回送員G", "グローバル"], ["100008", "回送員H", "東西"], ["100009", "回送員I", "東西"],
["100010", "回送員J", "東西"], ["100011", "回送員K", "エクスプレス"], ["100012", "回送員L", "東西"],
["100013", "回送員M", "エクスプレス"], ["100014", "回送員N", "ジャパン"]
].map(a => ({ id: a[0], name: a[1], org: a[2]}));
const per = {};
dummyMembers.forEach(m => { per[m.id] = defaultPerson();});
// 架空メンバーの個人条件（検証用ダミー条件と同じ組み立て：A=毎週火・水＋平日連休、B=土日祝休2〜4日、C=土日連休）
per["100001"]["毎週どれか休み"] = ["火", "水"]; per["100001"]["連休の日"] = "平日";
per["100002"]["土日祝休"] = "2日〜4日";
per["100003"]["連休の日"] = "土日";
const decRequests = {
"100001": { kibou: [9, 23], yukyu: [16]}, "100002": { kibou: [8], yukyu: [21]},
"100003": { kibou: [6], yukyu: [14]}, "100004": { kibou: [9, 21], yukyu: [17]},
"100005": { kibou: [10], yukyu: [18]}, "100006": { kibou: [13], yukyu: [20]},
"100007": { kibou: [7], yukyu: [15, 23]}, "100008": { kibou: [11], yukyu: [19]},
"100009": { kibou: [6], yukyu: [22]}, "100010": { kibou: [10], yukyu: [18]},
"100011": { kibou: [15], yukyu: [20]}, "100012": { kibou: [12], yukyu: [21]},
"100013": { kibou: [9], yukyu: [17]}, "100014": { kibou: [7], yukyu: [19]}
};
const prevOffs = { "100001": 0, "100002": 1, "100003": 0, "100004": 0, "100005": 1, "100006": 1, "100007": 0, "100008": 1, "100009": 1, "100010": 0, "100011": 1, "100012": 1, "100013": 1, "100014": 1};
const prevStreak = { "100001": 0, "100002": 0, "100003": 2, "100004": 3, "100005": 0, "100006": 0, "100007": 2, "100008": 0, "100009": 0, "100010": 3, "100011": 0, "100012": 0, "100013": 0, "100014": 1};
return {
baseName: "八王子",
bases: ["八王子", "東村山", "瑞穂"],
orgOrder: ["東西", "グローバル", "エクスプレス", "ジャパン"],
members: dummyMembers,
common: { "最大連勤": 3, "連休回数": "月1〜2回", "飛び石なし": true},
perPerson: per,
priority: { minWork: 10, maxNormal: 11, busyMin: 11, busyMax: 12},
priorityCustom: {}, // 既定値から変えた項目名（赤字表示用）
longHolidays: [
{ name: "GW", from: "", to: "", work: ""},
{ name: "お盆休み", from: "", to: "", work: ""},
{ name: "年末年始", from: "2026-12-27", to: "2027-01-04", work: ""}
],
texts2: {
t1: "※毎日お疲れ様です。希望休は3日まで、19日締め切りです。",
t2: "休みたい日に「×」を書いてください。有休の場合は「有」を記入してください。",
t3: "※このシフト表に「有」だけ書いても有給にはなりません！スマホの勤怠アプリで有給申請→受理をもらって有給扱いとなります"
},
texts2Default: null, // 「デフォルトに設定」で保存した文言
months: {
"2026-12": {
cells: buildCellsFromRequests(decRequests), // {memberId: {day: "休"|"希"|"有"}}
prevCells: {}, // {memberId: {colIdx0-6: mark}}
prevOffsOverride: prevOffs, prevStreakOverride: prevStreak,
holidays: [], zentai: [27, 28, 29, 30, 31], busy: [1], quiet: [24], dayRequired: {}
}
},
shifts: {}, // {ym: {plans:{A,B}, manual:{schedule}, view:"A"|"B"|"manual", cur:{schedule}, adopted:{schedule,kind,adoptedAt,updatedAt}}}
users: [{ email: "（開発者）", role: "開発者", protected: true}], // 疑似：実際のメールは入れない
defaults: {}, // {baseName: {str, savedAt, memberCount, prev:{...}|null}}
defaultAppliedAt: "",
inbox: [], // 疑似：管理者へのデータ・要望の受信箱（端末内）
feedback: [], // 要望メモ（端末内）
autoMode: false,
paper: { size: "A4", orient: "landscape"},
ui: { tab: 1, month: "2026-12", planTab: "A", editPast: null, guideStep: 0}
};
}
function buildCellsFromRequests(req) {
const cells = {};
Object.entries(req || {}).forEach(([mid, r]) => {
cells[mid] = {};
(r.kibou || []).forEach(d => { cells[mid][d] = "希";});
(r.yukyu || []).forEach(d => { cells[mid][d] = "有";});
});
return cells;
}

/* ---------------- 状態の読み書き ---------------- */
let state;
try {
const raw = localStorage.getItem(LS_KEY);
state = raw? JSON.parse(raw): seedState();
if (!state ||!state.members) state = seedState();
} catch (e) { state = seedState();}
function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state));} catch (e) {}}
function toast(msg) {
const t = document.getElementById("toast");
t.textContent = msg; t.style.display = "block";
setTimeout(() => { t.style.display = "none";}, 2600);
}
function esc(s) { return String(s == null? "": s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));}

/* ---------------- 暦・並び順などの共通処理 ---------------- */
function ymParts(ym) { const p = ym.split("-"); return [parseInt(p[0], 10), parseInt(p[1], 10)];}
function ymLabel(ym) { const [y, m] = ymParts(ym); return y + "年 " + m + "月";}
function daysIn(ym) { const [y, m] = ymParts(ym); return new Date(y, m, 0).getDate();}
function dateOf(ym, d) { const [y, m] = ymParts(ym); return new Date(y, m - 1, d);}
function prevYm(ym) { let [y, m] = ymParts(ym); m--; if (m < 1) { m = 12; y--;} return y + "-" + String(m).padStart(2, "0");}
function monthOptions(sel) {
const set = new Set(["2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
Object.keys(state.months).forEach(k => set.add(k));
Object.keys(state.shifts).forEach(k => set.add(k));
return [...set].sort().map(ym => `<option value="${ym}" ${ym === sel? "selected": ""}>${ymLabel(ym)}</option>`).join("");
}
const ORG_CANON = { "ｸﾞﾛｰﾊﾞﾙ": "グローバル", "ｴｸｽﾌﾟﾚｽ": "エクスプレス", "ｼﾞｬﾊﾟﾝ": "ジャパン"};
function orgCanon(o) { return ORG_CANON[o] || o;}
function sortedMembers() {
const rank = o => { const i = state.orgOrder.indexOf(orgCanon(o)); return i < 0? 99: i;};
return state.members.slice().sort((a, b) => (rank(a.org) - rank(b.org)) || (a.id < b.id? -1: 1));
}
function personOf(id) {
if (!state.perPerson[id]) state.perPerson[id] = defaultPerson();
return state.perPerson[id];
}
function monthData(ym) {
if (!state.months[ym]) state.months[ym] = { cells: {}, prevCells: {}, prevOffsOverride: null, prevStreakOverride: null, holidays: [], zentai: [], busy: [], quiet: [], dayRequired: {}};
return state.months[ym];
}
/* 長い休みから、その月の全体休（間の出勤日を除く）を求める */
function longHolidayDays(ym) {
const D = daysIn(ym), out = new Set();
state.longHolidays.forEach(h => {
if (!h.from ||!h.to) return;
const work = new Set((h.work || "").split(/[,、\s]+/).filter(Boolean));
let cur = new Date(h.from + "T00:00:00"), end = new Date(h.to + "T00:00:00");
for (let d = new Date(cur); d <= end; d.setDate(d.getDate() + 1)) {
const key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
if (key.slice(0, 7) === ym &&!work.has(key) &&!work.has(String(d.getDate()))) out.add(d.getDate());
}
});
return out;
}
function zentaiSet(ym) {
const md = monthData(ym), s = new Set(md.zentai || []);
longHolidayDays(ym).forEach(d => s.add(d));
return s;
}
function holidaySet(ym) { return new Set(monthData(ym).holidays || []);}
function isWeekendKind(ym, d) {
const dt = dateOf(ym, d);
return dt.getDay() === 0 || dt.getDay() === 6 || holidaySet(ym).has(d);
}
/* 前月末7列の日付（当月1日の直前7日間） */
function prevCols(ym) {
const first = dateOf(ym, 1), out = [];
for (let i = 7; i >= 1; i--) { const d = new Date(first); d.setDate(d.getDate() - i); out.push(d);}
return out;
}
/* 前月の採用表があれば前月末グリッドを自動で埋める */
function autoPrevCells(ym) {
const md = monthData(ym);
if (Object.keys(md.prevCells || {}).length) return md.prevCells;
const pym = prevYm(ym), prev = state.shifts[pym] && state.shifts[pym].adopted;
if (!prev) return {};
const cols = prevCols(ym), out = {};
state.members.forEach(mem => {
const row = {}, sch = prev.schedule[mem.id] || {};
cols.forEach((dt, i) => {
if ((dt.getMonth() + 1) === parseInt(pym.split("-")[1], 10)) {
const mk = sch[dt.getDate()];
if (mk) row[i] = mk === "全"? "休": mk;
}
});
if (Object.keys(row).length) out[mem.id] = row;
});
return out;
}
/* solver入力の prev 系を組み立てる（グリッド入力があればそちら優先） */
function prevParams(ym) {
const md = monthData(ym);
const grid = Object.keys(md.prevCells || {}).length? md.prevCells: autoPrevCells(ym);
const cols = prevCols(ym);
const first = dateOf(ym, 1);
const sunday = new Date(first); sunday.setDate(sunday.getDate() - ((first.getDay() + 7) % 7));
const offs = {}, streak = {};
state.members.forEach(mem => {
const row = grid[mem.id];
const has = row && Object.keys(row).length > 0;
if (has) {
let n = 0;
cols.forEach((dt, i) => { if (dt >= sunday && dt < first && row[i]) n++;});
offs[mem.id] = n;
let run = 0;
for (let i = 6; i >= 0; i--) { if (row[i]) break; run++;}
streak[mem.id] = run >= 7? 3: run; // 7列全部出勤なら連勤は上限超え扱いにせず3で近似（要確認の注記対象）
} else if (md.prevOffsOverride && md.prevOffsOverride[mem.id]!= null) {
offs[mem.id] = md.prevOffsOverride[mem.id];
streak[mem.id] = (md.prevStreakOverride || {})[mem.id] || 0;
}
});
return { offs, streak};
}
/* solver 用の入力・条件を組み立てる */
function buildSolverInput(ym) {
const md = monthData(ym), members = sortedMembers();
const requests = {}, fixedOff = {};
members.forEach(mem => {
const c = (md.cells || {})[mem.id] || {};
requests[mem.id] = { kibou: [], yukyu: []}; fixedOff[mem.id] = [];
Object.entries(c).forEach(([d, mk]) => {
if (mk === "希") requests[mem.id].kibou.push(+d);
else if (mk === "有") requests[mem.id].yukyu.push(+d);
else if (mk === "休") fixedOff[mem.id].push(+d);
});
});
const pp = prevParams(ym);
const input = {
year_month: ym, requests, fixed_off: fixedOff,
zentai_kyu: [...zentaiSet(ym)], busy_days: md.busy || [], quiet_days: md.quiet || [],
holidays: md.holidays || [], day_required: md.dayRequired || {},
prev_month_last_week_offs: pp.offs, prev_month_work_streak: pp.streak,
display_order: members.map(m => m.id)
};
const per = {};
members.forEach(mem => {
const p = personOf(mem.id);
per[mem.id] = { "毎週どれか休み": p["毎週どれか休み"] || [], "連休の日": p["連休の日"], "土日祝休": p["土日祝休"], "月末月初": p["月末月初"], "連勤数": p["連勤数"], "連休回数": p["連休回数"]};
});
const allTobi = members.every(m => personOf(m.id)["飛び石なし"]!== false);
const cond = { common: { "最大連勤": state.common["最大連勤"], "連休回数": state.common["連休回数"], "飛び石なし": state.common["飛び石なし"] && allTobi}, per_person: per};
const opts = { minWork: state.priority.minWork, maxNormal: state.priority.maxNormal, busyMin: state.priority.busyMin, busyMax: state.priority.busyMax, iterations: 40, annealIters: 80000, seed: 20261108};
return { membersData: { members}, input, cond, opts};
}
/* 所属の印刷表示用：全角カタカナ→半角カナ（実物の印刷が半角表示のため） */
const DAKU_MAP = { "ガ": "ｶﾞ", "ギ": "ｷﾞ", "グ": "ｸﾞ", "ゲ": "ｹﾞ", "ゴ": "ｺﾞ", "ザ": "ｻﾞ", "ジ": "ｼﾞ", "ズ": "ｽﾞ", "ゼ": "ｾﾞ", "ゾ": "ｿﾞ", "ダ": "ﾀﾞ", "ヂ": "ﾁﾞ", "ヅ": "ﾂﾞ", "デ": "ﾃﾞ", "ド": "ﾄﾞ", "バ": "ﾊﾞ", "ビ": "ﾋﾞ", "ブ": "ﾌﾞ", "ベ": "ﾍﾞ", "ボ": "ﾎﾞ", "パ": "ﾊﾟ", "ピ": "ﾋﾟ", "プ": "ﾌﾟ", "ペ": "ﾍﾟ", "ポ": "ﾎﾟ", "ヴ": "ｳﾞ" };
const KANA1_MAP = { "ァ": "ｧ", "ア": "ｱ", "ィ": "ｨ", "イ": "ｲ", "ゥ": "ｩ", "ウ": "ｳ", "ェ": "ｪ", "エ": "ｴ", "ォ": "ｫ", "オ": "ｵ", "カ": "ｶ", "キ": "ｷ", "ク": "ｸ", "ケ": "ｹ", "コ": "ｺ", "サ": "ｻ", "シ": "ｼ", "ス": "ｽ", "セ": "ｾ", "ソ": "ｿ", "タ": "ﾀ", "チ": "ﾁ", "ッ": "ｯ", "ツ": "ﾂ", "テ": "ﾃ", "ト": "ﾄ", "ナ": "ﾅ", "ニ": "ﾆ", "ヌ": "ﾇ", "ネ": "ﾈ", "ノ": "ﾉ", "ハ": "ﾊ", "ヒ": "ﾋ", "フ": "ﾌ", "ヘ": "ﾍ", "ホ": "ﾎ", "マ": "ﾏ", "ミ": "ﾐ", "ム": "ﾑ", "メ": "ﾒ", "モ": "ﾓ", "ャ": "ｬ", "ヤ": "ﾔ", "ュ": "ｭ", "ユ": "ﾕ", "ョ": "ｮ", "ヨ": "ﾖ", "ラ": "ﾗ", "リ": "ﾘ", "ル": "ﾙ", "レ": "ﾚ", "ロ": "ﾛ", "ワ": "ﾜ", "ヲ": "ｦ", "ン": "ﾝ", "ー": "ｰ" };
function toHalfKana(s) { return String(s).split("").map(c => DAKU_MAP[c] || KANA1_MAP[c] || c).join(""); }
function dailyWorkOf(schedule, ym) {
const D = daysIn(ym), out = {};
for (let d = 1; d <= D; d++) out[d] = state.members.filter(m =>!(schedule[m.id] || {})[d]).length;
return out;
}
function verifySchedule(schedule, ym) {
const { membersData, input, cond} = buildSolverInput(ym);
// 飛び石はまず警告扱いで数え、件数を別に出す
const v = S.verifyShift(membersData, input, cond, schedule, true);
return v;
}

/* ---------------- 用紙選択・印刷 ---------------- */
function paperControls(idSuffix) {
const p = state.paper;
const sizes = ["B5", "A4", "B4"].map(s => `<option ${p.size === s? "selected": ""}>${s}</option>`).join("");
const oris = [["landscape", "横"], ["portrait", "縦"]].map(o => `<option value="${o[0]}" ${p.orient === o[0]? "selected": ""}>${o[1]}</option>`).join("");
return `<label>用紙 <select id="paperSize${idSuffix}" onchange="App.paperChange()">${sizes}</select></label>
<label>向き <select id="paperOri${idSuffix}" onchange="App.paperChange()">${oris}</select></label>
<span class="sub">プリンターの画面で、選んだ用紙・向きに合わせて「プリント」を押してください。</span>`;
}
function sheetHTML(kind, ym, schedule) {
// kind: "shift" | "kibou" | "blank"
const members = sortedMembers(), D = daysIn(ym), zen = zentaiSet(ym);
const [y, m] = ymParts(ym);
let head = "", rows = "";
for (let d = 1; d <= D; d++) {
const dt = dateOf(ym, d), hol = holidaySet(ym).has(d);
const wdTxt = hol? "祝": WD[dt.getDay()];
const cls = (dt.getDay() === 0 || hol)? "sun": "";
const sep = dt.getDay() === 6? " weeksep": "";
head += `<th class="${cls}${sep}"><span class="dn">${d}</span><br><span class="dw">${wdTxt}</span></th>`;
}
members.forEach(mem => {
const sch = schedule? (schedule[mem.id] || {}): {};
let cells = "", offN = 0;
for (let d = 1; d <= D; d++) {
const dt = dateOf(ym, d), sep = dt.getDay() === 6? " weeksep": "";
let mk = "", cls = "";
if (kind === "kibou" || kind === "blank") { if (zen.has(d)) { mk = "全"; cls = "m-zen";}}
else { mk = sch[d] || ""; cls = mk? ("m-" + ({ "公": "ko", "希": "ki", "有": "yu", "全": "zen"}[mk])): ""; if (mk) offN++;}
let inner = "";
if (mk === "有") inner = `<span class="yuc">有</span>`;
else if (mk) inner = `<span class="chipm ${cls}">${esc(mk)}</span>`;
cells += `<td class="${sep.trim()}">${inner}</td>`;
}
const tail = kind === "shift"? `<td class="cnt">${offN}</td><td class="cnt">${D - offN}</td>`: "";
rows += `<tr><td class="pid">${esc(mem.id)}</td><td class="porg">${esc(toHalfKana(mem.org))}</td><td class="pname">${esc(mem.name)}</td>${cells}${tail}</tr>`;
});
let foot = "";
if (kind === "shift" && schedule) {
const dw = dailyWorkOf(schedule, ym);
foot = `<tr><td colspan="3" style="text-align:right;padding-right:6px">出勤人数合計</td>` +
Array.from({ length: D}, (_, i) => { const dt2 = dateOf(ym, i + 1); return `<td class="${dt2.getDay() === 6? "weeksep": ""}">${dw[i + 1]}</td>`;}).join("") + `<td></td><td></td></tr>`;
}
const title = kind === "kibou"? `${y}年 ${m}月 希望休`: kind === "blank"? `${y}年 ${m}月（白紙）`: `${y}年 ${m}月`;
const tailHead = kind === "shift"? `<th>休日<br>日数</th><th>出勤<br>日数</th>`: "";
let top = "", bottom = "";
if (kind === "kibou") {
top = `<div class="txt-red">${esc(state.texts2.t1)}</div>`;
bottom = `<div class="txt-flex"><div class="txt-black">${esc(state.texts2.t2)}</div><div class="txt-red">${esc(state.texts2.t3)}</div></div>
<div class="legend">見本： <span class="chipm m-zen">全</span> 全体休 ／ 休みたい日は「×」、有休は「有」と書いてください。</div>`;
} else if (kind === "shift") {
bottom = `<div class="legend">見本： <span class="chipm m-ko">公</span> 休み　<span class="chipm m-ki">希</span> 希望休　<span class="yuc">有</span> 有給　<span class="chipm m-zen">全</span> 全体休</div>`;
}
const colgroup = `<colgroup><col style="width:3.8%"><col style="width:4%"><col style="width:6.9%">${kind === "shift"? `<col span="${D}"><col style="width:3.9%"><col style="width:3.8%">`: `<col span="${D}">`}</colgroup>`;
return `<div class="phead"><h2>${title}</h2><div class="pright"><span class="sticker"><span class="stk-r"></span><span class="stk-t">いすゞ首都圏</span></span><div class="pbase">${esc(state.baseName)}</div></div></div>
<div class="psub">赤い点線＝週の区切り（日曜〜土曜）</div>${top}
<table>${colgroup}<thead><tr><th>社員<br>番号</th><th>所属</th><th>名前</th>${head}${tailHead}</tr></thead>
<tbody>${rows}</tbody><tfoot>${foot}</tfoot></table>${bottom}`;
}
function printDocHTML(kind, ym, schedule) {
const p = state.paper;
let css = `
@page{size:${p.size} ${p.orient};margin:6mm 10.6mm 8mm}
html,body{margin:0}
body{font-family:"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;color:#222;padding-top:1mm;box-sizing:border-box}
.toolbar{margin-bottom:6px}
@media print{.toolbar{display:none}}
h2{margin:0;font-size:19.5pt;font-weight:800}
.phead{display:flex;justify-content:space-between;align-items:flex-start}
.pright{text-align:right}
/* ステッカー実測：全体 74.7×12.7pt、赤四角 #E8211A 14.7pt幅＋黒帯 */
.sticker{display:inline-flex;align-items:stretch;overflow:hidden;height:12.7pt}
.sticker .stk-r{width:14.7pt;background:#E8211A}
.sticker .stk-t{background:#101013;color:#fff;font-weight:800;font-size:9.5pt;letter-spacing:.06em;padding:0 5pt;line-height:12.7pt;white-space:nowrap}
.pbase{font-weight:800;font-size:14pt;margin-top:2pt}
.psub{font-size:9pt;color:#555;margin:2pt 0 5pt}
/* 表の実測（A4横）：x=29.9〜811.8、上端79.9、見出し2段各22pt、メンバー行29pt、下端529.8 */
table{width:100%;border-collapse:collapse;table-layout:fixed;border:1.2pt solid #222}
th,td{border:0.5pt solid #222;text-align:center;padding:0}
thead th{height:44pt;line-height:22pt;font-size:10pt;background:#f0f0f0;font-weight:400}
.dn{font-size:13pt;font-weight:700}
.dw{font-size:12pt}
thead th.sun .dw{color:#D22634}
tbody td{height:29pt;font-size:10pt}
tfoot td{border:none;height:15pt;font-size:12pt}
tfoot td.weeksep{border-right:2pt dotted #D22634}
td.pname{text-align:left;padding-left:4pt;white-space:nowrap;overflow:hidden;font-weight:800;font-size:13.5pt}
td.porg{font-size:8.5pt;white-space:nowrap}
td.pid{font-size:8pt;white-space:nowrap}
td.cnt{font-size:12.5pt}
/* 印はセル中央の小チップ 14.9×18.8pt（実測） */
.chipm{display:inline-block;width:14.9pt;height:18.8pt;line-height:18.8pt;font-weight:700;font-size:10.5pt;text-align:center;box-sizing:border-box;vertical-align:middle}
.m-ko{background:#F7CFD7;color:#D22634}
.m-ki{background:#F7CFD7;color:#D22634;border:1.2pt solid #D22634}
.m-zen{background:#D9D9DB;color:#222}
.yuc{display:inline-block;width:15.5pt;height:15.5pt;line-height:15.5pt;border:1.1pt solid #D22634;border-radius:50%;font-weight:700;font-size:10.5pt;background:transparent;color:#D22634;text-align:center;box-sizing:border-box;vertical-align:middle}
.weeksep{border-right:2pt dotted #D22634!important}
.txt-red{border:2pt solid #D22634;color:#D22634;border-radius:6pt;padding:6pt 8pt;font-weight:700;margin:6pt 0}
.txt-black{border:2pt solid #222;border-radius:6pt;padding:6pt 8pt}
.txt-flex{display:flex;gap:8pt}.txt-flex>div{flex:1}
.legend{font-size:9pt;margin-top:5pt}
.legend .chipm{width:13pt;height:15pt;line-height:15pt;font-size:9pt}
.legend .yuc{width:13pt;height:13pt;line-height:13pt;font-size:9pt}
`;
if (kind === "kibou") {
/* 希望休の表は、見出し文＋表＋注意書き2つ＋見本までを1枚に収めるため行を詰める（完成シフト表の実測29ptは変更しない） */
css += `
tbody td{height:24pt}
.txt-red{margin:5pt 0;padding:5pt 7pt}
.txt-black{padding:5pt 7pt}
.txt-flex{margin-top:5pt}
.legend{margin-top:4pt}
`;
}
return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>印刷用シフト表</title><style>${css}</style></head>
<body><div class="toolbar"><button onclick="window.print()">🖨 プリント（用紙 ${p.size}・${p.orient === "landscape"? "横": "縦"}）</button>
<span>プリンターの画面で用紙と向きを合わせてください。そのままPDFに保存もできます。</span></div>
${sheetHTML(kind, ym, schedule)}
<script>setTimeout(function(){},200)<\/script></body></html>`;
}
function openPrint(kind, ym, schedule) {
const html = printDocHTML(kind, ym, schedule);
document.getElementById("printFallback").innerHTML = sheetHTML(kind, ym, schedule);
const w = window.open("", "_blank");
if (w) { w.document.open(); w.document.write(html); w.document.close();}
showConfirm("印刷", `<p>印刷用のページを新しいタブで開きました。<br><b>開いたページから印刷してください</b>（用紙 ${state.paper.size}・${state.paper.orient === "landscape"? "横": "縦"}）。</p>`, [{ label: "OK", cls: "primary"}]);
}

/* ---------------- モーダル・タブ ---------------- */
function showConfirm(title, html, buttons) {
const ov = document.getElementById("confirmOverlay"), md = document.getElementById("confirmModal");
md.innerHTML = `<h3>${esc(title)}</h3><div>${html}</div><div class="btnrow">` +
buttons.map((b, i) => `<button class="btn ${b.cls || ""}" data-ci="${i}">${esc(b.label)}</button>`).join("") + `</div>`;
ov.classList.add("show");
md.querySelectorAll("[data-ci]").forEach(btn => btn.addEventListener("click", () => {
ov.classList.remove("show");
const b = buttons[+btn.dataset.ci]; if (b && b.fn) b.fn();
}));
}
function gotoTab(n) {
state.ui.tab = n; save();
document.querySelectorAll("#tabNav button").forEach(b => b.classList.toggle("active", +b.dataset.tab === n));
document.querySelectorAll("section.tabpage").forEach((s, i) => s.classList.toggle("show", i + 1 === n));
renderTab(n);
window.scrollTo({ top: 0});
}
function renderTab(n) {
({ 1: render1, 2: render2, 3: render3, 4: render4, 5: render5})[n]();
fitPaperScales();
}
function renderHeader() {
document.getElementById("hBaseName").textContent = state.baseName;
const sel = document.getElementById("hBaseSel");
sel.innerHTML = state.bases.map(b => `<option ${b === state.baseName? "selected": ""}>${esc(b)}</option>`).join("");
const pending = state.inbox.filter(x =>!x.handled).length;
document.getElementById("adminBadge").style.display = pending? "block": "none";
const d = state.defaults[state.baseName];
const notice = document.getElementById("updateNotice");
if (d && state.defaultAppliedAt && d.savedAt > state.defaultAppliedAt) {
notice.innerHTML = `<div class="notice">新しいデータがあります 入れ替えますか？
<button class="btn orange" onclick="App.applyDefault()">入れ替える</button>
<button class="btn" onclick="App.dismissUpdate()">あとで</button></div>`;
} else notice.innerHTML = "";
renderGuide();
}
function renderGuide() {
const bar = document.getElementById("guideBar");
if (!state.autoMode) { bar.classList.remove("show"); return;}
const steps = [
["② 希望休の表を確認します", 2], ["③ 休みを入力します", 3],
["④ 自動でシフト表を作ります", 4], ["④ 採用して印刷します", 4]
];
const i = Math.min(state.ui.guideStep || 0, steps.length - 1);
bar.innerHTML = `<b>🤖 オートモード：</b><span>${steps[i][0]}</span>
<button class="btn" onclick="App.guideGo(${steps[i][1]})">この画面を開く</button>
<button class="btn" onclick="App.guideNext()">次へ</button>
<button class="btn primary" onclick="App.guideOff()">ここからは手動で進める</button>`;
bar.classList.add("show");
}

/* ---------------- ① 回送員・条件 ---------------- */
function render1() {
const el = document.getElementById("page1");
const members = sortedMembers();
const rows = members.map(mem => {
const p = personOf(mem.id);
const wdChips = WD_PY.map(w => `<span class="wdchip ${(p["毎週どれか休み"] || []).includes(w)? "on": ""}" onclick="App.toggleWeekly('${mem.id}','${w}')">${w}</span>`).join("");
const sel = (cur, opts, fn) => `<select onchange="${fn}">${opts.map(o => `<option ${o === cur? "selected": ""}>${o}</option>`).join("")}</select>`;
return `<tr>
<td data-label="社員番号・名前・所属"><b>${esc(mem.id)}</b><br>${esc(mem.name)}<br><span class="sub">${esc(mem.org)}</span></td>
<td data-label="毎週どれか休み">${wdChips}<div class="sub">押した曜日のどれか1日を毎週休みに</div></td>
<td data-label="連勤数">${sel(p["連勤数"] || "3連勤まで", ["2連勤まで", "3連勤まで", "4連勤まで"], `App.setPerson('${mem.id}','連勤数',this.value)`)}<div class="sub">何連勤まで（5連勤は作りません）</div></td>
<td data-label="連休回数">${sel(p["連休回数"] || "月1、2回", ["月1回", "月1、2回", "月2回"], `App.setPerson('${mem.id}','連休回数',this.value)`)}<div class="sub">月に何回連休を作るか</div></td>
<td data-label="連休の日">${sel(p["連休の日"] || "指定無し", ["指定無し", "平日", "土日"], `App.setPerson('${mem.id}','連休の日',this.value==='指定無し'?null:this.value)`)}<div class="sub">平日だけ・土日祝だけ等</div></td>
<td data-label="月末/月初">${sel(p["月末月初"] || "指定無し", ["指定無し", "月末", "月初", "どちらか"], `App.setPerson('${mem.id}','月末月初',this.value==='指定無し'?null:this.value)`)}<div class="sub">最終日・翌月1日を休みに（※計算への反映は今後の課題）</div></td>
<td data-label="飛び石なし"><label><input type="checkbox" ${p["飛び石なし"]!== false? "checked": ""} onchange="App.setPerson('${mem.id}','飛び石なし',this.checked)"> 飛び石なし</label><div class="sub">「休→出→休」を作りません</div></td>
<td data-label="土日祝休">${sel(p["土日祝休"] || "指定無し", ["指定無し", "1日〜2日", "1日〜3日", "2日〜4日", "3日〜5日"], `App.setPerson('${mem.id}','土日祝休',this.value==='指定無し'?null:this.value)`)}<div class="sub">土・日・祝日の休みを月に何日にするか</div></td>
<td data-label="削除"><button class="btn" onclick="App.delMember('${mem.id}')">削除</button></td>
</tr>`;
}).join("");
const pri = state.priority, pc = state.priorityCustom;
const priRow = (label, key, def) => `<tr><td>${label}</td><td><input type="number" value="${pri[key]}" min="0" max="14" onchange="App.setPriority('${key}',this.value)" style="${pc[key]? "color:#ff8f96;border-color:#d2363c": ""}"></td></tr>`;
const longRows = state.longHolidays.map((h, i) => `<tr>
<td><input value="${esc(h.name)}" onchange="App.setLong(${i},'name',this.value)" style="width:110px"></td>
<td><input type="date" value="${esc(h.from)}" onchange="App.setLong(${i},'from',this.value)"></td>
<td><input type="date" value="${esc(h.to)}" onchange="App.setLong(${i},'to',this.value)"></td>
<td><input value="${esc(h.work)}" placeholder="例：2027-01-04（無ければ空）" onchange="App.setLong(${i},'work',this.value)" style="width:200px"></td>
<td><button class="btn" onclick="App.delLong(${i})">削除</button></td></tr>`).join("");
el.innerHTML = `
<div class="card band-red"><h3>①-1 回送員の登録と一人ずつの条件</h3>
<div class="flex"><span>並び順：</span><b>雇用区分 → 社員番号（標準）</b>
<button class="btn" onclick="App.orgOrder()">雇用区分の順番</button>
<button class="btn" onclick="App.addMember()">＋ 回送員を追加（1人ずつ）</button>
<button class="btn" onclick="App.toggleBulk()">＋ まとめて登録（一括）</button></div>
<div id="bulkBox" style="display:none" class="mt">
<div class="sub">1行に1人、「社員番号 名前 所属」の順で書いてください。取り込むと今の一覧と入れ替わります。個人条件は取り込みのあとで1人ずつ入れてください。</div>
<textarea id="bulkText" rows="6" placeholder="100001 回送員A 東西"></textarea>
<div class="btnrow"><button class="btn primary" onclick="App.doBulk()">取り込む（一覧と入れ替える）</button></div>
</div>
<div class="gwrap mt"><table class="mtab"><thead><tr>
<th>社員番号／名前／所属</th><th>毎週どれか休み</th><th>連勤数</th><th>連休回数</th><th>連休の日</th><th>月末/月初</th><th>飛び石なし</th><th>土日祝休</th><th>削除</th>
</tr></thead><tbody>${rows}</tbody></table></div>
<p class="sub">名前はこの端末の中にだけ保存され、ネットには送られません。</p>
</div>
<div class="card band-blue"><h3>①-2 優先して守る条件</h3>
<p class="sub">上ほど優先です。数字は人数（${state.members.length}人）から自動で決まります。直した所は赤くなります。</p>
<table class="mtab"><tbody>
<tr><td>1 希望休・有休は必ず休み</td><td>（必ず）</td></tr>
<tr><td>2 週の休みは必ず2日</td><td>2日</td></tr>
${priRow("3 毎日の出勤は最低この人数（閑散日は少なくてもよい）", "minWork")}
${priRow("4 普通の日は多くてもこの人数", "maxNormal")}
${priRow("5 繁忙日はできればこの人数以上", "busyMin")}
${priRow("5 繁忙日は多くてもこの人数", "busyMax")}
</tbody></table>
<div class="btnrow"><button class="btn" onclick="App.resetPriority()">自動の数字に戻す</button>
<label><input type="checkbox" ${state.common["飛び石なし"]? "checked": ""} onchange="App.setCommonTobi(this.checked)"> 飛び石なし（共通）</label></div>
</div>
<div class="card band-orange"><h3>①-3 長い休み（全員の全体休）</h3>
<div class="gwrap"><table class="mtab"><thead><tr><th>名前</th><th>何日から</th><th>何日まで</th><th>間の出勤日</th><th></th></tr></thead><tbody>${longRows}</tbody></table></div>
<div class="btnrow"><button class="btn" onclick="App.addLong()">＋ 長い休みを追加</button></div>
<p class="redtext small">去年の日付が残っていると、その日も「全」になってしまいます。終わった休みは消してください。</p>
</div>
<div class="btnrow"><button class="btn primary" onclick="App.go(2)">次へ：② 希望休の表 →</button></div>`;
}

/* ---------------- 印刷イメージの画面プレビュー（紙スケール表示） ----------------
* 画面に出す印刷イメージは、固定デザイン幅の「紙」として描き、カードの幅に
* 合わせて transform: scale() で縮小する。スマホ幅でも文字が重ならず、紙の
* 全体が一度に見えるようにするため（印刷用HTMLには一切影響しない）。 */
const PAPER_DESIGN_W = 1040; // A4横の印刷可能幅 ≒ 1040px をデザイン幅にする
function paperPreviewHTML(kind, ym, schedule) {
  return `<div class="paperScale"><div class="paper" style="width:${PAPER_DESIGN_W}px">${sheetHTML(kind, ym, schedule)}</div></div>`;
}
function fitPaperScales() {
  document.querySelectorAll(".paperScale").forEach(wrap => {
    const paper = wrap.querySelector(".paper");
    if (!paper) return;
    const avail = wrap.clientWidth;
    if (!avail) return; // 非表示のときは何もしない（表示後に呼び直される）
    const s = Math.min(1, avail / PAPER_DESIGN_W);
    paper.style.transform = s < 1 ? `scale(${s})` : "";
    wrap.style.height = Math.ceil(paper.offsetHeight * s) + "px";
  });
}

/* ---------------- ② 希望休の表 ---------------- */
function render2() {
  const el = document.getElementById("page2"), ym = state.ui.month;
  el.innerHTML = `
  <div class="card band-red"><h3>② 希望休の表（${ymLabel(ym)}）</h3>
    <div class="flex"><label>月：<select onchange="App.setMonth(this.value)">${monthOptions(ym)}</select></label>
    <span class="sub">文言を直すと印刷イメージがすぐ変わります（自動保存）。</span></div>
    ${paperPreviewHTML("kibou", ym, null)}
    <h4>文言の編集</h4>
    <label class="small">① 上の赤い枠</label><textarea rows="2" onchange="App.setText('t1',this.value)">${esc(state.texts2.t1)}</textarea>
    <label class="small">② 下の左（黒い枠）</label><textarea rows="2" onchange="App.setText('t2',this.value)">${esc(state.texts2.t2)}</textarea>
    <label class="small">③ 下の右（赤い枠）</label><textarea rows="2" onchange="App.setText('t3',this.value)">${esc(state.texts2.t3)}</textarea>
    <div class="btnrow">
      <button class="btn" onclick="App.textsToDefault()">デフォルトに設定</button>
      <button class="btn" onclick="App.textsReset('t1')">①だけ戻す</button>
      <button class="btn" onclick="App.textsReset('t2')">②だけ戻す</button>
      <button class="btn" onclick="App.textsReset('t3')">③だけ戻す</button>
      <button class="btn" onclick="App.textsReset('all')">全部戻す</button>
    </div>
  </div>
  <div class="card band-gray"><h3>印刷</h3>
    <div class="flex">${paperControls("2")}</div>
    <div class="btnrow"><button class="btn primary big" onclick="App.printKibou()">この表を印刷する</button></div>
  </div>
  <div class="btnrow"><button class="btn primary" onclick="App.go(3)">次へ：③ 休みの入力 →</button></div>`;
  fitPaperScales();
}

/* ---------------- ③ 休みの入力 ---------------- */
function calChips(ym, mode) {
  // mode: "zentai"（祝→全→戻る） | "busy"（普通→繁→閑→普通）
  const md = monthData(ym), D = daysIn(ym), first = dateOf(ym, 1);
  const lead = (first.getDay() + 7) % 7;
  let cells = WD.map((w, i) => `<div class="dow" style="color:${i === 6 ? "#7db3ff" : i === 0 ? "#ff8f96" : "inherit"}">${w}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="dcell blank"></div>`;
  for (let d = 1; d <= D; d++) {
    const dt = dateOf(ym, d), zen = zentaiSet(ym).has(d), hol = (md.holidays || []).includes(d);
    const busy = (md.busy || []).includes(d), quiet = (md.quiet || []).includes(d);
    let cls = dt.getDay() === 6 ? "sat" : dt.getDay() === 0 ? "sun" : "";
    let st = "・";
    if (mode === "zentai") { if (zen) { cls += " zen"; st = "全"; } else if (hol) { cls += " hol"; st = "祝"; } }
    else { if (busy) { cls += " busy"; st = "繁"; } else if (quiet) { cls += " quiet"; st = "閑"; } }
    cells += `<div class="dcell ${cls}" onclick="App.chip('${mode}',${d})">${d}<span class="st">${st}</span></div>`;
  }
  return `<div class="cal">${cells}</div>`;
}
function balanceText(ym) {
  const { input } = buildSolverInput(ym);
  const members = sortedMembers(), M = members.length, D = daysIn(ym), zen = zentaiSet(ym);
  // 週2日ルールから決まる総休み（全体休を含む）
  let totalOff = 0;
  const weeks = S.weeksOfMonth(ym);
  members.forEach(mem => {
    weeks.forEach(w => {
      const fixedIn = w.in_days.filter(d => zentaiSet(ym).has(d) || ((input.requests[mem.id] || {}).kibou || []).includes(d) || ((input.requests[mem.id] || {}).yukyu || []).includes(d) || (input.fixed_off[mem.id] || []).includes(d)).length;
      const isFirst = w.start < dateOf(ym, 1), isLast = w.end > dateOf(ym, D);
      let need;
      if (isFirst && !isLast) { const pv = input.prev_month_last_week_offs[mem.id]; need = pv != null ? 2 - pv : 2; }
      else if (isLast) need = Math.max(2, fixedIn);
      else need = 2;
      totalOff += Math.max(need, fixedIn);
    });
  });
  const workDays = Array.from({ length: D }, (_, i) => i + 1).filter(d => !zen.has(d));
  const zenOff = M * zen.size;
  const expectWork = M * workDays.length - (totalOff - zenOff);
  let minNeed = 0, maxNeed = 0;
  workDays.forEach(d => {
    if ((input.busy_days || []).includes(d)) { minNeed += state.priority.busyMin; maxNeed += state.priority.busyMax; }
    else if ((input.quiet_days || []).includes(d)) { minNeed += 0; maxNeed += state.priority.maxNormal; }
    else { minNeed += state.priority.minWork; maxNeed += state.priority.maxNormal; }
  });
  const avg = workDays.length ? (expectWork / workDays.length).toFixed(1) : "0";
  const ok = expectWork >= minNeed && expectWork <= maxNeed;
  return { expectWork, avg, minNeed, maxNeed, ok };
}
function render3() {
  const el = document.getElementById("page3"), ym = state.ui.month;
  const md = monthData(ym), members = sortedMembers(), D = daysIn(ym), zen = zentaiSet(ym);
  const cols = prevCols(ym), auto = autoPrevCells(ym);
  const grid = Object.keys(md.prevCells || {}).length ? md.prevCells : auto;
  // ヘッダ
  let head = `<th class="name">前月末→</th>`;
  cols.forEach(dt => { head += `<th class="prev">${dt.getMonth() + 1}/${dt.getDate()}<br>${WD[dt.getDay()]}</th>`; });
  for (let d = 1; d <= D; d++) {
    const dt = dateOf(ym, d);
    const cls = dt.getDay() === 6 ? "sat" : (dt.getDay() === 0 || (md.holidays || []).includes(d)) ? "sun" : "";
    head += `<th class="${cls}">${d}<br>${WD[dt.getDay()]}</th>`;
  }
  const markCls = mk => mk === "希" ? "m-ki" : mk === "有" ? "m-yu" : mk === "全" ? "m-zen" : "m-ko";
  const rows = members.map(mem => {
    let tds = `<td class="name">${esc(mem.id)} ${esc(mem.name)}</td>`;
    for (let i = 0; i < 7; i++) {
      const mk = (grid[mem.id] || {})[i] || "";
      tds += `<td class="cell prev ${mk ? markCls(mk) : ""}" onclick="App.prevCell('${mem.id}',${i})">${esc(mk)}</td>`;
    }
    for (let d = 1; d <= D; d++) {
      const dt = dateOf(ym, d), sep = dt.getDay() === 6 ? " weeksep" : "";
      if (zen.has(d)) { tds += `<td class="fixed m-zen${sep}">全</td>`; continue; }
      const mk = ((md.cells || {})[mem.id] || {})[d] || "";
      tds += `<td class="cell ${mk ? markCls(mk) : ""}${sep}" onclick="App.cell('${mem.id}',${d})">${esc(mk)}</td>`;
    }
    return `<tr>${tds}</tr>`;
  }).join("");
  const bal = balanceText(ym);
  const reqRows = Array.from({ length: D }, (_, i) => i + 1).filter(d => !zen.has(d)).map(d => {
    const v = (md.dayRequired || {})[d];
    return `<span class="chip">${d}日 <input type="number" min="0" max="${members.length}" value="${v == null ? "" : v}" placeholder="指定なし" onchange="App.setDayRequired(${d},this.value)" style="width:64px"></span>`;
  }).join("");
  el.innerHTML = `
  <div class="card band-red"><h3>③ 休みの入力（${ymLabel(ym)}）</h3>
    <div class="flex mb"><label>月：<select onchange="App.setMonth(this.value)">${monthOptions(ym)}</select></label>
    <span class="sub">②で選んだ月と連動します。</span></div>
    <p class="sub">🖱 マスをタップすると「休」→「希（希望休）」→「有（有休）」→ 空白 と変わります。「休」は希望ではないけれど休みに決まっている日に使います。「全」は変わりません。<br>
    左の灰色7列は前月の最後の1週間です（月またぎの連勤チェック用）。前月をこのツールで「決定（採用）」していれば自動で入ります。空のままの人はチェックしません。</p>
    <div class="gwrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>
    <div class="mt ${bal.ok ? "greentext" : "warntext"}">この月の延べ出勤 ${bal.expectWork}人日（1日平均 ${bal.avg}人）／必要：最低 ${bal.minNeed}人日 〜 最大 ${bal.maxNeed}人日<br>
    ${bal.ok ? "釣り合っています。" : "釣り合っていません。休みの数を見直してください。"}</div>
  </div>
  <div class="card" style="border-left:8px solid #c9a86a"><h3>全体休・祝日の指定</h3>
    <p class="sub">📅 日付をタップすると「祝（祝日）」→「全（全体休）」→ 元に戻る、と変わります。祝日と長い休み（①-3）は最初から入っています。</p>
    ${calChips(ym, "zentai")}
  </div>
  <div class="card band-blue"><h3>希望休の入れ方</h3>
    <p class="sub">✋ 上の表で、休みたい日のマスをタップしてください。1回＝「休」、2回＝「希（希望休）」、3回＝「有（有休）」、4回＝空白に戻ります。②の表で集めた希望休をここに入れます。</p>
  </div>
  <div class="card band-orange"><h3>繁忙日・閑散日の指定</h3>
    <p class="sub">🔥 日付をタップすると 普通 →「繁（繁忙日）」→「閑（閑散日）」→ 普通 と変わります。繁忙日は出勤を多めに、閑散日は少なめにできます。</p>
    ${calChips(ym, "busy")}
  </div>
  <div class="card band-purple"><h3>指定日の必要人数</h3>
    <p class="sub">🔢 特定の日だけ「この日は必ず○人出勤」と決めたいときに入力してください。空欄は指定なしです。</p>
    <div>${reqRows}</div>
  </div>
  <div class="btnrow">
    <button class="btn primary" onclick="App.go(4)">次へ：④ シフト作成／印刷 →</button>
    <button class="btn" onclick="App.clearMonth()">この月の入力を消す</button>
  </div>`;
}

/* ---------------- ④ シフト作成／印刷 ---------------- */
function shiftOf(ym) {
  if (!state.shifts[ym]) state.shifts[ym] = { plans: {}, manual: null, view: "A", cur: null };
  return state.shifts[ym];
}
function scheduleTableHTML(ym, schedule, editable, onTap) {
  const members = sortedMembers(), D = daysIn(ym), md = monthData(ym);
  let head = `<th class="name">社員番号</th><th class="name">名前</th>`;
  for (let d = 1; d <= D; d++) {
    const dt = dateOf(ym, d);
    const cls = dt.getDay() === 6 ? "sat" : (dt.getDay() === 0 || (md.holidays || []).includes(d)) ? "sun" : "";
    head += `<th class="${cls}">${d}<br>${WD[dt.getDay()]}</th>`;
  }
  head += `<th>休日<br>日数</th><th>出勤<br>日数</th>`;
  const markCls = mk => mk === "公" ? "m-ko" : mk === "希" ? "m-ki" : mk === "有" ? "m-yu" : "m-zen";
  const rows = members.map(mem => {
    const sch = schedule[mem.id] || {};
    let offN = 0, tds = `<td class="name">${esc(mem.id)}</td><td class="name">${esc(mem.name)}</td>`;
    for (let d = 1; d <= D; d++) {
      const dt = dateOf(ym, d), sep = dt.getDay() === 6 ? " weeksep" : "", mk = sch[d] || "";
      if (mk) offN++;
      const canTap = editable && mk !== "全";
      tds += `<td class="${canTap ? "cell" : "fixed"} ${mk ? markCls(mk) : ""}${sep}" ${canTap ? `onclick="${onTap}('${mem.id}',${d})"` : ""}>${esc(mk)}</td>`;
    }
    tds += `<td class="num">${offN}</td><td class="num">${D - offN}</td>`;
    return `<tr>${tds}</tr>`;
  }).join("");
  const dw = dailyWorkOf(schedule, ym);
  const foot = `<tr><td colspan="2" style="text-align:right;padding-right:6px;background:#fafafa">出勤人数合計</td>` +
    Array.from({ length: D }, (_, i) => `<td class="num">${dw[i + 1]}</td>`).join("") + `<td></td><td></td></tr>`;
  return `<div class="gwrap"><table class="grid"><thead><tr>${head}</tr></thead><tbody>${rows}${foot}</tbody></table></div>`;
}
function checkHTML(schedule, ym) {
  const v = verifySchedule(schedule, ym);
  if (!v.violations.length && !v.warnings.length) return `<p class="greentext">✅ チェック結果：すべての条件を満たしています。</p>`;
  return `<div class="vlist">` +
    (v.violations.length ? `<p class="redtext"><b>⚠ 条件を満たしていない所（${v.violations.length}件）</b></p>` + v.violations.map(x => `<div class="redtext">・${esc(x)}</div>`).join("") : `<p class="greentext">✅ ハード条件はすべて満たしています。</p>`) +
    (v.warnings.length ? `<p class="warntext"><b>参考（警告 ${v.warnings.length}件）</b></p>` + v.warnings.slice(0, 12).map(x => `<div class="warntext">・${esc(x)}</div>`).join("") : "") + `</div>`;
}
function isLocked(adopted) {
  if (!adopted || !adopted.adoptedAt) return false;
  const t = new Date(adopted.adoptedAt); t.setMonth(t.getMonth() + 2);
  return new Date() > t;
}
function render4() {
  const el = document.getElementById("page4"), ym = state.ui.month, sh = shiftOf(ym);
  const pastYms = Object.keys(state.shifts).filter(k => state.shifts[k].adopted).sort().reverse();
  const pastRows = pastYms.map(pym => {
    const ad = state.shifts[pym].adopted, locked = isLocked(ad);
    const upd = ad.updatedAt ? ad.updatedAt.slice(0, 10).replace(/-/g, "/") : "";
    return `<div class="flex" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:7px 0">
      <span><b>${ymLabel(pym)}</b> ${esc(ad.kind)}・${upd}更新 ${locked ? "🔒 ロック中（採用から2か月）" : ""}</span>
      <span><button class="btn" onclick="App.printPast('${pym}')">印刷する</button>
      <button class="btn" ${locked ? "disabled" : ""} onclick="App.editPast('${pym}')">直す</button></span></div>`;
  }).join("");
  let main = "";
  if (state.ui.editPast) {
    const pym = state.ui.editPast, ad = state.shifts[pym].adopted;
    main = `<div class="card band-green"><h3>${ymLabel(pym)}のシフト表を直す</h3>
      <p class="sub">マスをタップ：「公」→「希」→「有」→ 空欄（「全」は変わりません）。直したら下の「更新する」を押してください。</p>
      ${scheduleTableHTML(pym, ad.schedule, true, "App.pastTap")}
      <div id="pastCheck">${checkHTML(ad.schedule, pym)}</div>
      <div class="btnrow"><button class="btn green" onclick="App.pastSave()">更新する（保存）</button>
      <button class="btn" onclick="App.pastCancel()">やめる</button></div></div>`;
  } else {
    const view = sh.view || "A";
    const curSch = sh.cur ? sh.cur.schedule : null;
    const planBtns = ["A", "B"].map(p => sh.plans[p] ? `<button class="btn ${view === p ? "primary" : ""}" onclick="App.viewPlan('${p}')">${p}案を見る</button>` : "").join("") +
      (sh.manual ? `<button class="btn ${view === "manual" ? "primary" : ""}" onclick="App.viewPlan('manual')">手動用を見る</button>` : "");
    main = `
    <div class="btnrow">
      <button class="btn primary" onclick="App.autoSolve()">▶ 自動でシフト表を作る</button>
      <button class="btn blue" onclick="App.manualMake()">✍ 手動で作る（希望休だけの表）</button>
      ${planBtns}
    </div>
    <div class="progress" id="solveLog">「自動でシフト表を作る」を押すと、A案とB案が作られます（30秒〜1分ほどかかることがあります）。条件によってはA案だけの場合があります。できあがった表はマスをタップして直せます。</div>
    ${curSch ? `
      <h4 class="mt">${view === "manual" ? "手動用" : view + "案"} のシフト表</h4>
      <p class="sub">マスをタップ：「公」→「希」→「有」→ 空欄（「全」は変わりません）。直すと下のチェックも出直します。</p>
      ${scheduleTableHTML(ym, curSch, true, "App.curTap")}
      <div id="curCheck">${checkHTML(curSch, ym)}</div>
      <div class="btnrow"><button class="btn green big" onclick="App.adopt()">正式なシフト表に採用</button></div>
      <div class="card band-gray"><h3>印刷</h3><div class="flex">${paperControls("4")}</div>
      <div class="btnrow"><button class="btn primary" onclick="App.printCur()">この表を印刷する</button></div></div>
    ` : ""}`;
  }
  el.innerHTML = `
  <div class="card band-red"><h3>④ シフト作成／印刷</h3>
    <div class="flex"><label>シフト表を作る月：<select onchange="App.setMonth(this.value)">${monthOptions(ym)}</select></label></div>
    <p class="sub">A案・B案・手動用から選び、マスをタップして直し、「正式なシフト表に採用」→「この表を印刷する」の順で進めます。直した内容は翌月の「前月末」7列や、連休・3連休の平等化（過去6か月分）にも使われます。</p>
    ${main}
  </div>
  <div class="card band-green"><h3>過去のシフト表</h3>
    ${pastRows || `<p class="sub">まだ採用したシフト表がありません。採用するとここに残ります（複数月分を扱えます）。</p>`}
    <p class="sub">採用から2か月たった表はロックされ、直せなくなります。</p>
  </div>
  <p class="sub">おつかれさまでした。次の月は ① から（← 最初に戻る）<br>iPhoneの入力をパソコンへ移すときは ⑤ 便利な機能 →</p>`;
}

/* ---------------- ⑤ 便利な機能 ---------------- */
function exportString(obj) {
  return PREFIX + btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function importString(str) {
  str = (str || "").trim();
  if (!str.startsWith(PREFIX)) throw new Error("Muse版のデータ文字列ではありません（" + PREFIX + " で始まる文字列を貼ってください）");
  return JSON.parse(decodeURIComponent(escape(atob(str.slice(PREFIX.length)))));
}
function baseDataObj() {
  return { kind: "base", baseName: state.baseName, members: state.members, common: state.common, perPerson: state.perPerson, priority: state.priority, longHolidays: state.longHolidays, texts2: state.texts2, orgOrder: state.orgOrder };
}
function applyBaseData(o) {
  if (o.members) state.members = o.members;
  if (o.common) state.common = o.common;
  if (o.perPerson) state.perPerson = o.perPerson;
  if (o.priority) state.priority = o.priority;
  if (o.longHolidays) state.longHolidays = o.longHolidays;
  if (o.texts2) state.texts2 = o.texts2;
  if (o.orgOrder) state.orgOrder = o.orgOrder;
}
function fullDataObj() { return { kind: "full", state }; }
function render5() {
  const el = document.getElementById("page5");
  const ym = state.ui.month, sh = state.shifts[ym];
  const inboxRows = state.inbox.map((x, i) => `<div class="flex" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:7px 0">
    <span>${x.handled ? "" : "📢 "}<b>${esc(x.from)}</b> さんから${x.kind === "data" ? "データ" : "要望"}が届いています（${esc(x.date)}）${x.kind === "data" && !x.handled ? " → デフォルトに登録しますか？" : ""}<br><span class="sub">${esc(x.text || "")}</span></span>
    <span>${x.kind === "data" && !x.handled ? `<button class="btn orange" onclick="App.inboxRegister(${i})">デフォルトに登録</button>` : ""}
    <button class="btn" onclick="App.inboxDelete(${i})">削除</button></span></div>`).join("");
  const fbRows = state.feedback.map((f, i) => `<div class="flex" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:6px 0"><span>${esc(f.date)}：${esc(f.text)}</span><button class="btn" onclick="App.fbDelete(${i})">削除</button></div>`).join("");
  el.innerHTML = `
  <div class="card band-red"><h3>⑤ 便利な機能</h3>
    <details class="fold"><summary>管理者の方へ（データの配り方）</summary>
      <p class="sub">管理者はこの作業は不要です。管理者メニュー（🔑）で「デフォルトに登録」すると、ほかの端末には「新しいデータがあります」と出て、更新すると同じ内容になります。ここにある書き出し・読み込みは、うまくいかないときの予備の方法です。</p>
      <details class="fold"><summary>管理者用：データの書き出し・読み込み（折りたたみ）</summary>
        <p class="sub">拠点のデータ（回送員・条件など）を文字列にして、スマホ ⇄ パソコンで渡す方法です。</p>
        <textarea id="ioText" rows="4" placeholder="ここにデータ文字列が出ます／読み込む文字列を貼ります"></textarea>
        <div class="steps">
          <div class="step"><span class="no">1</span><div class="st-body"><b>書き出す</b><br><span class="sub">送りたい端末で、今の内容をデータ文字列にします。</span><br><button class="btn" onclick="App.ioExport()">① 書き出す</button></div></div>
          <div class="arrowd">▼</div>
          <div class="step"><span class="no">2</span><div class="st-body"><b>渡す</b><br><span class="sub">文字列をコピーして送るか、ファイルに保存して渡します。</span><br><button class="btn" onclick="App.ioCopy()">② コピー</button> <button class="btn" onclick="App.ioSaveFile()">ファイルに保存</button></div></div>
          <div class="arrowd">▼</div>
          <div class="step"><span class="no">3</span><div class="st-body"><b>読み込む</b><br><span class="sub">受け取った端末で、文字列を上の欄に貼って読み込みます。</span><br><button class="btn" onclick="App.ioImport()">読み込む</button> <button class="btn" onclick="document.getElementById('ioText').value=''">欄を空にする</button> <label class="btn">ファイルから読み込む<input type="file" accept=".txt,.json" style="display:none" onchange="App.ioLoadFile(this)"></label></div></div>
          <div class="arrowd">▼</div>
          <div class="resultbox">✅ 読み込むと、その機械に入っていた内容は全部入れ替わります。データには名前が入っているので、送る相手は職場の人だけにしてください。</div>
        </div>
      </details>
    </details>

    <h4>📤 データを管理者に送る</h4>
    <div class="steps">
      <div class="step"><span class="no">1</span><div class="st-body"><b>名前を入れる</b><br><input id="sendName" placeholder="あなたの名前" style="width:180px"></div></div>
      <div class="arrowd">▼</div>
      <div class="step"><span class="no">2</span><div class="st-body"><b>確認して送る</b><br><span class="sub">自分の端末の入力（希望休など）を管理者に送ります。送る前に確認が出ます。</span><br><button class="btn blue" onclick="App.sendToAdmin()">データを管理者に送る</button></div></div>
      <div class="arrowd">▼</div>
      <div class="resultbox">✅ 送ると管理者に届きます。管理者が確認して、必要ならデフォルトに登録します。</div>
    </div>

    <h4 class="mt">📥 届いたデータ・要望（管理者用）</h4>
    ${inboxRows || `<p class="sub">届いているものはありません。</p>`}
    <p class="sub">※ Muse版ではサーバーが無いため、「送る」はこの端末の中での疑似動作です。実際には他の端末へは届きません。</p>

    <h4 class="mt">🔄 ファイル変換</h4>
    <p class="sub">PDF → Excel：表をExcelで開きたいときは、下のボタンでCSV（Excelで開けるファイル）を出すのが確実です。<br>
    PDF → JPG：画質は落ちますが、LINEで送るには軽くて便利です。印刷用のページを開いて、画面の写真（スクリーンショット）を撮るのが簡単です。</p>
    <div class="btnrow"><button class="btn" onclick="App.exportCSV()">今月のシフト表をCSVで出す（Excel用）</button></div>

    <h4 class="mt">✉ 要望を送る</h4>
    <p class="sub">直してほしい所や困っていることを書いてください。文章・スクショ・ファイルはソフト開発者へ送られ、溜まった要望をまとめて、確認して「要望を実行して」で作業します（Muse版では端末内にメモとして残ります）。</p>
    <textarea id="fbText" rows="3" placeholder="要望を書いてください"></textarea>
    <div class="btnrow"><button class="btn blue" onclick="App.fbAdd()">要望を送る（メモに残す）</button></div>
    ${fbRows}

    <h4 class="mt">🤖 オートモード</h4>
    <p class="sub">オンにすると、ポップアップと案内だけで希望休から印刷まで進められます。途中いつでも「ここからは手動で進める」で抜けられます。（Muse版は簡易版です）</p>
    <button class="btn ${state.autoMode ? "primary" : ""}" onclick="App.autoToggle()">オートモード：${state.autoMode ? "オン" : "オフ"}</button>
  </div>`;
}

/* ---------------- 管理者メニュー ---------------- */
function renderAdmin() {
  const md = document.getElementById("adminModal");
  const base = state.baseName, d = state.defaults[base];
  const userRows = state.users.map((u, i) => `<div class="flex" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:6px 0">
    <span>${u.role === "開発者" ? "👑" : u.role === "管理者" ? "🔑" : "📩"} ${esc(u.email)}（${esc(u.role)}）</span>
    ${u.protected ? "" : `<button class="btn" onclick="App.userRemove(${i})">🗑 削除${u.role === "管理者" ? "（外す）" : ""}</button>`}</div>`).join("");
  const adminRows = state.users.filter(u => u.role === "管理者").map(u => `<div class="flex" style="justify-content:space-between;padding:5px 0"><span>🔑 ${esc(u.email)}</span></div>`).join("");
  const baseRows = state.bases.map(b => `<div class="flex" style="justify-content:space-between;border-bottom:1px solid var(--border);padding:6px 0">
    <span>${esc(b)}${b === state.baseName ? "（この端末）" : ""}</span>
    <button class="btn" onclick="App.baseDelete('${esc(b)}')">削除</button></div>`).join("");
  md.innerHTML = `
  <div class="flex" style="justify-content:space-between"><h3>🔑 管理者メニュー</h3><button class="btn" onclick="App.closeAdmin()">閉じる</button></div>
  <p class="sub">あなたはソフト開発者です</p>
  <div class="card" style="border:2px solid var(--red)"><h3>📺 管理者メニューの動画</h3>
    <p class="sub">動画③「データ移動と管理者メニュー」です。このページの中で再生できます（音が出ます）。</p>
    <video id="admVid" class="vid" controls preload="none" playsinline></video>
    <div class="btnrow"><button class="btn primary" onclick="App.playVideo(this,'admVid','videos/video3.mp4.b64')">▶ 動画を読み込んで再生</button></div></div>
  <div class="card band-gray"><h3>🖨 管理者の使い方（印刷用）</h3>
    <p class="sub">管理者の仕事は「登録利用者」と「拠点のデータ」の管理です。困ったときは ⑤「便利な機能」の説明も見てください。</p></div>
  <div class="card band-blue"><h3>👥 登録利用者</h3>
    <p class="sub">ここに入れたメールの人だけが、ログインして使えます。</p>
    <div class="flex"><input id="admUserMail" type="email" placeholder="メールアドレス" style="flex:1">
    <button class="btn blue" onclick="App.userAdd()">追加</button></div>
    <div class="mt">${userRows}</div></div>
  <div class="card band-orange"><h3>📦 拠点のデータ</h3>
    <p class="sub">登録したデータが「デフォルト」になり、その拠点を選んだ人全員に自動で入ります。</p>
    <div class="flex"><label>拠点：<select id="admBaseSel">${state.bases.map(b => `<option ${b === base ? "selected" : ""}>${esc(b)}</option>`).join("")}</select></label></div>
    <div class="btnrow">
      <button class="btn" onclick="App.admTab('def')">デフォルトデータ</button>
      <button class="btn" onclick="App.admTab('cur')">この端末のデータ</button>
      <button class="btn" onclick="App.admTab('blank')">空欄</button>
    </div>
    <textarea id="admDataText" rows="4">${d ? esc(d.str) : ""}</textarea>
    <p class="sub">${d ? `${esc(base)}のデフォルト：回送員${d.memberCount}人・${esc(d.savedAt.replace("T", " ").slice(0, 16))} 保存` : "まだデフォルトは登録されていません。"}</p>
    <div class="btnrow"><button class="btn orange big" onclick="App.admRegister()">💾 データを登録</button></div>
    <div class="btnrow">
      <button class="btn" onclick="App.admApplyFrame()">⬇ 枠のデータをこの端末に入れる</button>
      <button class="btn" onclick="App.admShowPrev()">1つ前のデフォルトを表示</button>
    </div></div>
  <div class="card band-gray"><h3>📍 拠点</h3>
    ${baseRows}
    <div class="flex mt"><input id="admNewBase" placeholder="新しい拠点名" style="flex:1">
    <button class="btn" onclick="App.baseAdd()">追加</button></div></div>
  <div class="card band-purple"><h3>🔑 管理者を追加</h3>
    <p class="sub">管理者も「登録利用者」と拠点のデータを変えられます。管理者の追加・外すは管理者だけで完結します（ソフト開発者は外せません）。</p>
    <div class="flex"><input id="admAdminMail" type="email" placeholder="メールアドレス" style="flex:1">
    <button class="btn" onclick="App.adminAdd()">管理者を追加</button></div>
    <div class="mt">${adminRows || `<span class="sub">管理者はまだいません。</span>`}</div></div>
  <div class="btnrow"><button class="btn blue big" onclick="App.blankSheet()">🆕 白紙の表を作る</button></div>
  <p class="sub">※ Muse版では、登録・配布は端末内だけの疑似動作です。</p>`;
  document.getElementById("adminOverlay").classList.add("show");
}

/* ---------------- 操作（App） ---------------- */
function rerender() { save(); renderHeader(); renderTab(state.ui.tab); }
const App = {
  go(n) { gotoTab(n); },
  /* 説明動画：リポジトリには Base64 化した動画を同梱し、タップで復元してページ内再生する */
  _vidUrls: {},
  playVideo(btn, vidId, path) {
    const v = document.getElementById(vidId);
    if (!v) return;
    if (this._vidUrls[path]) { v.src = this._vidUrls[path]; v.play(); return; }
    btn.disabled = true; const old = btn.textContent; btn.textContent = "読み込み中…";
    fetch(path).then(r => { if (!r.ok) throw new Error("http " + r.status); return r.text(); })
      .then(b64 => {
        const s = b64.replace(/\s+/g, ""), bin = atob(s), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const url = URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
        this._vidUrls[path] = url; v.src = url; v.play();
        btn.textContent = "▶ 再生中（止める時は動画のボタンを）";
      })
      .catch(() => { toast("動画を読み込めませんでした"); btn.disabled = false; btn.textContent = old; });
  },
  setMonth(ym) { state.ui.month = ym; monthData(ym); rerender(); },
  paperChange() {
    const s = document.querySelector("[id^=paperSize]"), o = document.querySelector("[id^=paperOri]");
    if (s) state.paper.size = s.value; if (o) state.paper.orient = o.value; save();
  },
  /* ① */
  toggleWeekly(id, w) {
    const p = personOf(id), arr = p["毎週どれか休み"] || (p["毎週どれか休み"] = []);
    const i = arr.indexOf(w); if (i >= 0) arr.splice(i, 1); else arr.push(w);
    rerender();
  },
  setPerson(id, key, val) { personOf(id)[key] = val; rerender(); },
  setPriority(key, val) {
    const v = Math.max(0, Math.min(14, parseInt(val, 10) || 0));
    state.priority[key] = v;
    const def = { minWork: 10, maxNormal: 11, busyMin: 11, busyMax: 12 }[key];
    if (v === def) delete state.priorityCustom[key]; else state.priorityCustom[key] = true;
    rerender();
  },
  resetPriority() { state.priority = { minWork: 10, maxNormal: 11, busyMin: 11, busyMax: 12 }; state.priorityCustom = {}; rerender(); toast("自動の数字に戻しました"); },
  setCommonTobi(v) { state.common["飛び石なし"] = v; rerender(); },
  addMember() {
    showConfirm("回送員を追加", `<div class="flex" style="flex-direction:column;align-items:stretch">
      <input id="nmId" placeholder="社員番号（例：100015）"><input id="nmName" placeholder="名前"><input id="nmOrg" placeholder="所属（例：東西）"></div>`,
      [{ label: "やめる" }, { label: "追加する", cls: "primary", fn() {
        const id = document.getElementById("nmId").value.trim(), name = document.getElementById("nmName").value.trim(), org = document.getElementById("nmOrg").value.trim() || "東西";
        if (!id || !name) { toast("社員番号と名前を入れてください"); return; }
        if (state.members.some(m => m.id === id)) { toast("その社員番号は既にあります"); return; }
        state.members.push({ id, name, org }); state.perPerson[id] = defaultPerson(); rerender(); toast("追加しました");
      } }]);
    // 入力欄はモーダル表示後に値が要るため、確定時は DOM から読む（showConfirm のボタンハンドラ内で処理）
  },
  delMember(id) {
    const mem = state.members.find(m => m.id === id);
    showConfirm("削除の確認", `<p>${esc(mem ? mem.name : id)} さんを一覧から消しますか？</p>`,
      [{ label: "やめる" }, { label: "削除する", cls: "primary", fn() {
        state.members = state.members.filter(m => m.id !== id); delete state.perPerson[id]; rerender();
      } }]);
  },
  toggleBulk() { const b = document.getElementById("bulkBox"); b.style.display = b.style.display === "none" ? "block" : "none"; },
  doBulk() {
    const text = document.getElementById("bulkText").value.trim();
    if (!text) { toast("取り込む内容がありません"); return; }
    const out = [];
    for (const line of text.split(/\n+/)) {
      const t = line.trim().split(/\s+/); if (t.length < 2) continue;
      out.push({ id: t[0], name: t.slice(1, -1).join(" ") || t[1], org: t.length >= 3 ? t[t.length - 1] : "東西" });
    }
    if (!out.length) { toast("読み取れる行がありませんでした"); return; }
    showConfirm("取り込みの確認", `<p>${out.length}人を取り込みます。今の一覧と入れ替わります。よろしいですか？</p>`,
      [{ label: "やめる" }, { label: "取り込む", cls: "primary", fn() {
        state.members = out;
        out.forEach(m => { if (!state.perPerson[m.id]) state.perPerson[m.id] = defaultPerson(); });
        rerender(); toast("取り込みました");
      } }]);
  },
  orgOrder() {
    const cur = state.orgOrder.join("、");
    showConfirm("雇用区分の順番", `<p class="sub">今の順番：${esc(cur)}</p><p class="sub">並び替えたい順にボタンを押してください。</p>
      <div class="btnrow">${state.orgOrder.map((o, i) => `<button class="btn" onclick="App.orgMove(${i},-1)">↑ ${esc(o)}</button><button class="btn" onclick="App.orgMove(${i},1)">↓ ${esc(o)}</button>`).join("")}</div>`,
      [{ label: "閉じる", cls: "primary" }]);
  },
  orgMove(i, dir) {
    const j = i + dir; if (j < 0 || j >= state.orgOrder.length) return;
    [state.orgOrder[i], state.orgOrder[j]] = [state.orgOrder[j], state.orgOrder[i]];
    save(); App.orgOrder(); renderHeader();
  },
  setLong(i, key, val) { state.longHolidays[i][key] = val; rerender(); },
  addLong() { state.longHolidays.push({ name: "", from: "", to: "", work: "" }); rerender(); },
  delLong(i) { state.longHolidays.splice(i, 1); rerender(); },
  /* ② */
  setText(k, v) { state.texts2[k] = v; save(); render2(); },
  textsToDefault() { state.texts2Default = { ...state.texts2 }; save(); toast("今の文言をデフォルトに設定しました"); },
  textsReset(k) {
    // 注：t1 の初期値は本人の現在値（19日締め切り）
    const init = { t1: "※毎日お疲れ様です。希望休は3日まで、19日締め切りです。", t2: "休みたい日に「×」を書いてください。有休の場合は「有」を記入してください。", t3: "※このシフト表に「有」だけ書いても有給にはなりません！スマホの勤怠アプリで有給申請→受理をもらって有給扱いとなります" };
    const def = state.texts2Default || init;
    if (k === "all") state.texts2 = { ...def }; else state.texts2[k] = def[k];
    rerender(); toast("デフォルトの文言に戻しました");
  },
  printKibou() { App.paperChange(); openPrint("kibou", state.ui.month, null); },
  /* ③ */
  chip(mode, d) {
    const ym = state.ui.month, md = monthData(ym);
    if (mode === "zentai") {
      const hol = md.holidays.includes(d), zen = md.zentai.includes(d);
      if (!hol && !zen) md.holidays.push(d);
      else if (hol) { md.holidays = md.holidays.filter(x => x !== d); md.zentai.push(d); }
      else md.zentai = md.zentai.filter(x => x !== d);
    } else {
      const b = md.busy.includes(d), q = md.quiet.includes(d);
      if (!b && !q) md.busy.push(d);
      else if (b) { md.busy = md.busy.filter(x => x !== d); md.quiet.push(d); }
      else md.quiet = md.quiet.filter(x => x !== d);
    }
    rerender();
  },
  cell(id, d) {
    const ym = state.ui.month, md = monthData(ym);
    if (!md.cells[id]) md.cells[id] = {};
    const cur = md.cells[id][d] || "";
    const next = cur === "" ? "休" : cur === "休" ? "希" : cur === "希" ? "有" : "";
    if (next) md.cells[id][d] = next; else delete md.cells[id][d];
    save(); render3();
  },
  prevCell(id, i) {
    const ym = state.ui.month, md = monthData(ym);
    if (!Object.keys(md.prevCells || {}).length) md.prevCells = autoPrevCells(ym);
    if (!md.prevCells[id]) md.prevCells[id] = {};
    const cur = md.prevCells[id][i] || "";
    const next = cur === "" ? "休" : cur === "休" ? "希" : cur === "希" ? "有" : "";
    if (next) md.prevCells[id][i] = next; else delete md.prevCells[id][i];
    if (md.prevOffsOverride) { delete md.prevOffsOverride[id]; if (md.prevStreakOverride) delete md.prevStreakOverride[id]; }
    save(); render3();
  },
  setDayRequired(d, v) {
    const md = monthData(state.ui.month);
    if (v === "" || v == null) delete md.dayRequired[d]; else md.dayRequired[d] = parseInt(v, 10);
    rerender();
  },
  clearMonth() {
    const ym = state.ui.month;
    showConfirm("入力を消す", `<p>${ymLabel(ym)} の休みの入力（希望休・全体休・繁忙日など）を全部消しますか？</p>`,
      [{ label: "やめる" }, { label: "消す", cls: "primary", fn() {
        state.months[ym] = { cells: {}, prevCells: {}, prevOffsOverride: null, prevStreakOverride: null, holidays: [], zentai: [], busy: [], quiet: [], dayRequired: {} };
        rerender(); toast("消しました");
      } }]);
  },
  /* ④ */
  viewPlan(p) {
    const ym = state.ui.month, sh = shiftOf(ym);
    sh.view = p;
    sh.cur = p === "manual" ? { schedule: sh.manual.schedule, kind: "手動用" } : { schedule: sh.plans[p].schedule, kind: p + "案" };
    rerender();
  },
  autoSolve() {
    const ym = state.ui.month, log = document.getElementById("solveLog");
    log.textContent = "A案：優先の条件から順番に組み合わせを考えています…";
    setTimeout(() => {
      try {
        const { membersData, input, cond, opts } = buildSolverInput(ym);
        const res = S.solveShift(membersData, input, cond, { ...opts, plans: ["A"] });
        const sh = shiftOf(ym);
        if (res.plans.A && res.plans.A.schedule) sh.plans.A = res.plans.A;
        log.textContent = "A案ができました。\nB案：なるべく回送員の個別条件に沿った組み合わせで作っています…";
        setTimeout(() => {
          try {
            const resB = S.solveShift(membersData, input, cond, { ...opts, plans: ["B"], seed: (opts.seed || 1) + 999 });
            if (resB.plans.B && resB.plans.B.schedule) sh.plans.B = resB.plans.B;
            const lines = [];
            ["A", "B"].forEach(p => {
              const e = sh.plans[p];
              if (e) lines.push(p + "案：" + (e.status === "OPTIMAL" ? "条件を満たす表ができました" : "解が見つかりました（要チェック）") + (e.tobiishi_soft ? "（飛び石が一部残っています）" : ""));
            });
            if (!lines.length) { log.textContent = "解が見つかりませんでした。③の入力や条件を見直してください。"; save(); return; }
            sh.view = "A"; sh.cur = { schedule: sh.plans.A.schedule, kind: "A案" };
            save(); render4();
            const l2 = document.getElementById("solveLog"); if (l2) l2.textContent = lines.join("\n");
            toast("シフト表ができました");
          } catch (e2) { log.textContent = "B案の作成でエラーが出ました：" + e2.message; }
        }, 60);
      } catch (e) { log.textContent = "作成できませんでした：" + e.message; }
    }, 60);
  },
  manualMake() {
    const ym = state.ui.month, { input } = buildSolverInput(ym);
    const zen = zentaiSet(ym), schedule = {};
    sortedMembers().forEach(mem => {
      const days = {}, req = input.requests[mem.id] || {};
      zen.forEach(d => { days[d] = "全"; });
      (req.kibou || []).forEach(d => { if (!zen.has(d)) days[d] = "希"; });
      (req.yukyu || []).forEach(d => { if (!zen.has(d)) days[d] = "有"; });
      ((input.fixed_off || {})[mem.id] || []).forEach(d => { if (!zen.has(d)) days[d] = "公"; });
      schedule[mem.id] = days;
    });
    const sh = shiftOf(ym);
    sh.manual = { schedule }; sh.view = "manual"; sh.cur = { schedule, kind: "手動用" };
    rerender(); toast("希望休だけの表を作りました");
  },
  curTap(id, d) {
    const ym = state.ui.month, sh = shiftOf(ym);
    if (!sh.cur) return;
    const sch = sh.cur.schedule, cur = (sch[id] || {})[d] || "";
    if (cur === "全") return;
    const next = cur === "" ? "公" : cur === "公" ? "希" : cur === "希" ? "有" : "";
    if (!sch[id]) sch[id] = {};
    if (next) sch[id][d] = next; else delete sch[id][d];
    if (sh.view === "manual" && sh.manual) sh.manual.schedule = sch;
    if ((sh.view === "A" || sh.view === "B") && sh.plans[sh.view]) sh.plans[sh.view].schedule = sch;
    save();
    // 表とチェックだけ出直す（全体再描画でも可だがスクロール維持のため部分更新）
    render4();
  },
  adopt() {
    const ym = state.ui.month, sh = shiftOf(ym);
    if (!sh.cur) return;
    const now = new Date().toISOString();
    sh.adopted = { schedule: JSON.parse(JSON.stringify(sh.cur.schedule)), kind: sh.cur.kind || "手動用", adoptedAt: now, updatedAt: now };
    save(); render4(); toast(ymLabel(ym) + " を正式なシフト表に採用しました");
  },
  printCur() {
    App.paperChange();
    const ym = state.ui.month, sh = shiftOf(ym);
    if (sh.cur) openPrint("shift", ym, sh.cur.schedule);
  },
  printPast(pym) {
    App.paperChange();
    const ad = state.shifts[pym].adopted; if (ad) openPrint("shift", pym, ad.schedule);
  },
  editPast(pym) { state.ui.editPast = pym; state.ui.month = pym; save(); render4(); },
  pastTap(id, d) {
    const pym = state.ui.editPast, ad = state.shifts[pym].adopted;
    const sch = ad.schedule, cur = (sch[id] || {})[d] || "";
    if (cur === "全") return;
    const next = cur === "" ? "公" : cur === "公" ? "希" : cur === "希" ? "有" : "";
    if (!sch[id]) sch[id] = {};
    if (next) sch[id][d] = next; else delete sch[id][d];
    save(); render4();
  },
  pastSave() {
    const pym = state.ui.editPast, ad = state.shifts[pym].adopted;
    ad.updatedAt = new Date().toISOString();
    state.ui.editPast = null; save(); render4(); toast("更新しました（翌月の前月末や平等化にも使われます）");
  },
  pastCancel() { state.ui.editPast = null; save(); render4(); },
  /* ⑤ */
  ioExport() { document.getElementById("ioText").value = exportString(baseDataObj()); },
  ioCopy() {
    const t = document.getElementById("ioText");
    if (!t.value) App.ioExport();
    t.select(); document.execCommand("copy");
    if (navigator.clipboard) navigator.clipboard.writeText(t.value);
    toast("コピーしました");
  },
  ioImport() {
    try {
      const o = importString(document.getElementById("ioText").value);
      if (o.kind === "full" && o.state) { state = o.state; }
      else applyBaseData(o);
      rerender(); toast("読み込みました（内容は全部入れ替わりました）");
    } catch (e) { toast("読み込めませんでした：" + e.message); }
  },
  ioSaveFile() {
    const str = exportString(baseDataObj());
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([str], { type: "text/plain" }));
    a.download = "shift-data.txt"; a.click(); URL.revokeObjectURL(a.href);
  },
  ioLoadFile(inp) {
    const f = inp.files[0]; if (!f) return;
    f.text().then(t => { document.getElementById("ioText").value = t; App.ioImport(); });
  },
  sendToAdmin() {
    const name = (document.getElementById("sendName").value || "").trim();
    if (!name) { toast("名前を入れてください"); return; }
    showConfirm("送る前の確認", `<p>${esc(name)} さんのデータ（今月の入力）を管理者に送ります。よろしいですか？<br><span class="sub">※ Muse版ではこの端末の中だけの疑似動作です。</span></p>`,
      [{ label: "やめる" }, { label: "送る", cls: "primary", fn() {
        state.inbox.push({ from: name, kind: "data", date: new Date().toISOString().slice(0, 10), text: state.ui.month + " の入力データ", str: exportString({ kind: "month", ym: state.ui.month, data: monthData(state.ui.month) }), handled: false });
        save(); renderHeader(); render5();
        showConfirm("送りました", `<p>管理者に送りました。管理者が確認して、必要ならデフォルトに登録します。そのままお待ちください。</p>`, [{ label: "OK", cls: "primary" }]);
      } }]);
  },
  inboxRegister(i) {
    const x = state.inbox[i];
    try {
      const o = importString(x.str || "");
      if (o.kind === "month") { state.months[o.ym] = o.data; }
      x.handled = true; save(); renderHeader(); render5(); toast("デフォルトに登録しました（疑似動作）");
    } catch (e) { toast("登録できませんでした：" + e.message); }
  },
  inboxDelete(i) { state.inbox.splice(i, 1); rerender(); },
  fbAdd() {
    const t = document.getElementById("fbText").value.trim();
    if (!t) { toast("要望を書いてください"); return; }
    state.feedback.unshift({ date: new Date().toISOString().slice(0, 10), text: t });
    save(); render5(); toast("要望をメモに残しました");
  },
  fbDelete(i) { state.feedback.splice(i, 1); rerender(); },
  exportCSV() {
    const ym = state.ui.month, sh = state.shifts[ym];
    const sch = (sh && sh.adopted && sh.adopted.schedule) || (sh && sh.cur && sh.cur.schedule);
    if (!sch) { toast("先に④でシフト表を作ってください"); return; }
    const D = daysIn(ym);
    const lines = [["社員番号", "名前", "所属", ...Array.from({ length: D }, (_, i) => i + 1), "休日日数", "出勤日数"].join(",")];
    sortedMembers().forEach(mem => {
      const s = sch[mem.id] || {}; let off = 0;
      const cells = Array.from({ length: D }, (_, i) => { const mk = s[i + 1] || ""; if (mk) off++; return mk; });
      lines.push([mem.id, mem.name, mem.org, ...cells, off, D - off].join(","));
    });
    const dw = dailyWorkOf(sch, ym);
    lines.push(["", "出勤人数合計", "", ...Array.from({ length: D }, (_, i) => dw[i + 1]), "", ""].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv" }));
    a.download = "shift-" + ym + ".csv"; a.click(); URL.revokeObjectURL(a.href);
  },
  autoToggle() { state.autoMode = !state.autoMode; state.ui.guideStep = 0; rerender(); },
  guideGo(tab) { gotoTab(tab); },
  guideNext() { state.ui.guideStep = Math.min((state.ui.guideStep || 0) + 1, 3); save(); renderGuide(); },
  guideOff() { state.autoMode = false; rerender(); toast("オートモードを切りました。手動で進めてください"); },
  /* 管理者 */
  closeAdmin() { document.getElementById("adminOverlay").classList.remove("show"); },
  userAdd() {
    const v = document.getElementById("admUserMail").value.trim();
    if (!v) { toast("メールアドレスを入れてください"); return; }
    state.users.push({ email: v, role: "利用者", protected: false });
    save(); renderAdmin();
  },
  adminAdd() {
    const v = document.getElementById("admAdminMail").value.trim();
    if (!v) { toast("メールアドレスを入れてください"); return; }
    state.users.push({ email: v, role: "管理者", protected: false });
    save(); renderAdmin(); toast("管理者を追加しました");
  },
  userRemove(i) {
    const u = state.users[i];
    if (u.protected) { toast("ソフト開発者は外せません"); return; }
    if (u.role === "管理者") {
      showConfirm("注意", `<p>管理者 ${esc(u.email)} を外しますか？外すと拠点のデータを変えられなくなります。</p>`,
        [{ label: "やめる" }, { label: "外す", cls: "primary", fn() { state.users.splice(i, 1); save(); renderAdmin(); renderHeader(); } }]);
    } else { state.users.splice(i, 1); save(); renderAdmin(); }
  },
  admTab(which) {
    const t = document.getElementById("admDataText"), base = document.getElementById("admBaseSel").value;
    if (which === "def") { const d = state.defaults[base]; t.value = d ? d.str : ""; }
    else if (which === "cur") t.value = exportString(baseDataObj());
    else t.value = "";
  },
  admRegister() {
    const base = document.getElementById("admBaseSel").value;
    const str = document.getElementById("admDataText").value.trim() || exportString(baseDataObj());
    const prev = state.defaults[base] || null;
    state.defaults[base] = { str, savedAt: new Date().toISOString(), memberCount: state.members.length, prev };
    save(); renderAdmin();
    showConfirm("登録しました", `<p>デフォルトに登録しました。ほかの端末には『新しいデータがあります』と出て、更新するとこの端末と同じ内容になります。</p><p class="sub">※ Muse版ではこの端末内だけの疑似動作です。</p>`, [{ label: "OK", cls: "primary" }]);
  },
  admApplyFrame() {
    try {
      const o = importString(document.getElementById("admDataText").value);
      applyBaseData(o); state.defaultAppliedAt = new Date().toISOString();
      save(); renderAdmin(); renderHeader(); rerender(); toast("枠のデータをこの端末に入れました");
    } catch (e) { toast("入れられませんでした：" + e.message); }
  },
  admShowPrev() {
    const base = document.getElementById("admBaseSel").value, d = state.defaults[base];
    const t = document.getElementById("admDataText");
    if (d && d.prev) { t.value = d.prev.str; toast("1つ前のデフォルトを表示しました"); }
    else toast("1つ前のデフォルトはありません");
  },
  baseAdd() {
    const v = document.getElementById("admNewBase").value.trim();
    if (!v) { toast("拠点名を入れてください"); return; }
    if (!state.bases.includes(v)) state.bases.push(v);
    save(); renderAdmin(); renderHeader();
  },
  baseDelete(b) {
    showConfirm("拠点の削除", `<p>拠点「${esc(b)}」を消しますか？その拠点のデータも消えます。</p>`,
      [{ label: "やめる" }, { label: "削除する", cls: "primary", fn() {
        state.bases = state.bases.filter(x => x !== b); delete state.defaults[b];
        if (state.baseName === b) state.baseName = state.bases[0] || "";
        save(); renderAdmin(); renderHeader(); rerender();
      } }]);
  },
  blankSheet() { App.paperChange(); openPrint("blank", state.ui.month, null); },
  applyDefault() {
    const d = state.defaults[state.baseName];
    if (!d) return;
    try { applyBaseData(importString(d.str)); state.defaultAppliedAt = new Date().toISOString(); rerender(); toast("新しいデータに入れ替えました"); }
    catch (e) { toast("入れ替えできませんでした：" + e.message); }
  },
  dismissUpdate() { state.defaultAppliedAt = state.defaults[state.baseName] ? state.defaults[state.baseName].savedAt : ""; save(); renderHeader(); }
};
window.App = App;
window.toast = toast;

/* ---------------- 初期化 ---------------- */
document.getElementById("tabNav").addEventListener("click", e => {
  const b = e.target.closest("button[data-tab]"); if (b) gotoTab(+b.dataset.tab);
});
let fitTimer = null; // 画面幅が変わったら印刷イメージの縮小率を合わせ直す
window.addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitPaperScales, 120); });
document.getElementById("btnAdmin").addEventListener("click", renderAdmin);
document.getElementById("adminOverlay").addEventListener("click", e => { if (e.target.id === "adminOverlay") App.closeAdmin(); });
document.getElementById("btnReload").addEventListener("click", () => { location.reload(); }); // 「最新」＝最新版チェック相当（再読み込み）
function applyTheme(light) {
  document.body.classList.toggle("light", light);
  document.getElementById("btnTheme").innerHTML = light ? "🌙 ダーク" : "☀️ ライト";
}
document.getElementById("btnTheme").addEventListener("click", () => {
  const light = !document.body.classList.contains("light");
  applyTheme(light);
  try { localStorage.setItem("museShiftTheme", light ? "light" : "dark"); } catch (e) {}
  toast(light ? "ライト表示にしました" : "ダーク表示にしました");
});
try { applyTheme(localStorage.getItem("museShiftTheme") === "light"); } catch (e) {}
document.getElementById("hBaseSel").addEventListener("change", e => { state.baseName = e.target.value; save(); renderHeader(); toast("拠点を " + state.baseName + " に切り替えました"); });
renderHeader();
gotoTab(state.ui.tab || 1);
