// Home: one calm screen. The big number is what you can safely spend today.
// Below it: ONE next step, the savings goal with your streak, top categories, last purchases.
// Everything else (charts, comparisons) lives behind "ניתוח החודש".
import { state, catById, upsertTx, persist, changed, addCategory } from '../store.js';
import { monthSummary, shiftKey, normMerchant, dailyBank, isoOf } from '../calc.js';
import { $, $$, esc, ic, money, fmt0, MONTHS, openSheet, toast, shortDate } from '../util.js';
import { txRow, catIcon } from './parts.js';
import { monthInsights, needsCategory, isGenericMerchant } from '../insights.js';
import { sameBusiness } from '../categorize.js';

function greeting() {
  const h = new Date().getHours();
  const g = h < 5 ? 'לילה טוב' : h < 12 ? 'בוקר טוב' : h < 17 ? 'צהריים טובים' : h < 21 ? 'ערב טוב' : 'לילה טוב';
  return state.settings.name ? `${g}, ${esc(state.settings.name)}` : g;
}
const R = 52, CIRC = 2 * Math.PI * R;

export function render(el) {
  const S = state.settings, key = state.ui.curKey;
  const C = monthSummary(S, state.tx, key);
  const parts = [];
  const past = C.daysLeft === 0, future = C.elapsed === 0;


  // first run: just the three steps
  if (!S.income && !state.tx.length && !S.fixed.length && !S.goals.length && !S.categories.some(c => c.budget > 0)) {
    parts.push(`<section class="card welcome"><span class="w-ic">${ic('wallet')}</span><h2>ברוך הבא ל-Stashwise</h2>
      <p>שני צעדים ואתה רואה כמה מותר להוציא היום, בלי לחשוב.</p>
      <a class="btn primary wide" href="#budget">${ic('hand-coins')}1. כמה נכנס לי בחודש</a>
      <a class="btn wide" href="#add">${ic('plus')}2. הוספת ההוצאות של החודש</a></section>`);
    el.innerHTML = parts.join(''); return;
  }

  if (!C.isCurrent && !C.inPeriod.length) {
    parts.push(`<section class="card empty-month">${ic('calendar', 'big')}<h2>אין נתונים ל${past ? 'חודש הזה' : 'חודש שעוד לא התחיל'}</h2>
      <p>${past ? 'אפשר להוסיף הוצאות של החודש הזה מקובץ, מצילום או ידנית.' : 'כשהחודש יתחיל, תראה כאן כמה מותר להוציא בכל יום.'}</p>
      ${past ? `<a class="btn small primary" href="#add">${ic('plus')}הוספת הוצאות</a>` : ''}</section>`);
    el.innerHTML = parts.join(''); return;
  }

  const B = dailyBank(S, state.tx, key);
  if (B) {
    // today: one big number. Underneath: where it comes from (daily + saved)
    const over = B.balance < 0, left = B.morning > 0 ? Math.max(0, B.balance) / B.morning : 0;
    const savedNow = savedLeft(B), savedAll = savedNow + vaultMonth(S, C);
    parts.push(`<section class="hero2 ${over ? 'watch' : 'good'}">
      <button type="button" id="why" class="ring-wrap" aria-label="איך המספר מחושב">
        ${ringSvg(left)}
        <span class="ring-in"><span class="h-lbl">${over ? 'עברת היום ב-' : 'אפשר להוציא היום'}</span><b class="h-big" data-count="${Math.round(Math.abs(B.balance))}">${money(Math.abs(B.balance))}</b>
          <span class="h-why">${ic('question')}</span></span>
      </button>
      <div class="h-parts">${over ? `<span class="hp">${ic('sun')}מחר ${money(B.tomorrow ?? 0)}</span>`
        : `<span class="hp">${money(B.daily)} היום</span>${savedNow >= 1 ? `<span class="hp-plus">+</span><span class="hp gold">${money(savedNow)} שחסכת</span>` : ''}`}</div>
    </section>`);
    // the month and the savings, side by side
    const monthPct = C.available > 0 ? Math.max(0, Math.min(1, C.remaining / C.available)) : 0, timePct = C.daysLeft / C.total;
    parts.push(`<section class="duo">
      <a class="mtile month-tile" href="#expenses" aria-label="נשאר עד סוף החודש ${fmt0(C.remaining)} שקלים, ${C.daysLeft} ימים">
        <span class="t-lbl">נשאר עד סוף החודש</span><b class="t-big num">${money(C.remaining)}</b>
        <span class="t-bar" title="כסף מול זמן"><i style="width:${(monthPct * 100).toFixed(1)}%"></i><em style="inset-inline-start:${((1 - timePct) * 100).toFixed(1)}%"></em></span>
        <span class="t-sub">${C.daysLeft === 1 ? 'יום אחרון' : `${C.daysLeft} ימים`}${C.incomeSource === 'estimate' ? ' · משכורת משוערת' : ''}</span></a>
      <button type="button" class="mtile save-tile" id="piggy" aria-label="חסכת ${fmt0(savedAll)} שקלים">
        <span class="coins" id="piggy-anim" aria-hidden="true" data-fill="${coinFill(savedAll, B.base).toFixed(3)}"></span>
        <span class="t-lbl">חסכת החודש</span><b class="t-big num" id="saved-n" data-count="${Math.round(savedAll)}">${money(savedAll)}</b>
        ${B.tomorrow != null && !over ? `<span class="t-sub good">${(B.tomorrowSaved ?? 0) > savedNow + .5 ? `מחר ${money((B.tomorrowSaved ?? 0) + vaultMonth(S, C))}` : 'לא מוציא? זה גדל'}</span>` : '<span class="t-sub">&nbsp;</span>'}</button>
    </section>`);
  } else {
    // past or future month, or the month is already over budget: the month is the story
    const left = C.available > 0 ? Math.max(0, C.remaining) / C.available : 0;
    const label = C.remaining < 0 ? 'חרגת החודש ב-' : past ? 'נשאר בסוף החודש' : future ? 'יהיה לך להוציא החודש' : 'נשאר עד סוף החודש';
    parts.push(`<section class="hero2 ${C.status}"><div class="ring-wrap">${ringSvg(left)}
      <span class="ring-in"><span class="h-lbl">${label}</span><b class="h-big" data-count="${Math.round(Math.abs(C.remaining))}">${money(Math.abs(C.remaining))}</b></span></div>
      <p class="h-sub">${C.remaining < 0 ? 'כל שקל שלא יוצא מקטין את החריגה' : `${C.total} ימים · תקציב ${money(C.available)}`}</p></section>`);
  }

  // one next step
  parts.push(nextStep(S, C, key));

  // savings goal
  const g = S.goals.find(x => x.target > x.saved) || S.goals[0];
  if (g) {
    const p = g.target ? Math.min(100, g.saved / g.target * 100) : 0;
    parts.push(`<section class="card save-card">
      <div class="goal-hero"><div class="gh-top"><span class="gh-ic">${ic('piggy')}</span><div class="grow2"><b>${esc(g.name || 'יעד החיסכון')}</b><small>${money(g.saved)} מתוך ${money(g.target)}</small></div><b class="gh-pct num">${Math.round(p)}%</b></div>
        <div class="gold-bar"><i style="width:${p.toFixed(1)}%"></i></div>
        ${g.monthly ? `<button class="btn small gold" id="dep" type="button">${ic('plus')}הפקדתי ₪${fmt0(g.monthly)}</button>` : ''}</div>
    </section>`);
  }

  // top categories (compact)
  const cats = S.categories.filter(c => c.budget > 0 || C.byCat[c.id])
    .map(c => ({ c, sp: C.byCat[c.id] || 0 })).sort((a, b) => (b.c.budget ? b.sp / b.c.budget : 2) - (a.c.budget ? a.sp / a.c.budget : 2) || b.sp - a.sp);
  if (cats.length) {
    parts.push(`<section class="card"><div class="card-h"><h2>הקטגוריות שלך</h2><button class="link" id="all-cats" type="button">הכל (${cats.length})</button></div>
      <div class="cats">${cats.slice(0, 4).map(catLine).join('')}</div></section>`);
  }

  // last purchases
  const recent = C.inPeriod.slice().sort((a, b) => b.date.localeCompare(a.date) || b.added - a.added).slice(0, 3);
  if (recent.length) parts.push(`<section class="card"><div class="card-h"><h2>אחרונות</h2><a class="link" href="#expenses">כל התנועות</a></div><div class="tx-list">${recent.map(txRow).join('')}</div></section>`);

  parts.push(`<button class="analysis-btn" id="analysis" type="button">${ic('sparkle')}<span><b>ניתוח החודש</b></span>${ic('caret-left')}</button>`);

  el.innerHTML = parts.join('');
  wire(el, cats);
  wireBank(el, B, C);
  enter(el);
  countUp(el);
}

