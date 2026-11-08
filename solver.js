/* solver.js — 回送員シフト表 計算エンジン（Muse版・JavaScript移植）
*
* 検証済みPython版（solver.py / check.py / common.py）の「計算仕様」を正本として
* JavaScriptに移植したもの。CP-SATは使えないため、制約充足は
* 「週ごとの二部マッチング（最大フロー）＋局所探索（焼きなまし）」で自前実装する。
*
* 入力JSONの形式はPython版と同一:
* { year_month, requests:{id:{kibou:[],yukyu:[]}}, zentai_kyu:[], busy_days:[],
* quiet_days:[], holidays:[], prev_month_last_week_offs:{id:n},
* prev_month_work_streak:{id:n}}
* 追加（アプリ拡張・Python版では未使用）:
* fixed_off:{id:[day]} … 「休」印の確定休み（印は「公」になる）
* day_required:{day:n} … 指定日の必要人数（出勤人数を n に固定）
*
* 条件JSONの形式もPython版と同一（common / per_person、キーは日本語）。
* 追加（アプリ拡張）: per_person の「連勤数」「連休回数」は個人上書きとして解釈する。
* ※「月末/月初」はPython版でも未実装のため、本エンジンでも未実装（対象外）。
*
* ブラウザ（window.ShiftSolver）と Node（module.exports）の両方で使える。
*/
(function (global) {
"use strict";

var WEEKDAY_JP = ["月", "火", "水", "木", "金", "土", "日"]; // index = Python weekday() (月0..日6)

// ---------- 暦（common.py の移植） ----------
function parseYearMonth(ym) {
var p = String(ym).split("-");
return [parseInt(p[0], 10), parseInt(p[1], 10)];
}
function daysInMonth(y, m) {
return new Date(y, m, 0).getDate();
}
function makeDate(y, m, d) {
return new Date(y, m - 1, d);
}
function pyWeekday(date) {
return (date.getDay() + 6) % 7; // 月0..日6
}
function addDays(date, n) {
return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}
function sameDay(a, b) {
return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function monthDates(ym) {
var ym2 = parseYearMonth(ym), y = ym2[0], m = ym2[1];
var nd = daysInMonth(y, m), out = [];
for (var d = 1; d <= nd; d++) out.push(makeDate(y, m, d));
return out;
}
function weeksOfMonth(ym) {
var dates = monthDates(ym);
var first = dates[0], last = dates[dates.length - 1];
var sunday = addDays(first, -((pyWeekday(first) + 1) % 7));
var weeks = [], cur = sunday;
while (cur <= last) {
var days = [];
for (var i = 0; i < 7; i++) days.push(addDays(cur, i));
var inDays = [];
days.forEach(function (d) {
if (d.getMonth() === first.getMonth() && d.getFullYear() === first.getFullYear()) inDays.push(d.getDate());
});
weeks.push({ start: days[0], end: days[6], dates: days, in_days: inDays});
cur = addDays(cur, 7);
}
return weeks;
}
function parseRangeJp(s) {
if (s === null || s === undefined) return null;
var nums = String(s).match(/\d+/g);
if (!nums) return null;
if (nums.length >= 2) return [parseInt(nums[0], 10), parseInt(nums[1], 10)];
return [parseInt(nums[0], 10), parseInt(nums[0], 10)];
}
function dayKind(date, holidaysSet) {
// holidaysSet: "y-m-d" 文字列の集合
if (date.getDay() === 0 || date.getDay() === 6 || holidaysSet.has(dateKey(date))) return "weekend";
return "weekday";
}
function dateKey(d) {
return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
}

// ---------- 条件（common.py Conditions の移植＋アプリ拡張） ----------
function Conditions(condData) {
condData = condData || {};
var common = condData.common || {};
this.maxStreak = parseInt(common["最大連勤"]!= null? common["最大連勤"]: 3, 10);
var rng = parseRangeJp(common["連休回数"]) || [1, 2];
this.renkyuMin = rng[0];
this.renkyuMax = rng[1];
this.tobiishiNashi = common["飛び石なし"]!== false;
this.perPerson = condData.per_person || {};
}
Conditions.prototype.person = function (memberId) {
var p = this.perPerson[memberId] || {};
var weekly = p["毎週どれか休み"] || [];
var weeklyWd = new Set();
weekly.forEach(function (w) {
var i = WEEKDAY_JP.indexOf(w);
if (i >= 0) weeklyWd.add(i);
});
var out = {
weeklyOffWeekdays: weeklyWd,
renkyuDay: p["連休の日"]!= null? p["連休の日"]: null,
weekendOffRange: parseRangeJp(p["土日祝休"]),
maxStreak: this.maxStreak,
renkyuMin: this.renkyuMin,
renkyuMax: this.renkyuMax
};
// アプリ拡張：個人の連勤数・連休回数の上書き
if (p["連勤数"]) {
var n = String(p["連勤数"]).match(/\d+/);
if (n) out.maxStreak = parseInt(n[0], 10);
}
if (p["連休回数"]) {
var r = parseRangeJp(p["連休回数"]);
if (r) { out.renkyuMin = r[0]; out.renkyuMax = r[1];}
}
return out;
};

function orderedMembers(membersData, inputData) {
var members = membersData.members.slice();
var byId = {};
members.forEach(function (m) { byId[m.id] = m;});
var order = inputData && inputData.display_order;
if (order && order.length) {
var out = [];
order.forEach(function (id) { if (byId[id]) out.push(byId[id]);});
members.forEach(function (m) { if (order.indexOf(m.id) < 0) out.push(m);});
return out;
}
return members.sort(function (a, b) { return a.id < b.id? -1: 1;});
}

// ---------- 乱数（シード付き） ----------
function mulberry32(seed) {
var a = seed >>> 0;
return function () {
a |= 0; a = (a + 0x6D2B79F5) | 0;
var t = Math.imul(a ^ (a >>> 15), 1 | a);
t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
}

// ---------- 最大フロー（Dinic法） ----------
function Dinic(n) {
this.n = n;
this.graph = [];
for (var i = 0; i < n; i++) this.graph.push([]);
}
Dinic.prototype.addEdge = function (from, to, cap) {
var fwd = { to: to, rev: this.graph[to].length, cap: cap };
var rev = { to: from, rev: this.graph[from].length, cap: 0 };
this.graph[from].push(fwd);
this.graph[to].push(rev);
};
Dinic.prototype.maxflow = function (s, t) {
var flow = 0, INF = 1e9, level, it, self = this;
function bfs() {
level = new Array(self.n).fill(-1);
var q = [s]; level[s] = 0;
while (q.length) {
var v = q.shift();
self.graph[v].forEach(function (e) {
if (e.cap > 0 && level[e.to] < 0) { level[e.to] = level[v] + 1; q.push(e.to);}
});
}
return level[t] >= 0;
}
function dfs(v, f) {
if (v === t) return f;
for (; it[v] < self.graph[v].length; it[v]++) {
var e = self.graph[v][it[v]];
if (e.cap > 0 && level[v] < level[e.to]) {
var d = dfs(e.to, Math.min(f, e.cap));
if (d > 0) {
e.cap -= d;
self.graph[e.to][e.rev].cap += d;
return d;
}
}
}
return 0;
}
while (bfs()) {
it = new Array(this.n).fill(0);
var f;
while ((f = dfs(s, INF)) > 0) flow += f;
}
return flow;
};

// ---------- 問題の構築 ----------
// opts: {minWork, maxNormal, busyMin, busyMax}（未指定はPython版の 10/11/11/12）
function buildContext(members, input, cond, opts, condDataRaw) {
opts = opts || {};
var ym = input.year_month;
var dates = monthDates(ym);
var D = dates.length;
var M = members.length;
var holidays = new Set();
(input.holidays || []).forEach(function (d) {
if (d >= 1 && d <= D) holidays.add(dateKey(dates[d - 1]));
});
var ctx = {
ym: ym, dates: dates, D: D, M: M, holidays: holidays,
zentai: new Set(input.zentai_kyu || []),
busy: new Set(input.busy_days || []),
quiet: new Set(input.quiet_days || []),
requests: input.requests || {},
fixedOffReq: input.fixed_off || {},
dayRequired: input.day_required || {},
prevOffs: input.prev_month_last_week_offs || {},
prevStreak: input.prev_month_work_streak || {},
weeks: weeksOfMonth(ym),
minWork: opts.minWork!= null? opts.minWork: 10,
maxNormal: opts.maxNormal!= null? opts.maxNormal: 11,
busyMin: opts.busyMin!= null? opts.busyMin: 11,
busyMax: opts.busyMax!= null? opts.busyMax: 12,
cond: cond,
condData: condDataRaw,
members: members
};
// 固定休み（全体休・希望休・有給・確定休み）
ctx.fixed = members.map(function (mem) {
var s = new Set(ctx.zentai);
var req = ctx.requests[mem.id] || {};
(req.kibou || []).concat(req.yukyu || []).forEach(function (d) { if (d >= 1 && d <= D) s.add(d);});
(ctx.fixedOffReq[mem.id] || []).forEach(function (d) { if (d >= 1 && d <= D) s.add(d);});
return s;
});
return ctx;
}

function dayOffRange(ctx, day) {
// その日の「休み人数」の許容範囲 [lo, hi]（全体休の日は呼び出し側で除外）
var M = ctx.M;
var req = ctx.dayRequired[day];
if (req!= null) {
var o = M - req;
return [o, o];
}
if (ctx.busy.has(day)) return [M - ctx.busyMax, M - ctx.busyMin];
if (ctx.quiet.has(day)) return [M - ctx.maxNormal, M];
return [M - ctx.maxNormal, M - ctx.minWork];
}
function dayOffPref(ctx, day) {
var req = ctx.dayRequired[day];
if (req!= null) return ctx.M - req;
if (ctx.busy.has(day)) return ctx.M - ctx.busyMin;
return ctx.M - ctx.minWork;
}

// 週ごとの必要休み数（Python版の近似ルールをそのまま踏襲）
function weekRequired(ctx, week, mi) {
var mem = ctx.members[mi];
var fixedCount = 0;
week.in_days.forEach(function (d) { if (ctx.fixed[mi].has(d)) fixedCount++;});
var isFirst = week.start < ctx.dates[0];
var isLast = week.end > ctx.dates[ctx.D - 1];
var base;
if (isFirst &&!isLast) {
var prev = ctx.prevOffs[mem.id];
base = prev!= null? 2 - parseInt(prev, 10): 2; // 先月分不明なら今月内で2日
} else if (isLast) {
base = Math.max(2, fixedCount); // 月末週は今月内で2日以上
} else {
base = 2;
}
return base;
}

// ---------- 初期解：週ごとのフロー割当て ----------
function initialAssignment(ctx, rng) {
var M = ctx.M, D = ctx.D;
var off = [];
for (var mi = 0; mi < M; mi++) {
var row = new Array(D).fill(0);
ctx.fixed[mi].forEach(function (d) { row[d - 1] = 1;});
off.push(row);
}
for (var wi = 0; wi < ctx.weeks.length; wi++) {
var week = ctx.weeks[wi];
var days = week.in_days.filter(function (d) { return!ctx.zentai.has(d);});
// 全員が全体休の週は割当て不要
var needs = [], totalNeed = 0;
for (var m2 = 0; m2 < M; m2++) {
var fixedInWeek = 0;
week.in_days.forEach(function (d) { if (ctx.fixed[m2].has(d)) fixedInWeek++;});
var need = weekRequired(ctx, week, m2) - fixedInWeek;
if (need < 0) return { error: ctx.members[m2].name + ": 週（" + week.start.getMonth() + 1 + "/" + week.start.getDate() + "〜）の固定休みが週2日を超えています"};
needs.push(need);
totalNeed += need;
}
if (totalNeed === 0) continue;
// 日ごとの目標休み人数（固定休みを差し引いた残り枠）
var okAssign = false;
for (var attempt = 0; attempt < 30 &&!okAssign; attempt++) {
var targets = {};
var sumTarget = 0;
days.forEach(function (d) {
var fixedCnt = 0;
for (var m3 = 0; m3 < M; m3++) if (ctx.fixed[m3].has(d)) fixedCnt++;
targets[d] = dayOffPref(ctx, d) - fixedCnt;
sumTarget += targets[d];
});
var diff = totalNeed - sumTarget;
var guard = 0;
while (diff!== 0 && guard++ < 500) {
var shuffled = days.slice();
shuffle(shuffled, rng);
var progressed = false;
for (var si = 0; si < shuffled.length && diff!== 0; si++) {
var dd = shuffled[si];
var drange = dayOffRange(ctx, dd);
var fixedCnt2 = 0;
for (var m4 = 0; m4 < M; m4++) if (ctx.fixed[m4].has(dd)) fixedCnt2++;
var cur = targets[dd] + fixedCnt2;
if (diff > 0 && cur < drange[1]) { targets[dd]++; diff--; progressed = true;}
else if (diff < 0 && cur > drange[0]) { targets[dd]--; diff++; progressed = true;}
}
if (!progressed) break;
}
if (diff!== 0) return { error: "週（" + (week.start.getMonth() + 1) + "/" + week.start.getDate() + "〜）の出勤人数の条件を満たせません"};
var badDay = days.some(function (d) { return targets[d] < 0;});
if (badDay) return { error: "固定休みが多すぎて出勤人数の上限を超える日があります"};
// フロー構築
var N = 2 + M + days.length;
var dinic = new Dinic(N);
var SRC = 0, SNK = N - 1;
var dayNode = {};
days.forEach(function (d, i) { dayNode[d] = 1 + M + i;});
// 辺の順序をシャッフルして多様性を出す
var memberOrder = range(M); shuffle(memberOrder, rng);
memberOrder.forEach(function (m5) {
if (needs[m5] > 0) dinic.addEdge(SRC, 1 + m5, needs[m5]);
var dayOrder = days.slice(); shuffle(dayOrder, rng);
dayOrder.forEach(function (d) {
if (!ctx.fixed[m5].has(d)) dinic.addEdge(1 + m5, dayNode[d], 1);
});
});
days.forEach(function (d) { if (targets[d] > 0) dinic.addEdge(dayNode[d], SNK, targets[d]);});
var flow = dinic.maxflow(SRC, SNK);
if (flow!== totalNeed) continue; // 目標配分を変えて再試行
// 割当て結果の読み取り（残余容量0の辺＝使用）
for (var m6 = 0; m6 < M; m6++) {
dinic.graph[1 + m6].forEach(function (e) {
if (dayNode[days[0]] <= e.to && e.to < SNK && e.cap === 0) {
var day = days[e.to - (1 + M)];
if (day!= null) off[m6][day - 1] = 1;
}
});
}
okAssign = true;
}
if (!okAssign) return { error: "週（" + (week.start.getMonth() + 1) + "/" + week.start.getDate() + "〜）の割り当てが見つかりませんでした"};
}
return { off: off};
}
function range(n) { var a = []; for (var i = 0; i < n; i++) a.push(i); return a;}
function shuffle(a, rng) {
for (var i = a.length - 1; i > 0; i--) {
var j = Math.floor(rng() * (i + 1));
var t = a[i]; a[i] = a[j]; a[j] = t;
}
return a;
}

// ---------- ペナルティ（check.py の判定基準に合わせる） ----------
function memberPenalty(ctx, mi, offRow, w) {
  var mem = ctx.members[mi];
  var pc = ctx.cond.person(mem.id);
  var D = ctx.D;
  var pen = 0, hard = 0;
  var i, d;
  var run = parseInt(ctx.prevStreak[mem.id] || 0, 10);
  var streakViol = 0;
  for (d = 1; d <= D; d++) {
    if (offRow[d - 1]) run = 0;
    else { run++; if (run > pc.maxStreak) { streakViol++; run = 0; } }
  }
  pen += w.streak * streakViol; hard += streakViol;
  var qual = 0, runs = 0;
  for (i = 1; i <= D - 1; i++) {
    if (ctx.zentai.has(i) || ctx.zentai.has(i + 1)) continue;
    if (offRow[i - 1] && offRow[i]) {
      if (i === 1 || !offRow[i - 2] || ctx.zentai.has(i - 1)) runs++;
      var k1 = dayKind(ctx.dates[i - 1], ctx.holidays);
      var k2 = dayKind(ctx.dates[i], ctx.holidays);
      var ok = true;
      if (pc.renkyuDay === "平日") ok = (k1 === "weekday" && k2 === "weekday");
      else if (pc.renkyuDay === "土日") ok = (k1 === "weekend" && k2 === "weekend");
      if (ok) qual++;
    }
  }
  if (qual < pc.renkyuMin) { pen += w.renkyu * (pc.renkyuMin - qual); hard += (pc.renkyuMin - qual); }
  if (runs > pc.renkyuMax) pen += w.renkyuExcess * (runs - pc.renkyuMax);
  var tb = 0, iso = 0;
  for (d = 2; d <= D - 1; d++) {
    if (offRow[d - 2] && !offRow[d - 1] && offRow[d]) tb++;
    if (!offRow[d - 2] && offRow[d - 1] && !offRow[d]) iso++;
  }
  var prev = ctx.prevOffs[mem.id];
  if (prev != null && parseInt(prev, 10) >= 2 && D >= 2) {
    if (!offRow[0] && offRow[1]) tb++;
  }
  pen += w.tobiishi * tb + w.isolated * iso;
  if (pc.weeklyOffWeekdays.size) {
    var wv = 0;
    ctx.weeks.forEach(function (week) {
      var cand = [];
      pc.weeklyOffWeekdays.forEach(function (wd) {
        var dd = addDays(week.start, (wd + 1) % 7);
        if (dd.getMonth() === ctx.dates[0].getMonth() && dd.getFullYear() === ctx.dates[0].getFullYear()) cand.push(dd.getDate());
      });
      if (cand.length && !cand.some(function (cd) { return offRow[cd - 1]; })) wv++;
    });
    pen += w.weekly * wv; hard += wv;
  }
  var weekendViol = 0;
  if (pc.weekendOffRange) {
    var n = 0;
    for (d = 1; d <= D; d++) {
      if (offRow[d - 1] && dayKind(ctx.dates[d - 1], ctx.holidays) === "weekend") n++;
    }
    var lo = pc.weekendOffRange[0], hi = pc.weekendOffRange[1];
    var wdist = n < lo ? lo - n : (n > hi ? n - hi : 0);
    pen += w.weekend * wdist; hard += wdist; weekendViol = wdist;
  }
  // hard の内訳（救済フェーズで使う）。weekly 違反数は pen から逆算できないため再計算する
  var weeklyViol = 0;
  if (pc.weeklyOffWeekdays.size) {
    ctx.weeks.forEach(function (week) {
      var cand = [];
      pc.weeklyOffWeekdays.forEach(function (wd) {
        var dd = addDays(week.start, (wd + 1) % 7);
        if (dd.getMonth() === ctx.dates[0].getMonth() && dd.getFullYear() === ctx.dates[0].getFullYear()) cand.push(dd.getDate());
      });
      if (cand.length && !cand.some(function (cd) { return offRow[cd - 1]; })) weeklyViol++;
    });
  }
  var renkyuDef = Math.max(0, pc.renkyuMin - qual);
  return { pen: pen, hard: hard, tobiishi: tb, parts: { streak: streakViol, renkyuDef: renkyuDef, weekly: weeklyViol, weekend: weekendViol } };
}

function evalMember(ctx, mi, offRow, w) { return memberPenalty(ctx, mi, offRow, w).pen; }
function hardMember(ctx, mi, offRow, w) { return memberPenalty(ctx, mi, offRow, w).hard; }

// 全ての有効な cross-swap を列挙する（[m1, m2, d1, d2]、m1はd1休・d2出、m2はd2休・d1出）
function allSwaps(ctx, off) {
  var M = ctx.M, out = [];
  ctx.weeks.forEach(function (week) {
    var days = week.in_days.filter(function (d) { return !ctx.zentai.has(d); });
    for (var a = 0; a < M; a++) for (var b = 0; b < M; b++) {
      if (a === b) continue;
      days.forEach(function (d1) {
        if (off[a][d1 - 1] !== 1 || ctx.fixed[a].has(d1) || off[b][d1 - 1] !== 0) return;
        days.forEach(function (d2) {
          if (d2 !== d1 && off[b][d2 - 1] === 1 && !ctx.fixed[b].has(d2) && off[a][d2 - 1] === 0) out.push([a, b, d1, d2]);
        });
      });
    }
  });
  return out;
}
function applySwapArr(off, s) {
  off[s[0]][s[2] - 1] = 0; off[s[0]][s[3] - 1] = 1; off[s[1]][s[3] - 1] = 0; off[s[1]][s[2] - 1] = 1;
}
function revertSwapArr(off, s) {
  off[s[0]][s[2] - 1] = 1; off[s[0]][s[3] - 1] = 0; off[s[1]][s[3] - 1] = 1; off[s[1]][s[2] - 1] = 0;
}
function totalHard(ctx, off, w) {
  var t = 0;
  for (var mi = 0; mi < ctx.M; mi++) t += hardMember(ctx, mi, off[mi], w);
  return t;
}
// 探索用の hard スコア：違反の種類に重みを付ける（連勤は直しにくいので重い）。
// 「連勤1件」より「連休不足2件」の方が修復しやすいため、単純な件数比較では
// 連勤のある状態が勝ってしまい、plateau を越えた状態が捨てられてしまう。
function hardScore(ctx, off, w) {
  var s = 0;
  for (var mi = 0; mi < ctx.M; mi++) {
    var p = memberPenalty(ctx, mi, off[mi], w).parts;
    s += p.streak * 3 + p.weekly * 2 + p.weekend * 2 + p.renkyuDef;
  }
  return s;
}

// ハード違反の深さ2修復：違反メンバーへの swap で直らなければ、
// その swap で傷ついたメンバーの補償 swap まで探す
function repairPhase(ctx, off, weights, rng) {
  var M = ctx.M;
  var guard = 0;
  while (guard++ < 60) {
    var hardNow = totalHard(ctx, off, weights);
    if (hardNow === 0) return true;
    // 最もハード違反の多いメンバー
    var target = -1, targetHard = 0;
    for (var mi = 0; mi < M; mi++) {
      var h = hardMember(ctx, mi, off[mi], weights);
      if (h > targetHard) { targetHard = h; target = mi; }
    }
    if (target < 0) return true;
    var swaps = allSwaps(ctx, off);
    var involving = swaps.filter(function (s) { return s[0] === target || s[1] === target; });
    shuffle(involving, rng);
    var applied = false;
    // 深さ1
    for (var i1 = 0; i1 < involving.length && !applied; i1++) {
      applySwapArr(off, involving[i1]);
      if (totalHard(ctx, off, weights) < hardNow) applied = true;
      else revertSwapArr(off, involving[i1]);
    }
    // 深さ2
    if (!applied) {
      outer:
      for (var j1 = 0; j1 < involving.length && !applied; j1++) {
        var s1 = involving[j1];
        applySwapArr(off, s1);
        var hurt = new Set([s1[0], s1[1], target]);
        var swaps2 = allSwaps(ctx, off).filter(function (s) { return hurt.has(s[0]) || hurt.has(s[1]); });
        shuffle(swaps2, rng);
        for (var j2 = 0; j2 < swaps2.length; j2++) {
          applySwapArr(off, swaps2[j2]);
          if (totalHard(ctx, off, weights) < hardNow) { applied = true; break; }
          revertSwapArr(off, swaps2[j2]);
        }
        if (!applied) revertSwapArr(off, s1);
      }
    }
    if (!applied) return false;
  }
  return totalHard(ctx, off, weights) === 0;
}

// ---------- 救済フェーズ ----------
// 連勤違反が「直すと連休が壊れる」plateau に嵌ったときの最終手段。
// 連勤（と毎週・土日祝休）違反を減らす swap を、全体の hard が一時的に
// 増えても先に適用し、その後 repair + descend で連休などを直し直す。
// 元より hard が減った場合だけ採用し、ダメなら元に戻す。
function desperateRepair(ctx, off, weights, rng) {
  var startHard = totalHard(ctx, off, weights);
  if (startHard === 0) return true;
  var snapshot = off.map(function (r) { return r.slice(); });
  function restore() { for (var i = 0; i < ctx.M; i++) off[i] = snapshot[i].slice(); }
  // 関係メンバーだけの swap で降下する軽量版（全体降下は重いため使わない）
  function descendMembers(memberSet, maxPass) {
    var pens = [];
    for (var r = 0; r < ctx.M; r++) pens.push(evalMember(ctx, r, off[r], weights));
    var improved = true, pass = 0;
    while (improved && pass++ < maxPass) {
      improved = false;
      var cands = allSwaps(ctx, off).filter(function (s) { return memberSet.has(s[0]) || memberSet.has(s[1]); });
      shuffle(cands, rng);
      for (var i = 0; i < cands.length; i++) {
        var s = cands[i], m1 = s[0], m2 = s[1];
        applySwapArr(off, s);
        var np1 = evalMember(ctx, m1, off[m1], weights), np2 = evalMember(ctx, m2, off[m2], weights);
        if ((np1 + np2) - (pens[m1] + pens[m2]) < 0) { pens[m1] = np1; pens[m2] = np2; improved = true; break; }
        revertSwapArr(off, s);
      }
    }
  }
  // hard優先の降下：触る2人の hard 合計が減る swap を、pen が増えても採用する
  function descendHard(memberSet, maxPass) {
    var improved = true, pass = 0;
    while (improved && pass++ < maxPass) {
      improved = false;
      var cands = allSwaps(ctx, off).filter(function (s) { return memberSet.has(s[0]) || memberSet.has(s[1]); });
      shuffle(cands, rng);
      for (var i = 0; i < cands.length; i++) {
        var s = cands[i], m1 = s[0], m2 = s[1];
        var hb = hardMember(ctx, m1, off[m1], weights) + hardMember(ctx, m2, off[m2], weights);
        var pb = evalMember(ctx, m1, off[m1], weights) + evalMember(ctx, m2, off[m2], weights);
        applySwapArr(off, s);
        var ha = hardMember(ctx, m1, off[m1], weights) + hardMember(ctx, m2, off[m2], weights);
        var pa = evalMember(ctx, m1, off[m1], weights) + evalMember(ctx, m2, off[m2], weights);
        if (ha < hb || (ha === hb && pa < pb)) { improved = true; break; }
        revertSwapArr(off, s);
      }
    }
  }
  // 連勤違反のあるメンバーを集める
  var targets = [];
  for (var mi = 0; mi < ctx.M; mi++) {
    if (memberPenalty(ctx, mi, off[mi], weights).parts.streak > 0) targets.push(mi);
  }
  if (!targets.length) return false;
  var cands = allSwaps(ctx, off).filter(function (s) { return targets.indexOf(s[0]) >= 0 || targets.indexOf(s[1]) >= 0; });
  shuffle(cands, rng);
  var tried = 0;
  for (var ci = 0; ci < cands.length && tried < 8; ci++) {
    var s = cands[ci];
    // この swap で対象メンバーの連勤違反が減るものだけ試す
    var beforeStreak = 0;
    targets.forEach(function (t) { beforeStreak += memberPenalty(ctx, t, off[t], weights).parts.streak; });
    applySwapArr(off, s);
    var afterStreak = 0;
    targets.forEach(function (t) { afterStreak += memberPenalty(ctx, t, off[t], weights).parts.streak; });
    if (afterStreak >= beforeStreak) { revertSwapArr(off, s); continue; }
    tried++;
    // swap で傷ついた可能性のあるメンバー（hard>0 の全員）を対象に直し直す
    var hurt = new Set([s[0], s[1]]);
    targets.forEach(function (t) { hurt.add(t); });
    for (var h = 0; h < ctx.M; h++) if (hardMember(ctx, h, off[h], weights) > 0) hurt.add(h);
    descendHard(hurt, 30);
    if (totalHard(ctx, off, weights) >= startHard) {
      // hard優先で届かなければ pen 降下も試す
      for (var h2 = 0; h2 < ctx.M; h2++) if (hardMember(ctx, h2, off[h2], weights) > 0) hurt.add(h2);
      descendMembers(hurt, 80);
    }
    if (totalHard(ctx, off, weights) < startHard) return true;
    restore();
  }
  restore();
  return false;
}

// 1人だけの move：同じ週の中で休みを別の日に移す（週の休み数は不変、
// 日の出勤人数は許容範囲の中でのみ増減する）。swap だけでは日の人数が
// 固定されてしまい、閑散日に休みを寄せるような解に到達できないため必要。
function allMoves(ctx, off) {
  var out = [];
  var offCount = {};
  for (var d = 1; d <= ctx.D; d++) {
    var n = 0;
    for (var m = 0; m < ctx.M; m++) if (off[m][d - 1]) n++;
    offCount[d] = n;
  }
  ctx.weeks.forEach(function (week) {
    var days = week.in_days.filter(function (d) { return !ctx.zentai.has(d); });
    for (var mi = 0; mi < ctx.M; mi++) {
      days.forEach(function (dFrom) {
        if (off[mi][dFrom - 1] !== 1 || ctx.fixed[mi].has(dFrom)) return;
        days.forEach(function (dTo) {
          if (dTo === dFrom || off[mi][dTo - 1] !== 0) return;
          var rFrom = dayOffRange(ctx, dFrom), rTo = dayOffRange(ctx, dTo);
          if (offCount[dFrom] - 1 < rFrom[0]) return; // 出勤が上限を超える
          if (offCount[dTo] + 1 > rTo[1]) return;     // 出勤が下限を割る
          out.push([mi, dFrom, dTo]);
        });
      });
    }
  });
  return out;
}

// ---------- hard仕上げ（違反種類の優先順位つき貪欲法） ----------
// hard を直接減らす swap が無い plateau では「連勤を直すと連休が壊れる」
// ように種類の違う違反への置き換えが必要になる。そこで違反の種類に
// 優先順位（連勤＞毎週＞土日祝休＞連休不足）を付け、今ある最優先の種類を
// 触る2人について確実に減らす swap を選び続ける（次点で全体hard、pen）。
// ベスト状態は保持し、届かなければ元に戻す。
function hardPolish(ctx, off, weights, rng, maxSteps) {
  var TYPES = ["streak", "weekly", "weekend", "renkyuDef"];
  var limit = maxSteps || 60;
  var bestOff = off.map(function (r) { return r.slice(); });
  var bestHard = totalHard(ctx, off, weights);
  if (bestHard === 0) return true;
  function partsOf(mi) { return memberPenalty(ctx, mi, off[mi], weights); }
  for (var step = 0; step < limit; step++) {
    if (totalHard(ctx, off, weights) === 0) { return true; }
    // 今ある最優先の違反種類と、そのメンバー
    var targetType = null, targets = [];
    for (var ti = 0; ti < TYPES.length && !targetType; ti++) {
      var tt = [];
      for (var mi = 0; mi < ctx.M; mi++) if (partsOf(mi).parts[TYPES[ti]] > 0) tt.push(mi);
      if (tt.length) { targetType = TYPES[ti]; targets = tt; }
    }
    if (!targetType) return true;
    var swaps = allSwaps(ctx, off).filter(function (s) { return targets.indexOf(s[0]) >= 0 || targets.indexOf(s[1]) >= 0; });
    var moves = allMoves(ctx, off).filter(function (mv) { return targets.indexOf(mv[0]) >= 0; });
    // 2段ローテーション：対象メンバーの move 先が満員で無効なとき、
    // その日の持ち主が別の日へ移る手と組み合わせる（日の人数は保たれる）
    var rotations = [];
    (function () {
      var offCount = {};
      for (var d = 1; d <= ctx.D; d++) { var n = 0; for (var m = 0; m < ctx.M; m++) if (off[m][d - 1]) n++; offCount[d] = n; }
      ctx.weeks.forEach(function (week) {
        var days = week.in_days.filter(function (d) { return !ctx.zentai.has(d); });
        targets.forEach(function (t) {
          days.forEach(function (dFrom) {
            if (off[t][dFrom - 1] !== 1 || ctx.fixed[t].has(dFrom)) return;
            days.forEach(function (dTo) {
              if (dTo === dFrom || off[t][dTo - 1] !== 0) return;
              var rTo = dayOffRange(ctx, dTo);
              if (offCount[dTo] + 1 <= rTo[1]) return; // 通常の move で足りる
              // dTo の持ち主 b が d3 へ移る
              for (var b = 0; b < ctx.M; b++) {
                if (b === t || off[b][dTo - 1] !== 1 || ctx.fixed[b].has(dTo)) continue;
                days.forEach(function (d3) {
                  if (d3 === dTo || off[b][d3 - 1] !== 0) return;
                  var r3 = dayOffRange(ctx, d3);
                  var cnt3 = offCount[d3] + (d3 === dFrom ? -1 : 0);
                  if (cnt3 + 1 > r3[1]) return;
                  var rFrom = dayOffRange(ctx, dFrom);
                  if (offCount[dFrom] - 1 < rFrom[0]) return;
                  rotations.push({ t: t, from: dFrom, to: dTo, b: b, bTo: d3 });
                });
              }
            });
          });
        });
      });
    })();
    if (!swaps.length && !moves.length && !rotations.length) break;
    var bestS = null, bestKey = null;
    for (var i = 0; i < swaps.length; i++) {
      var s = swaps[i], m1 = s[0], m2 = s[1];
      applySwapArr(off, s);
      var p1 = partsOf(m1), p2 = partsOf(m2);
      revertSwapArr(off, s);
      var key = [p1.parts[targetType] + p2.parts[targetType], p1.hard + p2.hard, p1.pen + p2.pen];
      if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))) { bestKey = key; bestS = { swap: s }; }
    }
    for (var j2 = 0; j2 < moves.length; j2++) {
      var mv = moves[j2], mm = mv[0];
      off[mm][mv[1] - 1] = 0; off[mm][mv[2] - 1] = 1;
      var pm = partsOf(mm);
      off[mm][mv[1] - 1] = 1; off[mm][mv[2] - 1] = 0;
      var keym = [pm.parts[targetType], pm.hard, pm.pen];
      if (!bestKey || keym[0] < bestKey[0] || (keym[0] === bestKey[0] && (keym[1] < bestKey[1] || (keym[1] === bestKey[1] && keym[2] < bestKey[2])))) { bestKey = keym; bestS = { move: mv }; }
    }
    for (var j3 = 0; j3 < rotations.length; j3++) {
      var rt = rotations[j3];
      off[rt.t][rt.from - 1] = 0; off[rt.t][rt.to - 1] = 1;
      off[rt.b][rt.to - 1] = 0; off[rt.b][rt.bTo - 1] = 1;
      var pt = partsOf(rt.t), pb = partsOf(rt.b);
      off[rt.t][rt.from - 1] = 1; off[rt.t][rt.to - 1] = 0;
      off[rt.b][rt.to - 1] = 1; off[rt.b][rt.bTo - 1] = 0;
      var keyr = [pt.parts[targetType] + pb.parts[targetType], pt.hard + pb.hard, pt.pen + pb.pen];
      if (!bestKey || keyr[0] < bestKey[0] || (keyr[0] === bestKey[0] && (keyr[1] < bestKey[1] || (keyr[1] === bestKey[1] && keyr[2] < bestKey[2])))) { bestKey = keyr; bestS = { rot: rt }; }
    }
    if (!bestS) break;
    if (bestS.swap) applySwapArr(off, bestS.swap);
    else if (bestS.move) { var bm = bestS.move; off[bm[0]][bm[1] - 1] = 0; off[bm[0]][bm[2] - 1] = 1; }
    else { var br = bestS.rot; off[br.t][br.from - 1] = 0; off[br.t][br.to - 1] = 1; off[br.b][br.to - 1] = 0; off[br.b][br.bTo - 1] = 1; }
    var th = totalHard(ctx, off, weights);
    if (th < bestHard) { bestHard = th; bestOff = off.map(function (r) { return r.slice(); }); if (th === 0) return true; }
  }
  for (var j = 0; j < ctx.M; j++) off[j] = bestOff[j].slice();
  return bestHard === 0;
}

// ---------- 焼きなまし（対象サンプリング＋ダブルswap） ----------
function annealTargeted(ctx, off, pens, weights, rng, iterations) {
  var M = ctx.M;
  var sw = {};
  Object.keys(weights).forEach(function (k) { sw[k] = weights[k] / 100; });
  // 探索上の誘導：連勤違反は連休不足より重く見る。連勤を直す一手は
  // 連休を2人分壊すことがあり、同点だと anneal がその一手を選ばないため。
  sw.streak *= 3;
  var spens = [], total = 0;
  for (var mi = 0; mi < M; mi++) { spens.push(evalMember(ctx, mi, off[mi], sw)); total += spens[mi]; }
  var weekList = ctx.weeks.map(function (w) { return w.in_days.filter(function (d) { return !ctx.zentai.has(d); }); });
  function sampleSwap() {
    var wi = Math.floor(rng() * weekList.length);
    var days = weekList[wi];
    if (days.length < 2) return null;
    var m1 = Math.floor(rng() * M);
    var offs1 = days.filter(function (d) { return off[m1][d - 1] === 1 && !ctx.fixed[m1].has(d); });
    if (!offs1.length) return null;
    var d1 = offs1[Math.floor(rng() * offs1.length)];
    var works1 = days.filter(function (d) { return off[m1][d - 1] === 0; });
    if (!works1.length) return null;
    var d2 = works1[Math.floor(rng() * works1.length)];
    var partners = [];
    for (var m = 0; m < M; m++) {
      if (m !== m1 && off[m][d2 - 1] === 1 && off[m][d1 - 1] === 0 && !ctx.fixed[m].has(d2) && !ctx.fixed[m].has(d1)) partners.push(m);
    }
    if (!partners.length) return null;
    return [m1, partners[Math.floor(rng() * partners.length)], d1, d2];
  }
  var T0 = 25, T1 = 0.15;
  var bestOff = off.map(function (r) { return r.slice(); });
  var bestTotal = total;
  for (var iter = 0; iter < iterations; iter++) {
    var T = T0 * Math.pow(T1 / T0, iter / iterations);
    var nSwaps = rng() < 0.35 ? 2 : 1;
    var swaps = [], membersSet = new Set(), okSwaps = true;
    for (var si = 0; si < nSwaps; si++) {
      var s = sampleSwap();
      if (!s) { okSwaps = false; break; }
      var cellsOf = function (x) { return [x[0] + "|" + x[2], x[0] + "|" + x[3], x[1] + "|" + x[2], x[1] + "|" + x[3]]; };
      var newCells = cellsOf(s);
      var overlap = swaps.some(function (x) {
        var xc = cellsOf(x);
        return newCells.some(function (c) { return xc.indexOf(c) >= 0; });
      });
      if (overlap) { okSwaps = false; break; }
      swaps.push(s); membersSet.add(s[0]); membersSet.add(s[1]);
    }
    if (!okSwaps || !swaps.length) continue;
    var before = 0;
    membersSet.forEach(function (m) { before += spens[m]; });
    swaps.forEach(function (s2) { applySwapArr(off, s2); });
    var after = 0, newPens = {};
    membersSet.forEach(function (m) { newPens[m] = evalMember(ctx, m, off[m], sw); after += newPens[m]; });
    var delta = after - before;
    if (delta <= 0 || rng() < Math.exp(-delta / T)) {
      membersSet.forEach(function (m) { spens[m] = newPens[m]; });
      total += delta;
      if (total < bestTotal) { bestTotal = total; bestOff = off.map(function (r) { return r.slice(); }); }
    } else {
      swaps.slice().reverse().forEach(function (s3) { revertSwapArr(off, s3); });
    }
  }
  for (var c = 0; c < M; c++) off[c] = bestOff[c];
  for (var m3 = 0; m3 < M; m3++) pens[m3] = evalMember(ctx, m3, off[m3], weights);
  return pens.reduce(function (s, x) { return s + x; }, 0);
}

// ---------- 局所探索（降下法） ----------
function descendAll(ctx, off, pens, weights, rng) {
  var M = ctx.M;
  var total = pens.reduce(function (s, x) { return s + x; }, 0);
  function tryApplyS(s) {
    var m1 = s[0], m2 = s[1], d1 = s[2], d2 = s[3];
    applySwapArr(off, s);
    var np1 = evalMember(ctx, m1, off[m1], weights), np2 = evalMember(ctx, m2, off[m2], weights);
    var delta = (np1 + np2) - (pens[m1] + pens[m2]);
    if (delta < 0) { pens[m1] = np1; pens[m2] = np2; total += delta; return true; }
    revertSwapArr(off, s);
    return false;
  }
  var improved = true, guard = 0;
  while (improved && guard++ < 300) {
    improved = false;
    var cands = allSwaps(ctx, off);
    shuffle(cands, rng);
    for (var i = 0; i < cands.length; i++) {
      if (tryApplyS(cands[i])) { improved = true; break; }
    }
  }
  return total;
}

function localSearch(ctx, off, weights, seed, rounds, annealIters) {
  var rng = mulberry32(seed);
  var M = ctx.M;
  var pens = [];
  for (var mi = 0; mi < M; mi++) pens.push(evalMember(ctx, mi, off[mi], weights));
  annealTargeted(ctx, off, pens, weights, rng, annealIters || 150000);
  repairPhase(ctx, off, weights, rng);
  for (var r = 0; r < M; r++) pens[r] = evalMember(ctx, r, off[r], weights);
  var total = descendAll(ctx, off, pens, weights, rng);
  if (totalHard(ctx, off, weights) > 0) {
    desperateRepair(ctx, off, weights, rng);
    for (var r0 = 0; r0 < M; r0++) pens[r0] = evalMember(ctx, r0, off[r0], weights);
    total = descendAll(ctx, off, pens, weights, rng);
  }
  var best = off.map(function (row) { return row.slice(); });
  var bestPen = total;
  var bestHard = totalHard(ctx, off, weights);
  var bestScore = hardScore(ctx, off, weights);
  for (var round = 0; round < rounds; round++) {
    if (bestHard === 0 && bestPen <= 0) break;
    // キック：ランダム swap を数回（1回ごとに有効な swap を再計算する。
    // 古いリストを流用すると前提の出欠が変わって週・日の合計が壊れる）
    var kicks = 2 + Math.floor(rng() * 5);
    for (var k = 0; k < kicks; k++) {
      var swaps = allSwaps(ctx, off);
      if (!swaps.length) break;
      applySwapArr(off, swaps[Math.floor(rng() * swaps.length)]);
    }
    repairPhase(ctx, off, weights, rng);
    for (var r2 = 0; r2 < M; r2++) pens[r2] = evalMember(ctx, r2, off[r2], weights);
    total = descendAll(ctx, off, pens, weights, rng);
    var hardNow = totalHard(ctx, off, weights);
    var scoreNow = hardScore(ctx, off, weights);
    if (scoreNow < bestScore || (scoreNow === bestScore && total < bestPen)) {
      bestHard = hardNow; bestScore = scoreNow; bestPen = total; best = off.map(function (row) { return row.slice(); });
    } else {
      off = best.map(function (row) { return row.slice(); });
      for (var r3 = 0; r3 < M; r3++) pens[r3] = evalMember(ctx, r3, off[r3], weights);
      total = bestPen;
    }
  }
  // 最後に、ベスト解へ救済フェーズと hard仕上げを1回だけ試す
  if (bestHard > 0) {
    var off2 = best.map(function (row) { return row.slice(); });
    desperateRepair(ctx, off2, weights, rng);
    hardPolish(ctx, off2, weights, rng, 60);
    if (hardScore(ctx, off2, weights) < bestScore) {
      best = off2;
      bestHard = totalHard(ctx, best, weights);
      bestPen = 0;
      for (var q = 0; q < M; q++) bestPen += evalMember(ctx, q, best[q], weights);
    }
  }
  return { off: best, penalty: bestPen };
}

var WEIGHTS = {
A: { streak: 10000, renkyu: 10000, renkyuExcess: 60, tobiishi: 900, isolated: 25, weekly: 10000, weekend: 10000},
B: { streak: 10000, renkyu: 10000, renkyuExcess: 200, tobiishi: 250, isolated: 90, weekly: 10000, weekend: 10000}
};

function solvePlan(ctx, plan, seed, iterations, annealIters) {
  var weights = WEIGHTS[plan] || WEIGHTS.A;
  var bestResult = null;
  for (var attempt = 0; attempt < 4; attempt++) {
    var rng = mulberry32(seed + attempt * 31337);
    var init = initialAssignment(ctx, rng);
    if (init.error) return { status: "INFEASIBLE", error: init.error, schedule: null };
    var result = localSearch(ctx, init.off, weights, seed + attempt * 777 + 7, iterations || 150, annealIters);
    if (totalHard(ctx, result.off, weights) > 0) {
      var rngP = mulberry32(seed + attempt * 999 + 5);
      hardPolish(ctx, result.off, weights, rngP, 120);
    }
    var off = result.off;
    var schedule = {}, dailyWork = {};
    ctx.members.forEach(function (mem, mi) {
      var req = ctx.requests[mem.id] || {};
      var kibou = new Set(req.kibou || []), yukyu = new Set(req.yukyu || []);
      var days = {};
      for (var d = 1; d <= ctx.D; d++) {
        if (off[mi][d - 1]) {
          days[d] = ctx.zentai.has(d) ? "全" : kibou.has(d) ? "希" : yukyu.has(d) ? "有" : "公";
        }
      }
      schedule[mem.id] = days;
    });
    for (var d2 = 1; d2 <= ctx.D; d2++) {
      var n = 0;
      for (var m = 0; m < ctx.M; m++) if (!off[m][d2 - 1]) n++;
      dailyWork[d2] = n;
    }
    var tbTotal = 0;
    ctx.members.forEach(function (mem, mi) { tbTotal += memberPenalty(ctx, mi, off[mi], { streak: 0, renkyu: 0, renkyuExcess: 0, tobiishi: 1, isolated: 0, weekly: 0, weekend: 0 }).tobiishi; });
    var membersData = { members: ctx.members };
    var inputLike = {
      year_month: ctx.ym, requests: ctx.requests, zentai_kyu: Array.from(ctx.zentai),
      busy_days: Array.from(ctx.busy), quiet_days: Array.from(ctx.quiet),
      holidays: [], prev_month_last_week_offs: ctx.prevOffs, prev_month_work_streak: ctx.prevStreak
    };
    var v = verifyShift(membersData, inputLike, ctx.condData || null, schedule, tbTotal > 0);
    var candidate = {
      status: v.violations.length === 0 ? "OPTIMAL" : "FEASIBLE",
      penalty: result.penalty,
      violations: v.violations.length,
      hardScore: hardScore(ctx, off, weights),
      tobiishi_soft: tbTotal > 0,
      tobiishi_count: tbTotal,
      schedule: schedule,
      daily_work: dailyWork
    };
    if (!bestResult || candidate.hardScore < bestResult.hardScore ||
        (candidate.hardScore === bestResult.hardScore && candidate.violations < bestResult.violations) ||
        (candidate.hardScore === bestResult.hardScore && candidate.violations === bestResult.violations && candidate.penalty < bestResult.penalty)) {
      bestResult = candidate;
    }
    if (v.violations.length === 0) break;
  }
  return bestResult;
}

// membersData: {members:[...]}, input: 入力JSON, condData: 条件JSON
function solveShift(membersData, input, condData, opts) {
opts = opts || {};
var members = orderedMembers(membersData, input);
var cond = new Conditions(condData);
var ctx = buildContext(members, input, cond, opts, condData);
var plans = {};
var planList = opts.plans || ["A", "B"];
planList.forEach(function (plan, idx) {
var seed = (opts.seed!= null? opts.seed: 12345) + idx * 1000 + (plan === "B"? 500: 0);
plans[plan] = solvePlan(ctx, plan, seed, opts.iterations, opts.annealIters);
});
return { year_month: input.year_month, plans: plans};
}

// ---------- 検証（check.py verify の移植） ----------
function verifyShift(membersData, input, condData, schedule, tobiishiSoft) {
var members = orderedMembers(membersData, input);
var cond = new Conditions(condData);
var V = [], W = [];
var ym = input.year_month;
var dates = monthDates(ym);
var D = dates.length;
var holidays = new Set();
(input.holidays || []).forEach(function (d) { if (d >= 1 && d <= D) holidays.add(dateKey(dates[d - 1]));});
var zentai = new Set(input.zentai_kyu || []);
var busy = new Set(input.busy_days || []);
var quiet = new Set(input.quiet_days || []);
var dayRequired = input.day_required || {};
var requests = input.requests || {};
var prevOffs = input.prev_month_last_week_offs || {};
var prevStreak = input.prev_month_work_streak || {};
var M = members.length;
var off = {};
members.forEach(function (mem) {
var mid = mem.id;
var days = schedule[mid];
if (!days) { V.push(mem.name + ": 解にメンバーが含まれていません"); days = {};}
Object.keys(days).forEach(function (dk) {
var d = parseInt(dk, 10), mk = days[dk];
if (!(d >= 1 && d <= D)) V.push(mem.name + ": 月に存在しない日 " + d + " に印があります");
if (["公", "希", "有", "全"].indexOf(mk) < 0) V.push(mem.name + ": " + d + "日 に不明な印 '" + mk + "'");
});
for (var d = 1; d <= D; d++) off[mid + "|" + d] = days[d]!= null;
});
function isOff(mid, d) { return!!off[mid + "|" + d];}
// 1. 全体休
members.forEach(function (mem) {
for (var d = 1; d <= D; d++) {
var mk = (schedule[mem.id] || {})[d];
if (zentai.has(d) && mk!== "全") V.push(mem.name + ": 全体休の " + d + "日 が「全」になっていません（'" + mk + "'）");
if (!zentai.has(d) && mk === "全") V.push(mem.name + ": 全体休でない " + d + "日 に「全」が付いています");
}
});
// 2. 希望休・有給
members.forEach(function (mem) {
var mid = mem.id, req = requests[mid] || {};
[["kibou", "希", "希望休"], ["yukyu", "有", "有給"]].forEach(function (t) {
(req[t[0]] || []).forEach(function (d) {
if (!isOff(mid, d)) V.push(mem.name + ": " + t[2] + "の " + d + "日 が休みになっていません");
else if (!zentai.has(d) && schedule[mid][d]!== t[1]) V.push(mem.name + ": " + d + "日 の印が「" + t[1] + "」ではありません（'" + schedule[mid][d] + "'）");
});
});
Object.keys(schedule[mid] || {}).forEach(function (dk) {
var d = parseInt(dk, 10), mk = schedule[mid][dk];
if (mk === "希" && (req.kibou || []).indexOf(d) < 0) V.push(mem.name + ": 希望休でない " + d + "日 に「希」が付いています");
if (mk === "有" && (req.yukyu || []).indexOf(d) < 0) V.push(mem.name + ": 有給でない " + d + "日 に「有」が付いています");
});
});
// 3. 週2日
weeksOfMonth(ym).forEach(function (week) {
var isFirst = week.start < dates[0], isLast = week.end > dates[D - 1];
members.forEach(function (mem) {
var mid = mem.id;
var n = week.in_days.filter(function (d) { return isOff(mid, d);}).length;
if (isFirst &&!isLast) {
var prev = prevOffs[mid];
var expect = prev!= null? 2 - parseInt(prev, 10): 2;
if (n!== expect) V.push(mem.name + ": 月初の週（" + fmtDate(week.start) + "〜）の休みが " + n + " 日（期待 " + expect + " 日）");
} else if (isLast &&!isFirst) {
if (n < 2) V.push(mem.name + ": 月末の週（" + fmtDate(week.start) + "〜）の休みが " + n + " 日（2日以上必要）");
} else if (!isFirst &&!isLast) {
if (n!== 2) V.push(mem.name + ": 週（" + fmtDate(week.start) + "〜" + fmtDate(week.end) + "）の休みが " + n + " 日（2日必要）");
}
});
});
// 4. 出勤人数
for (var d4 = 1; d4 <= D; d4++) {
if (zentai.has(d4)) continue;
var nWork = members.filter(function (mem) { return!isOff(mem.id, d4);}).length;
var reqN = dayRequired[d4];
if (reqN!= null) {
if (nWork!== reqN) V.push(d4 + "日（指定日の必要人数）: 出勤 " + nWork + " 人（" + reqN + " 人必要）");
} else if (busy.has(d4)) {
if (!(11 <= nWork && nWork <= 12)) V.push(d4 + "日（繁忙日）: 出勤 " + nWork + " 人（11〜12人必要）");
} else if (quiet.has(d4)) {
if (nWork > 11) V.push(d4 + "日（閑散日）: 出勤 " + nWork + " 人（上限11人）");
} else {
if (!(10 <= nWork && nWork <= 11)) V.push(d4 + "日: 出勤 " + nWork + " 人（10〜11人必要）");
}
}
// 5. 最大連勤
members.forEach(function (mem) {
var pc = cond.person(mem.id);
var run = parseInt(prevStreak[mem.id] || 0, 10);
for (var d = 1; d <= D; d++) {
if (isOff(mem.id, d)) run = 0;
else { run++; if (run > pc.maxStreak) { V.push(mem.name + ": " + d + "日 時点で " + run + " 連勤（最大 " + pc.maxStreak + " 連勤まで）"); run = 0;}}
}
});
// 6. 飛び石
var tbList = tobiishiSoft? W: V;
if (cond.tobiishiNashi) {
members.forEach(function (mem) {
var mid = mem.id;
for (var d = 2; d <= D - 1; d++) {
if (isOff(mid, d - 1) &&!isOff(mid, d) && isOff(mid, d + 1)) tbList.push(mem.name + ": " + d + "日 が飛び石（休→出→休）になっています");
}
var prev = prevOffs[mid];
if (prev!= null && parseInt(prev, 10) >= 2 && D >= 2) {
if (!isOff(mid, 1) && isOff(mid, 2)) tbList.push(mem.name + ": 1日 が飛び石（先月末休み→出→休）になっています");
}
});
}
// 7. 連休
members.forEach(function (mem) {
var mid = mem.id, pc = cond.person(mid);
var qual = 0, runs = 0, i = 1;
while (i <= D - 1) {
if (zentai.has(i) || zentai.has(i + 1)) { i++; continue;}
if (isOff(mid, i) && isOff(mid, i + 1)) {
if (i === 1 ||!isOff(mid, i - 1) || zentai.has(i - 1)) runs++;
var k1 = dayKind(dates[i - 1], holidays), k2 = dayKind(dates[i], holidays);
var ok = true;
if (pc.renkyuDay === "平日") ok = (k1 === "weekday" && k2 === "weekday");
else if (pc.renkyuDay === "土日") ok = (k1 === "weekend" && k2 === "weekend");
if (ok) qual++;
}
i++;
}
if (qual < pc.renkyuMin) {
var label = pc.renkyuDay? "（" + pc.renkyuDay + "の連休）": "";
V.push(mem.name + ": 連休" + label + "が " + qual + " 回（最低 " + pc.renkyuMin + " 回必要）");
}
if (runs > pc.renkyuMax) W.push(mem.name + ": 連休が " + runs + " 回あります（目安は " + pc.renkyuMax + " 回まで）");
});
// 8. 毎週どれか休み
members.forEach(function (mem) {
var pc = cond.person(mem.id);
if (!pc.weeklyOffWeekdays.size) return;
weeksOfMonth(ym).forEach(function (week) {
var cand = [];
pc.weeklyOffWeekdays.forEach(function (wd) {
var dd = addDays(week.start, (wd + 1) % 7);
if (dd.getMonth() === dates[0].getMonth() && dd.getFullYear() === dates[0].getFullYear()) cand.push(dd.getDate());
});
if (cand.length &&!cand.some(function (cd) { return isOff(mem.id, cd);})) {
var wnames = Array.from(pc.weeklyOffWeekdays).sort().map(function (w) { return WEEKDAY_JP[w];}).join("・");
V.push(mem.name + ": 週（" + fmtDate(week.start) + "〜）に " + wnames + " のいずれも休みでありません");
}
});
});
// 9. 土日祝休の範囲
members.forEach(function (mem) {
var pc = cond.person(mem.id);
if (!pc.weekendOffRange) return;
var n = 0;
for (var d = 1; d <= D; d++) if (isOff(mem.id, d) && dayKind(dates[d - 1], holidays) === "weekend") n++;
if (!(pc.weekendOffRange[0] <= n && n <= pc.weekendOffRange[1])) {
V.push(mem.name + ": 土日祝の休みが " + n + " 日（" + pc.weekendOffRange[0] + "〜" + pc.weekendOffRange[1] + " 日必要）");
}
});
return { violations: V, warnings: W};
}
function fmtDate(d) {
return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

var api = {
WEEKDAY_JP: WEEKDAY_JP,
monthDates: monthDates,
weeksOfMonth: weeksOfMonth,
parseYearMonth: parseYearMonth,
daysInMonth: daysInMonth,
pyWeekday: pyWeekday,
orderedMembers: orderedMembers,
Conditions: Conditions,
solveShift: solveShift,
verifyShift: verifyShift,
dayKind: dayKind,
addDays: addDays
};
if (typeof module!== "undefined" && module.exports) module.exports = api;
global.ShiftSolver = api;
})(typeof window!== "undefined"? window: globalThis);
