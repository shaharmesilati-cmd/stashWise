// Pure budget math. No DOM, no storage - tested in tests/calc.test.mjs.

export const pad = n => String(n).padStart(2, '0');
export const isoOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const DAY = 86400000;

export function keyOf(y, m) {
  const d = new Date(y, m - 1, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export function shiftKey(key, n) {
  const [y, m] = key.split('-').map(Number);
  return keyOf(y, m + n);
}
/** Budget month a date belongs to, when the budget month starts on `startDay`. */
export function budgetKeyOf(iso, startDay = 1) {
  const [y, m, d] = iso.split('-').map(Number);
  return d >= startDay ? keyOf(y, m) : keyOf(y, m - 1);
}
export function periodOf(key, startDay = 1) {
  const [y, m] = key.split('-').map(Number);
  return { start: new Date(y, m - 1, startDay), end: new Date(y, m, startDay - 1) };
}
export function savingsAmount(settings, income) {
  const s = settings.savings || { mode: 'percent', value: 0 };
  return s.mode === 'percent' ? Math.round(income * (Number(s.value) || 0) / 100) : (Number(s.value) || 0);
}
/** "כסף שחזר": a purchase whose money came back (a return, a refund). It stays in the list but is not counted as spent. */
export const REFUND = 'refund';
export const isRefund = t => t.category === REFUND && t.kind !== 'income' && t.kind !== 'card-payment';
/** A credit-card purchase (it is paid on next month's charge day). */
export const isCardTx = t => t.kind === 'expense' && (/^\d{4}$/.test(t.card || '') || ['shots', 'card', 'pdf', 'paste'].includes(t.source));
/** The budget month a transaction counts in. With "byCharge", card purchases count when the card is charged. */
/** A salary-size income (or a salary slip). It funds the month it arrives for, even if it came a few days early. */
export const isSalary = (t, settings = {}) => t.kind === 'income' && (t.source === 'payslip' || Number(t.amount) >= Math.max(1500, (Number(settings.income) || 0) * 0.4));
export function txKey(t, settings = {}) {
  const sd = settings.startDay || 1;
  // the salary of the 1st sometimes lands on the 28th-31st (weekends, holidays): it still belongs to the month it is for
  if (t.date && isSalary(t, settings)) { const d = new Date(t.date + 'T12:00'); d.setDate(d.getDate() + 5); return budgetKeyOf(isoOf(d), sd); }
  if (settings.byCharge && isCardTx(t)) return t.chargeDate ? budgetKeyOf(t.chargeDate, sd) : shiftKey(budgetKeyOf(t.date, sd), 1);
  return budgetKeyOf(t.date, sd);
}
export const isCounted = t => !t.ignored && t.kind !== 'income' && t.kind !== 'card-payment' && t.category !== REFUND;
const sum = (list, f = t => t.amount) => list.reduce((a, t) => a + (Number(f(t)) || 0), 0);

/**
 * The salary a month is built on. Salaries change a little every month, so:
 *   - once this month's salary is known (a salary slip, or income of at least half the usual salary), it is used as is;
 *   - before that, the estimate is the LOWEST salary of the last 3 months (so there is never a nasty surprise),
 *     plus any smaller income that already came in. When the real salary arrives and it is higher,
 *     the extra is simply added to the days that are left.
 *   - with no history yet, the salary typed in the budget screen is used.
 * Returns { income, source: 'actual' | 'estimate' | 'planned', estimate }.
 */
export function incomeOf(settings, allTx, key) {
  const incomeIn = k => allTx.filter(t => t.kind === 'income' && !t.ignored && t.date && txKey(t, settings) === k);
  const planned = Number(settings.income) || 0;
  const past = [1, 2, 3].map(n => sum(incomeIn(shiftKey(key, -n)))).filter(v => v > 0);
  const estimate = past.length ? Math.min(...past) : planned;
  const now = incomeIn(key), actual = sum(now);
  const arrived = now.some(t => t.source === 'payslip') || (estimate > 0 ? now.some(t => t.amount >= estimate * 0.5) : actual > 0);
  if (arrived) return { income: actual, source: 'actual', estimate };
  return { income: estimate + actual, source: past.length ? 'estimate' : 'planned', estimate };
}

/**
 * Everything the screens need about one budget month.
 * income  = this month's salary (see incomeOf)
 * remaining = income - fixed - savings - variable spending
 */
export function monthSummary(settings, allTx, key, today = new Date()) {
  const sd = settings.startDay || 1;
  const inPeriod = allTx.filter(t => t.date && txKey(t, settings) === key);
  const counted = inPeriod.filter(isCounted);
  const variable = counted.filter(t => !t.fixedId);
  const actualIncome = sum(inPeriod.filter(t => t.kind === 'income' && !t.ignored));
  const plannedIncome = Number(settings.income) || 0;
  const inc = incomeOf(settings, allTx, key), income = inc.income;
  const fixedTotal = sum(settings.fixed || []);
  const savings = savingsAmount(settings, income);
  const available = income - fixedTotal - savings;
  const spent = sum(variable);
  // money the user locked into the vault this month: it is no longer spendable, but it is not an expense
  const locks = (settings.locks || []).filter(l => l.date && budgetKeyOf(l.date, sd) === key);
  const locked = sum(locks);
  const remaining = available - spent - locked;

  const { start, end } = periodOf(key, sd);
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const total = Math.round((end - start) / DAY) + 1;
  let elapsed, daysLeft;
  if (t0 > end) { elapsed = total; daysLeft = 0; }
  else if (t0 < start) { elapsed = 0; daysLeft = total; }
  else { elapsed = Math.round((t0 - start) / DAY) + 1; daysLeft = total - elapsed + 1; }

  const daily = daysLeft > 0 ? remaining / daysLeft : 0;
  const weekly = daysLeft >= 7 ? daily * 7 : remaining;
  const expectedByNow = available * (elapsed / total);
  const isCurrent = elapsed > 0 && daysLeft > 0;
  let status = 'good';
  if (remaining < 0) status = 'over';
  else if (isCurrent && available > 0 && spent > expectedByNow * 1.15 && spent - expectedByNow > 50) status = 'watch';
  // big one-off purchases (a quarter of the month's money or more) are not projected forward
  const oneOff = available > 0 ? variable.filter(t => t.amount >= available * 0.25).reduce((a, t) => a + t.amount, 0) : 0;
  const projectedSpend = isCurrent && elapsed >= 5 ? oneOff + (spent - oneOff) / elapsed * total : spent;
  const projectedEnd = available - projectedSpend - locked;

  const byCat = {};
  const known = new Set((settings.categories || []).map(c => c.id));
  const catOf = t => (t.category && (!known.size || known.has(t.category)) ? t.category : 'other');
  for (const t of variable) byCat[catOf(t)] = (byCat[catOf(t)] || 0) + t.amount;
  const allocated = sum((settings.categories || []).filter(c => c.id !== REFUND), c => c.budget);
  const fixedSeen = new Set(counted.filter(t => t.fixedId).map(t => t.fixedId));
  const back = inPeriod.filter(t => isRefund(t) && !t.ignored);
  const refunded = sum(back.filter(t => t.amount > 0));

  return {
    key, inPeriod, variable, plannedIncome, actualIncome, income, incomeSource: inc.source, incomeEstimate: inc.estimate, fixedTotal, savings, available, spent, remaining, locked, locks,
    start, end, total, elapsed, daysLeft, daily, weekly, expectedByNow, status, isCurrent, projectedEnd,
    byCat, allocated, unallocated: available - allocated, fixedSeen, refunded, refundCount: back.length,
  };
}

/**
 * The daily money, the way people think about it:
 *   - every day has a daily amount (the month's spending money / days in the month);
 *   - what you did not spend goes into "saved" and is yours to use on any later day:
 *       today you can = today's daily amount + saved;
 *   - spending more than today's amount takes from "saved" first. Only if "saved" runs out, the rest is spread
 *     over the days that are left (the daily amount gets a little smaller) - so there is never a big scary minus.
 * Money locked into the vault leaves "saved" the same way spending does (it is not an expense).
 * The sum always matches the month: saved + daily x days left = what is left for the month.
 * Returns null when the month is not the current one, or there is no money left for the month.
 */
export function dailyBank(settings, allTx, key, today = new Date()) {
  const C = monthSummary(settings, allTx, key, today);
  if (!C.isCurrent || !(C.available > 0) || C.remaining < 0) return null;
  const base0 = C.available / C.total;
  const startIso = isoOf(C.start), todayIso = isoOf(new Date(today.getFullYear(), today.getMonth(), today.getDate()));
  const clamp = d => (d < startIso ? startIso : d > todayIso ? todayIso : d); // charge-month mode / future dates sit on the nearest passed day
  const byDay = {}, byLock = {};
  for (const t of C.variable) { const d = clamp(t.date); byDay[d] = (byDay[d] || 0) + t.amount; }
  for (const l of C.locks) { const d = clamp(l.date); byLock[d] = (byLock[d] || 0) + l.amount; }
  const r2 = v => Math.round(v * 100) / 100;
  /** One day: returns the saved amount and daily amount for the next day. */
  const close = (saved, daily, out, daysAfter) => {
    let s = saved + daily - out;
    if (s >= 0 || daysAfter <= 0) return { saved: s, daily };
    return { saved: 0, daily: daily + s / daysAfter }; // s < 0: what "saved" could not cover is spread over the days after
  };
  const days = []; let saved = 0, daily = base0, zeroDays = 0;
  for (let i = 1; i <= C.elapsed; i++) {
    const iso = isoOf(new Date(C.start.getFullYear(), C.start.getMonth(), C.start.getDate() + i - 1));
    const spent = byDay[iso] || 0, locked = byLock[iso] || 0, out = spent + locked;
    const allow = daily + saved;
    days.push({ iso, spent: r2(spent), locked: r2(locked), daily: r2(daily), saved: r2(saved), allow: r2(allow), left: r2(allow - out) });
    if (iso === todayIso || i === C.elapsed) break;
    if (!spent) zeroDays++;
    ({ saved, daily } = close(saved, daily, out, C.total - i));
  }
  const t = days[days.length - 1];
  const next = C.daysLeft > 1 ? close(saved, daily, t.spent + t.locked, C.daysLeft - 1) : null;
  return {
    base: r2(base0),                 // the daily amount at the start of the month
    daily: t.daily,                  // today's daily amount (smaller than base only after overspending)
    saved: t.saved,                  // saved from earlier days, before today
    morning: t.allow,                // today you can = daily + saved
    spentToday: t.spent, lockedToday: t.locked,
    balance: t.left,                 // still possible today (negative = over today's amount)
    tomorrow: next ? r2(next.saved + next.daily) : null,
    tomorrowSaved: next ? r2(next.saved) : null, tomorrowDaily: next ? r2(next.daily) : null,
    lockable: Math.max(0, Math.floor(t.saved)),
    zeroDays, days, daysLeft: C.daysLeft, day: C.elapsed, total: C.total, remaining: r2(C.remaining), maxEnd: r2(C.remaining),
  };
}

const BANK_STEPS = [250, 500, 1000, 1500, 2000, 3000, 4000, 5000, 7500, 10000, 15000, 20000, 30000, 50000];
/** The next round number the bank can reach, and how far along it is. */
export function bankMilestone(balance, maxEnd, base) {
  const next = BANK_STEPS.find(s => s > balance) || null;
  const prev = [...BANK_STEPS].reverse().find(s => s <= balance) || 0;
  const pct = next ? Math.max(0, Math.min(1, (balance - prev) / (next - prev))) : 1;
  return { prev, next, pct, reachable: next != null && next <= maxEnd + 0.5, days: next && base > 0 ? Math.ceil((next - balance) / base) : null };
}

/** Split `available` across categories by their weights, in round tens; the rounding rest goes to `other`. */
export function autoSplit(categories, available) {
  if (!(available > 0)) return categories.map(c => ({ ...c }));
  let w = categories.map(c => (c.id === REFUND ? 0 : Number(c.weight) || 0));
  let W = w.reduce((a, b) => a + b, 0);
  if (!W) { w = categories.map(c => (c.id === REFUND ? 0 : 1)); W = w.reduce((a, b) => a + b, 0) || 1; }
  const out = categories.map((c, i) => ({ ...c, budget: Math.floor(available * w[i] / W / 10) * 10 }));
  const used = out.reduce((a, c) => a + c.budget, 0);
  const rest = out.find(c => c.id === 'other') || out[out.length - 1];
  rest.budget += Math.round(available - used);
  return out;
}

export const normMerchant = s => String(s || '').toLowerCase().replace(/[\s"'`׳״.,\-_*()\/\\|#]/g, '');
export const dupKey = t => `${t.date}|${normMerchant(t.merchant)}|${Number(t.amount).toFixed(2)}`;