const WD = ['א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'];
const wdOf = iso => WD[new Date(iso + 'T12:00').getDay()];
const daysWord = n => (n === 1 ? 'יום אחד' : `${n} ימים`);
const vaultTotal = S => (S.locks || []).reduce((a, l) => a + l.amount, 0);
/** What is left of "saved" right now: money moved to savings today comes out of it, and so does spending beyond today's amount. */
const savedLeft = B => Math.max(0, B.saved - B.lockedToday - Math.max(0, B.spentToday - B.daily));
/** Money moved to the vault this month (it counts as saved, not as spent). */
const vaultMonth = (S, C) => (C.locks || []).reduce((a, l) => a + l.amount, 0);
const ringSvg = left => `<svg class="ring" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--rc1)"/><stop offset="1" stop-color="var(--rc2)"/></linearGradient></defs>
  <circle class="ring-bg" cx="60" cy="60" r="${R}"></circle>
  <circle class="ring-fg" cx="60" cy="60" r="${R}" stroke="url(#rg)" stroke-dasharray="${CIRC.toFixed(1)}" stroke-dashoffset="${(CIRC * (1 - left)).toFixed(1)}" data-off="${(CIRC * (1 - left)).toFixed(1)}"></circle></svg>`;
const buzz = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch { } };

