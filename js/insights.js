// Short, friendly observations about the month (in the spirit of "we noticed..."). Pure functions, tested.
import { monthSummary, shiftKey, periodOf, isCounted, isoOf } from './calc.js';

const FOOD = new Set(['food']);

/** Spending per category in the previous month, up to the same day of the month (fair comparison). */
function prevSameDay(settings, tx, key, elapsed) {
  const pk = shiftKey(key, -1), sd = settings.startDay || 1;
  const { start } = periodOf(pk, sd);
  const cut = isoOf(new Date(start.getFullYear(), start.getMonth(), start.getDate() + Math.max(0, elapsed - 1)));
  const P = monthSummary(settings, tx, pk);
  const by = {};
  for (const t of P.variable) if (t.date <= cut) by[t.category || 'other'] = (by[t.category || 'other'] || 0) + t.amount;
  return { by, has: P.variable.length > 0 };
}

export function monthInsights(settings, tx, key, today = new Date()) {
  const C = monthSummary(settings, tx, key, today);
  const name = id => (settings.categories.find(c => c.id === id) || { name: 'שונות' }).name;
  const out = [];
  if (!C.variable.length) return { list: out, stats: null };


  // compared with last month, same point in the month
  const elapsed = C.isCurrent ? C.elapsed : C.total;
  const prev = prevSameDay(settings, tx, key, elapsed);
  if (prev.has) {
    let up = null, down = null;
    const ids = new Set([...Object.keys(C.byCat), ...Object.keys(prev.by)]);
    for (const id of ids) {
      if (id === 'other') continue;
      const a = C.byCat[id] || 0, b = prev.by[id] || 0, d = a - b;
      if (b > 0 && d >= 150 && d / b >= 0.25 && (!up || d > up.d)) up = { id, d, p: d / b };
      if (b > 0 && -d >= 100 && -d / b >= 0.15 && (!down || -d > down.d)) down = { id, d: -d, p: -d / b };
    }
    if (up) out.push({ tone: 'alert', icon: 'trend-up', text: `על "${name(up.id)}" הוצאת עד עכשיו ₪${Math.round(up.d).toLocaleString('he-IL')} יותר מבאותה נקודה בחודש שעבר (${Math.round(up.p * 100)}%+).` });
    if (down) out.push({ tone: 'good', icon: 'trend-down', text: `ההוצאות על "${name(down.id)}" ירדו ב-${Math.round(down.p * 100)}% לעומת החודש שעבר. כל הכבוד!` });
  }

  // eating out tip
  const food = Object.entries(C.byCat).filter(([id]) => FOOD.has(id)).reduce((a, [, v]) => a + v, 0);
  if (food >= 300 && C.spent > 0 && food / C.spent >= 0.12) {
    const half = Math.round(food / 2 / 10) * 10;
    out.push({ tone: 'tip', icon: 'piggy', text: `החודש יצאו ₪${Math.round(food).toLocaleString('he-IL')} על אוכל בחוץ. חצי מזה (בערך ₪${half.toLocaleString('he-IL')}) יכול לעבור לחיסכון.` });
  }

  // expected surplus -> goal
  if (C.isCurrent && C.elapsed >= 5 && C.projectedEnd > 200 && settings.goals.length) {
    const g = settings.goals.find(x => x.target > x.saved) || settings.goals[0];
    out.push({ tone: 'good', icon: 'target', text: `צפוי לך עודף של כ-₪${Math.round(C.projectedEnd).toLocaleString('he-IL')} בסוף החודש. אפשר להעביר אותו ל"${g.name || 'יעד החיסכון'}".` });
  }

  const order = { alert: 0, tip: 1, good: 2 };
  out.sort((a, b) => order[a.tone] - order[b.tone]);

  const biggest = C.variable.reduce((m, t) => (t.amount > m.amount ? t : m), C.variable[0]);
  const top = Object.entries(C.byCat).sort((a, b) => b[1] - a[1])[0];
  const days = Math.max(1, C.isCurrent ? C.elapsed : C.total);
  return {
    list: out.slice(0, 3),
    stats: { biggest, topCat: top ? { id: top[0], name: name(top[0]), amount: top[1] } : null, perDay: C.spent / days, count: C.variable.length },
  };
}