/* ---------- the coin stack (Lottie animation, stored inside the app) ---------- */
// The stack grows with what was saved: a full stack = five days of the daily amount. It animates from the old height to the new one.
const COIN_END = 104; // the frame where the tallest stack has landed
const coinFill = (saved, base) => (saved <= 0 || !(base > 0) ? 0 : Math.max(0.28, Math.min(1, saved / (base * 5))));
let lottieLib = null, coinData = null;
function loadLottie() {
  if (lottieLib) return lottieLib;
  lottieLib = new Promise((res, rej) => {
    if (window.lottie) { res(window.lottie); return; }
    const sc = document.createElement('script'); sc.src = 'js/lib/lottie_light.min.js';
    sc.onload = () => (window.lottie ? res(window.lottie) : rej(new Error('lottie'))); sc.onerror = rej;
    document.head.appendChild(sc);
  });
  return lottieLib;
}
const loadCoins = () => coinData || (coinData = fetch('assets/anim/coins.json').then(r => r.json()));
/** Shows the coin stack at `fill` (0..1). With `from`, the coins stack up from that height to `fill`. */
async function coins(box, fill, from = null) {
  if (!box) return null;
  try {
    const [L, data] = await Promise.all([loadLottie(), loadCoins()]);
    if (!box.isConnected) return null;
    box.innerHTML = '';
    const a = L.loadAnimation({ container: box, renderer: 'svg', loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(data)), rendererSettings: { preserveAspectRatio: 'xMidYMax meet' } });
    box._anim = a; box._fill = fill;
    const to = Math.round(fill * COIN_END);
    a.addEventListener('DOMLoaded', () => {
      if (from != null && !calm() && to > from * COIN_END + 2) { a.setSpeed(1.5); a.playSegments([Math.round(from * COIN_END), to], true); }
      else a.goToAndStop(to, true);
    });
    return a;
  } catch { box.classList.add('static'); box.innerHTML = ic('coins'); return null; }
}
/** Tap: the stack rebuilds quickly from the bottom. */
const replayCoins = box => { const a = box && box._anim; if (a && !calm() && box._fill > 0) { a.setSpeed(1.8); a.playSegments([0, Math.round(box._fill * COIN_END)], true); buzz(10); } };

/** Did the saved amount grow since the person last looked? */
function savedGrew(B, S, C) {
  const now = Math.round(savedLeft(B) + vaultMonth(S, C)), k = `${C.key}`; let prev = null;
  try { prev = JSON.parse(localStorage.getItem('stashwise-saved-seen') || 'null'); localStorage.setItem('stashwise-saved-seen', JSON.stringify({ k, v: now })); } catch { }
  return { grew: !!prev && prev.k === k && now > prev.v, from: prev && prev.k === k ? prev.v : 0 };
}

function wireBank(el, B, C) {
  const why = $('#why', el); if (why && B) why.onclick = () => openWhy(B, C);
  const tile = $('#piggy', el); if (!tile || !B) return;
  const S = state.settings, box = $('#piggy-anim', tile), g = savedGrew(B, S, C);
  if (g.grew) $('#saved-n', tile).dataset.from = g.from;
  coins(box, +box.dataset.fill, g.grew ? coinFill(g.from, B.base) : null);
  tile.onclick = () => { replayCoins(box); setTimeout(() => openVault(B, C), calm() ? 0 : 450); };
}

/** "How is today's number calculated?" - the sum as a picture, the last days, and a what-if slider. */
function openWhy(B, C) {
  const row = (label, val, cls = '') => `<div class="eq ${cls}"><span>${label}</span><b class="num">${val}</b></div>`;
  const days = B.days.slice(-7), top = Math.max(...days.map(d => Math.max(d.allow, d.spent)), 1);
  const max = Math.max(50, Math.ceil(Math.max(B.balance, B.daily) * 1.5 / 10) * 10);
  /** Tomorrow if I spend `v` more today: what is left is saved; going over first uses saved, then lowers the daily amount. */
  const tomorrowIf = v => { const left = B.balance - v; return left >= 0 ? B.daily + left : (B.daysLeft > 1 ? B.daily + left / (B.daysLeft - 1) : 0); };
  openSheet('איך המספר מחושב', `<div class="eqs">
      ${row('היומי שלך', money(B.daily))}${B.saved >= 1 ? row('חסכת מימים קודמים', '+' + money(B.saved), 'plus') : ''}
      ${B.spentToday ? row('הוצאת היום', '-' + money(B.spentToday, 'auto'), 'minus') : ''}${B.lockedToday ? row('העברת לחיסכון', '-' + money(B.lockedToday), 'minus') : ''}
      ${row(B.balance >= 0 ? 'אפשר להוציא היום' : 'עברת היום ב-', money(Math.abs(B.balance)), 'total')}</div>
    <p class="why-note good">${ic('coins')}מה שלא תוציא היום נכנס לחיסכון, ומחר יתווסף ליומי.</p>
    <p class="why-note soft">${ic('hand-coins')}לפי ${C.incomeSource === 'actual' ? 'המשכורת שנכנסה' : C.incomeSource === 'estimate' ? 'משכורת משוערת' : 'המשכורת הרגילה'}: ${money(C.income)}</p>
    ${B.daily < B.base - 0.5 ? `<p class="why-note">${ic('info')}הוצאת יותר ממה שחסכת, אז היומי ירד מ-${money(B.base)} ל-${money(B.daily)} עד סוף החודש.</p>` : ''}
    <div class="bk-days" role="list">${days.map((d, i) => {
      const today = i === days.length - 1, cls = !d.spent ? 'zero' : d.left >= 0 ? 'under' : 'over';
      return `<button type="button" class="bk-day ${cls}${today ? ' is-today' : ''}" role="listitem" data-day="${d.iso}" aria-label="יום ${wdOf(d.iso)} ${shortDate(d.iso)}">
        <span class="bk-col"><i style="--h:${Math.max(6, Math.min(100, d.spent / top * 100)).toFixed(0)}%;--i:${i}"></i><em style="bottom:${Math.min(100, d.allow / top * 100).toFixed(0)}%"></em></span>
        <small>${today ? 'היום' : wdOf(d.iso) + "'"}</small></button>`; }).join('')}</div>
    <p class="bk-info" id="bk-info" aria-live="polite">עמודה = כמה יצא · קו = כמה היה אפשר</p>
    ${B.tomorrow != null ? `<div class="bk-sim"><label for="bk-range">ואם אוציא היום ${B.spentToday ? 'עוד ' : ''}<b id="bk-x" class="num">₪0</b>?</label>
      <input type="range" id="bk-range" min="0" max="${max}" step="5" value="0" style="--f:0%">
      <p id="bk-out" class="bk-out"></p></div>` : ''}`, sh => {
    const info = $('#bk-info', sh);
    sh.querySelectorAll('[data-day]').forEach(b => b.onclick = () => {
      const d = B.days.find(x => x.iso === b.dataset.day); if (!d) return;
      sh.querySelectorAll('.bk-day').forEach(x => x.classList.toggle('sel', x === b));
      info.innerHTML = `<b>${b.classList.contains('is-today') ? 'היום' : `יום ${wdOf(d.iso)}' ${shortDate(d.iso)}`}</b> · יצאו ${money(d.spent, 'auto')} מתוך ${money(d.allow)}${d.left > 0 && !b.classList.contains('is-today') ? ` · ${money(d.left)} נחסכו` : ''}`;
    });
    const r = $('#bk-range', sh); if (!r) return;
    const out = $('#bk-out', sh), x = $('#bk-x', sh);
    const show = () => {
      const v = +r.value, today = B.balance - v, tom = tomorrowIf(v);
      r.style.setProperty('--f', (v / +r.max * 100).toFixed(1) + '%');
      x.textContent = '₪' + fmt0(v);
      out.className = 'bk-out ' + (v === 0 ? 'good' : today < 0 ? 'warn' : '');
      out.innerHTML = `<span><small>היום נשאר</small><b class="num">${today >= 0 ? money(today) : '-' + money(-today)}</b></span><span><small>מחר</small><b class="num">${money(Math.max(0, tom))}</b></span>`;
    };
    r.oninput = show; show();
  });
}