/** Purchases that still sit in "other" and were never confirmed - the "needs your attention" list. */
export function needsCategory(settings, tx, key) {
  const C = monthSummary(settings, tx, key);
  const known = new Set((settings.categories || []).map(c => c.id));
  // a category that was deleted counts as "שונות" too
  return C.inPeriod.filter(t => isCounted(t) && t.kind === 'expense' && (!t.category || t.category === 'other' || !known.has(t.category)) && !t.confirmed && !t.fixedId && !/טרם\s*נקלט/.test(t.merchant || ''))
    .sort((a, b) => b.amount - a.amount);
}

// Payment apps: the name says nothing about what was bought, so a choice applies only to that one purchase.
export const isGenericMerchant = m => /bit|ביט|paybox|פייבוקס|paypal|פייפאל|apple ?pay|google ?pay|העברה|העברת|pepper ?pay/i.test(String(m || ''));

/**
 * Days in a row (ending yesterday) where spending stayed within the daily allowance of that month.
 * Counting starts only from the first day the user has any purchase, so an empty app has no streak.
 */
export function budgetStreak(settings, tx, today = new Date()) {
  const exp = tx.filter(t => t.kind === 'expense' && !t.ignored && !t.fixedId && t.date && t.category !== 'refund');
  if (!exp.length) return 0;
  const first = exp.reduce((m, t) => (t.date < m ? t.date : m), exp[0].date);
  const byDay = {};
  for (const t of exp) byDay[t.date] = (byDay[t.date] || 0) + t.amount;
  const cache = {};
  const allowance = iso => {
    const k = budgetKeyOfLocal(iso, settings.startDay || 1);
    if (!(k in cache)) { const C = monthSummary(settings, tx, k, today); cache[k] = C.total ? Math.max(0, C.available) / C.total : 0; }
    return cache[k];
  };
  let n = 0;
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  for (let i = 0; i < 366; i++, d.setDate(d.getDate() - 1)) {
    const iso = isoOf(d);
    if (iso < first) break;
    const a = allowance(iso);
    if (a <= 0 || (byDay[iso] || 0) > a) break;
    n++;
  }
  return n;
}
function budgetKeyOfLocal(iso, sd) { const [y, m, dd] = iso.split('-').map(Number); const t = dd >= sd ? new Date(y, m - 1, 1) : new Date(y, m - 2, 1); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`; }

/**
 * Where the money goes, by category (also the ones the user added), biggest first.
 * For each: this month, share of the month, the same point last month (so a half month is compared with a half month),
 * and the average of the 3 full months before. No budgets, no "over" - just where the money is.
 */
export function catBreakdown(settings, tx, key, today = new Date()) {
  const C = monthSummary(settings, tx, key, today), P = monthSummary(settings, tx, shiftKey(key, -1), today);
  const known = new Set((settings.categories || []).map(c => c.id));
  const catOf = t => (t.category && known.has(t.category) ? t.category : 'other');
  const day = d => Math.round((new Date(d + 'T12:00') - P.start) / 864e5); // day index inside last month
  const sumBy = (list, f = () => true) => { const o = {}; for (const t of list) if (f(t)) o[catOf(t)] = (o[catOf(t)] || 0) + t.amount; return o; };
  const now = sumBy(C.variable), cnt = {};
  for (const t of C.variable) cnt[catOf(t)] = (cnt[catOf(t)] || 0) + 1;
  const prevSame = sumBy(P.variable, t => !C.isCurrent || day(t.date) < C.elapsed);
  const avgs = {};
  for (let n = 1; n <= 3; n++) { const M = monthSummary(settings, tx, shiftKey(key, -n), today); for (const [k, v] of Object.entries(sumBy(M.variable))) avgs[k] = (avgs[k] || 0) + v / 3; }
  const total = Object.values(now).reduce((a, v) => a + Math.max(0, v), 0);
  const rows = (settings.categories || []).filter(c => c.id !== 'refund').map(c => ({
    c, sp: Math.max(0, now[c.id] || 0), count: cnt[c.id] || 0, prev: Math.max(0, prevSame[c.id] || 0), avg: Math.round(avgs[c.id] || 0),
  })).filter(r => r.sp > 0 || r.prev > 0).sort((a, b) => b.sp - a.sp || b.prev - a.prev);
  for (const r of rows) { r.share = total ? r.sp / total : 0; r.delta = r.sp - r.prev; }
  return { rows, total, fixed: C.fixedTotal, isCurrent: C.isCurrent };
}