/** Savings: what was saved this month, how much more is possible, and moving it to real savings. */
function openVault(B, C) {
  const S = state.settings, total = vaultTotal(S), savedNow = B ? savedLeft(B) : 0, can = Math.floor(savedNow);
  const month = (C ? vaultMonth(S, C) : 0) + savedNow;
  // what the month can still end with: if every day from now is like the average day so far, and if no more is spent
  const pace = C && C.elapsed > 0 ? Math.max(0, C.projectedEnd) : 0, best = B ? Math.max(0, B.remaining) : 0;
  openSheet('החיסכון שלי', `<div class="vault-big"><span class="coins big" id="vs-coins" aria-hidden="true"></span><div><small class="muted">חסכת החודש</small><b class="num">${money(month)}</b></div></div>
    ${B && B.tomorrow != null ? `<div class="more-save">
      <div class="ms-row"><span>${ic('trend-up')}בקצב שלך, בסוף החודש</span><b class="num">${money(pace + (C ? vaultMonth(S, C) : 0))}</b></div>
      <div class="ms-row best"><span>${ic('sparkle')}אפשר להגיע עד</span><b class="num">${money(best + (C ? vaultMonth(S, C) : 0))}</b></div>
      <div class="ms-row soft"><span>כל יום בלי הוצאות</span><b class="num">+${money(B.daily)}</b></div></div>` : ''}
    ${can >= 10 ? `<button class="btn primary wide" id="vs-lock" type="button">${ic('lock-key')}להעביר ${money(can)} לחיסכון</button>
      <p class="hint">הכסף יוצא מהיומי, כדי שלא תוציא אותו. כדאי להעביר אותו גם בבנק.</p>` : ''}
    ${(S.locks || []).length ? `<div class="vl-list">${S.locks.slice(-4).reverse().map(l => `<div class="vl-row"><span>${shortDate(l.date)}</span><b class="num">₪${fmt0(l.amount)}</b><button class="btn small ghost" type="button" data-unlock="${esc(l.id)}">החזרה ליומי</button></div>`).join('')}</div>` : ''}`, (sh, close) => {
    coins($('#vs-coins', sh), coinFill(month, B ? B.base : 1), 0);
    const lk = $('#vs-lock', sh);
    if (lk) lk.onclick = () => {
      const id = 'l' + Date.now().toString(36);
      S.locks.push({ id, date: isoOf(new Date()), amount: can }); persist();
      buzz([15, 30, 15]); lk.disabled = true; celebrate(lk);
      setTimeout(() => { close(); changed('settings'); toast(`₪${fmt0(can)} עברו לחיסכון`, { label: 'ביטול', fn: () => { S.locks = S.locks.filter(l => l.id !== id); persist(); changed('settings'); } }); }, calm() ? 0 : 500);
    };
    sh.querySelectorAll('[data-unlock]').forEach(b => b.onclick = () => { S.locks = S.locks.filter(l => l.id !== b.dataset.unlock); persist(); close(); changed('settings'); toast('הוחזר ליומי'); });
  });
}

function catLine({ c, sp }) {
  const pct = c.budget ? sp / c.budget : 0, left = c.budget - sp;
  const cls = !c.budget ? 'nobudget' : pct >= 1 ? 'bad' : pct >= .8 ? 'warn' : '';
  return `<div class="cat-line" role="button" tabindex="0" data-catd="${esc(c.id)}">${catIcon(c)}
    <div class="cl-mid"><div class="cl-top"><span class="cl-n">${esc(c.name)}</span>
      <span class="cl-v ${left < 0 ? 't-bad' : pct >= .8 ? 't-warn' : ''}">${c.budget ? (left < 0 ? 'חריגה ' + money(-left) : 'נשאר ' + money(left)) : money(sp)}</span></div>
      <div class="bar ${cls}"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%;--c:${c.color}"></i></div></div></div>`;
}

/** Exactly one card: the most useful thing to do right now. */
function nextStep(S, C, key) {
  const pend = needsCategory(S, state.tx, key);
  if (pend.length) {
    const t = pend[0];
    const usage = {};
    for (const x of state.tx) if (x.kind === 'expense' && x.category && x.category !== 'other') usage[x.category] = (usage[x.category] || 0) + 1;
    const quick = S.categories.filter(c => c.id !== 'other').sort((a, b) => (usage[b.id] || 0) - (usage[a.id] || 0)).slice(0, 5);
    return `<section class="card next ask" data-ib="${esc(t.id)}">
      <div class="nx-h"><span class="nx-ic">${ic('sparkle')}</span><b>לאן זה שייך?</b><span class="nx-count">${pend.length > 1 ? `1 מתוך ${pend.length}` : ''}</span></div>
      <div class="ib-top"><b>${esc(t.merchant)}</b><b>${money(t.amount, 'auto')}</b></div>
      <div class="ib-meta">${shortDate(t.date)}${t.time ? ' · ' + esc(t.time) : ''}${t.place ? ' · ' + esc(t.place) : ''} · <a href="https://www.google.com/search?q=${encodeURIComponent(t.merchant)}" target="_blank" rel="noopener noreferrer">מה זה?</a></div>
      <div class="chips">${quick.map(c => `<button type="button" class="qchip" data-cat="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}
        <button type="button" class="qchip more" data-more="1">${ic('dots')}כל הקטגוריות</button><button type="button" class="qchip keep" data-keep="1">דלג</button></div></section>`;
  }
  const hasSlip = C.inPeriod.some(t => t.kind === 'income' && t.source === 'payslip');
  if (C.isCurrent && !hasSlip && new Date().getDate() >= 5)
    return `<section class="card next slip"><div class="nx-h"><span class="nx-ic">${ic('hand-coins')}</span><b>הגיע תלוש המשכורת?</b></div><a class="btn small gold" href="#add" data-go="payslip">${ic('scan')}העלאת תלוש</a></section>`;
  const days = S.lastBackup ? (Date.now() - S.lastBackup) / 86400000 : Infinity;
  if (state.tx.length >= 5 && days >= 7)
    return `<section class="card next backup"><div class="nx-h"><span class="nx-ic">${ic('shield')}</span><b>${S.lastBackup ? `עברו ${Math.floor(days)} ימים מהגיבוי האחרון` : 'עוד לא גיבית'}</b></div>
      <p>הנתונים נשמרים רק בטלפון. גיבוי לדרייב או ל-iCloud שומר עליהם גם אם הטלפון יוחלף או שהדפדפן ימחק אותם.</p><a class="btn small primary" href="#more">${ic('download')}לגבות עכשיו</a></section>`;
  const over = S.categories.map(c => ({ c, sp: C.byCat[c.id] || 0 })).filter(x => x.c.budget > 0 && x.sp > x.c.budget).sort((a, b) => (b.sp - b.c.budget) - (a.sp - a.c.budget))[0];
  if (over) return `<section class="card next warnc"><div class="nx-h"><span class="nx-ic">${ic('warning')}</span><b>"${esc(over.c.name)}" עבר את התקציב</b></div>
      <p>חריגה של ${money(over.sp - over.c.budget)}. אפשר להעביר תקציב מקטגוריה אחרת, או לעצור כאן עד סוף החודש.</p><a class="btn small" href="#budget">${ic('sliders')}לעדכן תקציב</a></section>`;
  const I = monthInsights(S, state.tx, key);
  const good = I.list.find(x => x.tone === 'good' || x.tone === 'tip');
  if (good) return `<section class="card next goodc"><div class="nx-h"><span class="nx-ic">${ic(good.icon)}</span><b>${good.tone === 'tip' ? 'רעיון לחיסכון' : 'יפה מאוד'}</b></div><p>${esc(good.text)}</p></section>`;
  return `<section class="card next goodc"><div class="nx-h"><span class="nx-ic">${ic('check')}</span><b>הכל מסודר</b></div><p>אין כרגע מה לעשות. נתראה בקנייה הבאה.</p></section>`;
}

function classify(id, catId, skipped = false) {
  const t = state.tx.find(x => x.id === id); if (!t) return;
  const generic = isGenericMerchant(t.merchant);
  const n = normMerchant(t.merchant);
  // "כסף שחזר" is about this one purchase - never spread to other purchases or learned for the shop
  const one = generic || catId === 'refund';
  const list = one ? [t] : state.tx.filter(x => x.kind === 'expense' && (x.id === t.id || ((x.category || 'other') === 'other' && !x.confirmed && sameBusiness(x.merchant, t.merchant))));
  if (!one && catId !== 'other') { state.settings.rules[n] = catId; persist(); }
  upsertTx(list.map(x => ({ ...x, category: catId, confirmed: true })));
  changed();
  toast(skipped ? 'נשאר בשונות. אפשר לשנות בכל רגע ברשימת התנועות.' : catId === 'other' ? 'סווג ל"שונות"' : catId === 'refund' ? `סומן ככסף שחזר. ₪${fmt0(t.amount)} לא נספרים יותר כהוצאה.` : `סווג ל"${catById(catId).name}"${list.length > 1 ? ` (${list.length} קניות)` : ''}${generic ? '' : ' · נלמד לפעם הבאה'}`);
}

function wire(el, cats) {
  const ask = $('.next.ask', el);
  if (ask) {
    const id = ask.dataset.ib;
    ask.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => classify(id, b.dataset.cat));
    ask.querySelector('[data-keep]').onclick = () => classify(id, 'other', true);
    ask.querySelector('[data-more]').onclick = () => {
      openSheet('בחירת קטגוריה', `<div class="chips big">${state.settings.categories.map(c => `<button type="button" class="qchip" data-c="${esc(c.id)}" style="--c:${c.color}">${ic(c.icon)}${esc(c.name)}</button>`).join('')}<button type="button" class="qchip new" data-new style="--c:#3D7BFA">${ic('plus')}קטגוריה חדשה</button></div>
        <div class="nc-inline" hidden><input type="text" maxlength="40" placeholder="שם הקטגוריה, למשל: כרטיס נטען" aria-label="שם הקטגוריה החדשה"><button class="btn small primary" type="button" data-nc-ok>הוספה וסיווג</button></div>`, (sh, close) => {
        sh.querySelectorAll('[data-c]').forEach(b => b.onclick = () => { close(); classify(id, b.dataset.c); });
        const box = sh.querySelector('.nc-inline'), inp = box.querySelector('input');
        sh.querySelector('[data-new]').onclick = () => { box.hidden = false; inp.focus(); };
        const add = () => { const nid = addCategory(inp.value); if (!nid) { inp.focus(); return; } close(); classify(id, nid); };
        box.querySelector('[data-nc-ok]').onclick = add; inp.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      });
    };
  }
  const bindCats = root => $$('[data-catd]', root).forEach(r => {
    const open = () => openCategory(r.dataset.catd);
    r.onclick = open; r.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  });
  bindCats(el);
  const all = $('#all-cats', el);
  if (all) all.onclick = () => openSheet('כל הקטגוריות', `<div class="cats">${cats.map(catLine).join('')}</div>`, sh => bindCats(sh));
  const go = $('[data-go="payslip"]', el);
  if (go) go.onclick = () => { state.ui.addMode = 'payslip'; };
  const dep = $('#dep', el);
  if (dep) dep.onclick = () => {
    const g = state.settings.goals.find(x => x.target > x.saved) || state.settings.goals[0];
    g.saved = Math.round((g.saved + g.monthly) * 100) / 100; persist();
    try { navigator.vibrate && navigator.vibrate(30); } catch { }
    celebrate(dep); toast(g.saved >= g.target ? `הגעת ליעד "${g.name}"! 🎉` : `כל הכבוד! עוד ₪${fmt0(g.monthly)} בדרך ל"${g.name || 'יעד'}"`);
    setTimeout(changed, 650);
  };
  $('#analysis', el).onclick = openAnalysis;
}

/* motion helpers (all respect reduced motion) */
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
/** A small, soft "well done" pulse on the element that was tapped. */
function celebrate(el) { if (!el || calm() || !el.animate) return; el.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }], { duration: 420, easing: 'cubic-bezier(.34,1.56,.64,1)' }); buzz(15); }
/** Soft entrance when you arrive at the screen (not on every small update). */
let entering = true;
addEventListener('hashchange', () => { entering = true; });
function enter(el) {
  const ring = $('.ring-fg', el);
  if (!entering || calm()) return;
  entering = false;
  el.classList.remove('enter'); void el.offsetWidth; el.classList.add('enter');
  if (ring) { const off = ring.dataset.off; ring.style.transition = 'none'; ring.setAttribute('stroke-dashoffset', CIRC.toFixed(1)); void ring.getBoundingClientRect(); ring.style.transition = ''; requestAnimationFrame(() => ring.setAttribute('stroke-dashoffset', off)); }
}
/* the big number counts up once per screen visit */
let lastShown = null;
let lastCounted = null;
function countUp(el) {
  const sv = $('#saved-n', el);
  if (sv && sv.dataset.from != null && !calm()) { const to = +sv.dataset.count, fr = +sv.dataset.from, t0 = performance.now(); const st = now => { const p = Math.min(1, (now - t0 - 500) / 700); if (p < 0) { requestAnimationFrame(st); return; } const e = 1 - Math.pow(1 - p, 4); sv.innerHTML = money(Math.round(fr + (to - fr) * e)); if (p < 1) requestAnimationFrame(st); else sv.classList.add('pop'); }; requestAnimationFrame(st); }
  const b = $('.h-big', el); if (!b || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const target = +b.dataset.count, sig = state.ui.curKey + ':' + target;
  const from = b.dataset.from != null ? +b.dataset.from : lastShown && lastShown.key === state.ui.curKey ? lastShown.v : 0;
  lastShown = { key: state.ui.curKey, v: target };
  if (lastCounted === sig || target === from || calm()) return; lastCounted = sig;
  const t0 = performance.now(), dur = 650;
  const step = now => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 5); b.innerHTML = money(Math.round(from + (target - from) * e)); if (p < 1) requestAnimationFrame(step); else { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); } };
  requestAnimationFrame(step);
}

function openCategory(id) {
  const c = catById(id), C = monthSummary(state.settings, state.tx, state.ui.curKey);
  const list = C.variable.filter(t => (t.category || 'other') === c.id).sort((a, b) => b.date.localeCompare(a.date));
  const sp = list.reduce((a, t) => a + t.amount, 0);
  openSheet(c.name, `<div class="cat-head">${catIcon(c)}<div><b>${money(sp)}</b><span class="muted"> ${c.budget ? `מתוך ${money(c.budget)}` : 'ללא תקציב'} · ${list.length} קניות</span></div></div>
    ${c.budget ? `<div class="bar ${sp > c.budget ? 'bad' : sp > c.budget * .8 ? 'warn' : ''}"><i style="width:${Math.min(100, sp / c.budget * 100).toFixed(1)}%;--c:${c.color}"></i></div>` : ''}
    <div class="tx-list">${list.map(txRow).join('') || '<p class="muted">אין קניות בקטגוריה הזו החודש.</p>'}</div>`, (sh, close) => {
    sh.addEventListener('click', e => { if (e.target.closest('[data-tx]')) close(); }, true);
  });
}

/** Charts and comparisons, on demand only. */
function openAnalysis() {
  const S = state.settings, key = state.ui.curKey, C = monthSummary(S, state.tx, key), I = monthInsights(S, state.tx, key);
  const parts = [];
  const base = Math.max(C.income, C.fixedTotal + C.savings + Math.max(0, C.spent), 1);
  const segs = [['קבועות', C.fixedTotal, 'var(--lilac)'], ['חיסכון', C.savings, 'var(--yellow)'], ['הוצאות', Math.max(0, C.spent), C.remaining < 0 ? 'var(--bad)' : 'var(--orange)'], ['נשאר', Math.max(0, C.remaining), 'var(--green)']];
  parts.push(`<h3>חלוקת ההכנסה · ${money(C.income)}</h3><div class="split">${segs.map(s => s[1] > 0 ? `<i style="width:${(s[1] / base * 100).toFixed(2)}%;background:${s[2]}"></i>` : '').join('')}</div>
    <div class="legend">${segs.map(s => `<span><i class="dot" style="background:${s[2]}"></i>${s[0]} ${money(s[1])}</span>`).join('')}</div>`);
  if (I.stats) parts.push(`<div class="tiles"><div class="tile t-orange"><span>${ic('receipt')}הקנייה הגדולה</span><b>${money(I.stats.biggest.amount)}</b><small>${esc(I.stats.biggest.merchant)}</small></div>
    <div class="tile t-blue"><span>${ic('coins')}מובילה</span><b>${money(I.stats.topCat.amount)}</b><small>${esc(I.stats.topCat.name)}</small></div>
    <div class="tile t-green"><span>${ic('calendar')}ליום</span><b>${money(I.stats.perDay)}</b><small>${I.stats.count} קניות</small></div></div>`);
  if (C.refunded > 0) parts.push(`<div class="ins good">${ic('arrow-u-up-left')}<p>חזרו לך החודש ${money(C.refunded, 'auto')} (${C.refundCount === 1 ? 'קנייה אחת' : C.refundCount + ' קניות'}). הן מופיעות ברשימה אבל לא נספרות כהוצאה.</p></div>`);
  if (I.list.length) parts.push(`<h3>שמנו לב</h3><div class="insights">${I.list.map(x => `<div class="ins ${x.tone}">${ic(x.icon)}<p>${esc(x.text)}</p></div>`).join('')}</div>`);
  const slices = S.categories.map(c => ({ c, v: Math.max(0, C.byCat[c.id] || 0) })).filter(x => x.v > 0).sort((a, b) => b.v - a.v);
  const tot = slices.reduce((a, x) => a + x.v, 0);
  if (tot > 0) {
    const Rr = 15.9155; let off = 25;
    const arcs = slices.map(x => { const p = x.v / tot * 100; const s = `<circle r="${Rr}" cx="21" cy="21" fill="none" stroke="${x.c.color}" stroke-width="5" stroke-dasharray="${Math.max(0, p - .6).toFixed(3)} ${(100 - p + .6).toFixed(3)}" stroke-dashoffset="${off.toFixed(3)}" stroke-linecap="round"></circle>`; off -= p; return s; }).join('');
    parts.push(`<h3>לאן הלך הכסף</h3><div class="donut-wrap"><svg class="donut" viewBox="0 0 42 42" role="img" aria-label="הוצאות לפי קטגוריה">${arcs}<text x="21" y="19.6" text-anchor="middle" class="d-k">הוצאות</text><text x="21" y="25" text-anchor="middle" class="d-v">₪${fmt0(tot)}</text></svg>
      <div class="dlist">${slices.slice(0, 7).map(x => `<div><i class="dot" style="background:${x.c.color}"></i><span class="grow">${esc(x.c.name)}</span><span class="muted num">${Math.round(x.v / tot * 100)}%</span>${money(x.v)}</div>`).join('')}</div></div>`);
  }
  const keys = Array.from({ length: 6 }, (_, i) => shiftKey(key, i - 5));
  const hist = keys.map(k => { const m = monthSummary(S, state.tx, k); return { k, spent: Math.max(0, m.spent), avail: Math.max(0, m.available), has: m.inPeriod.length > 0 }; });
  if (hist.filter(h => h.has).length >= 2) {
    const max = Math.max(...hist.map(h => Math.max(h.spent, h.avail)), 1);
    parts.push(`<h3>חצי שנה אחרונה</h3><div class="months">${hist.map(h => `<div class="mcol ${h.k === key ? 'cur' : ''}"><div class="mbar-wrap"><i class="mbar-b" style="height:${(h.avail / max * 100).toFixed(1)}%"></i><i class="mbar ${h.spent > h.avail && h.avail ? 'over' : ''}" style="height:${(h.spent / max * 100).toFixed(1)}%"></i></div>
      <span class="mlbl">${MONTHS[+h.k.slice(5) - 1].slice(0, 3)}</span><span class="mval num">${h.spent ? '₪' + fmt0(h.spent) : '–'}</span></div>`).join('')}</div>`);
  }
  openSheet('ניתוח החודש', `<div class="analysis">${parts.join('') || '<p class="muted">עוד אין מספיק נתונים לחודש הזה.</p>'}</div>`);
}
