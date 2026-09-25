/* ============================================================
   Smart Budget PRO 3.0
   الميزانية الذكية - مع دورة الراتب والإشعارات والراتب التلقائي
   ============================================================ */
'use strict';

const APP_VERSION = 3;
const STORAGE_PREFIX = 'budget_';
const SETTINGS_KEY = 'budgetSettings';
const PAYDAY_APPLIED_KEY = 'budget_payday_applied';
const PAYDAY_DISMISSED_KEY = 'paydayBannerDismissed';
const OLD_PREFIX = 'ultra_';

const state = {
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  payday: 1,
  notify: false,
  autoAddIncome: false,
  income: 0,
  incomeSources: [],
  categories: {},
  expenses: [],
  recurring: [],
  goals: [],
  nextId: 1,
  filters: { search: '', category: '', from: '', to: '' },
  charts: { bar: null, line: null, pie: null, compare: null }
};

/* ==================== TOAST ==================== */
function toast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('hide');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

/* ==================== MODAL ==================== */
function showModal(html, onMount) {
  const modal = document.getElementById('genericModal');
  const content = document.getElementById('genericModalContent');
  content.innerHTML = html;
  modal.style.display = 'flex';
  content.querySelectorAll('.modal-close').forEach(b => b.addEventListener('click', closeModal));
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  if (typeof onMount === 'function') onMount(content);
}
function closeModal() {
  const m = document.getElementById('genericModal');
  if (m) m.style.display = 'none';
  const c = document.getElementById('genericModalContent');
  if (c) c.innerHTML = '';
}
function confirmModal(message, onConfirm) {
  showModal(`
    <button class="modal-close">&times;</button>
    <h3>تأكيد</h3>
    <p>${escapeHtml(message)}</p>
    <div class="modal-actions">
      <button class="ghost" id="mCancel">إلغاء</button>
      <button class="danger" id="mConfirm">تأكيد</button>
    </div>
  `, (c) => {
    c.querySelector('#mCancel').addEventListener('click', closeModal);
    c.querySelector('#mConfirm').addEventListener('click', () => { closeModal(); onConfirm(); });
  });
}

/* ==================== HELPERS ==================== */
function escapeHtml(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
function formatMoney(amount) {
  const c = document.getElementById('settingsCurrency')?.value || 'ر.س';
  return `${(Number(amount) || 0).toFixed(2)} ${c}`;
}
function formatDate(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}
function todayISO() { return new Date().toISOString().slice(0, 10); }
function toISO(date) { return date.toISOString().slice(0, 10); }
function uid() { return state.nextId++; }
function debounce(fn, delay = 250) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), delay); };
}

/* ============================================================
   دورة الراتب (بتقبض إمتى)
   ============================================================ */
function getCycleRange(year, month) {
  const payday = Math.min(Math.max(state.payday || 1, 1), 28);
  const start = new Date(year, month - 1, payday);
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextStart = new Date(nextYear, nextMonth - 1, payday);
  const end = new Date(nextStart.getTime() - 24 * 60 * 60 * 1000);
  return {
    start, end,
    startISO: toISO(start),
    endISO: toISO(end),
    daysTotal: Math.round((end - start) / 86400000) + 1
  };
}

function getCurrentCycle() {
  const payday = Math.min(Math.max(state.payday || 1, 1), 28);
  const today = new Date();
  const todayDay = today.getDate();
  let year = today.getFullYear();
  let month = today.getMonth() + 1;
  if (todayDay < payday) {
    month--;
    if (month === 0) { month = 12; year--; }
  }
  return { year, month };
}

function isDateInCycle(dateISO, year, month) {
  if (!dateISO) return false;
  const range = getCycleRange(year, month);
  return dateISO >= range.startISO && dateISO <= range.endISO;
}

function recurringDateInCycle(cycleYear, cycleMonth, dayOfMonth) {
  const payday = Math.min(Math.max(state.payday || 1, 1), 28);
  let ty = cycleYear, tm = cycleMonth;
  if (dayOfMonth < payday) {
    tm++;
    if (tm > 12) { tm = 1; ty++; }
  }
  return `${ty}-${String(tm).padStart(2,'0')}-${String(dayOfMonth).padStart(2,'0')}`;
}

function renderCycleInfo() {
  const range = getCycleRange(state.year, state.month);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const rangeEl = document.getElementById('cycleRange');
  if (rangeEl) {
    const fmt = (d) => d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'long' });
    rangeEl.textContent = `${fmt(range.start)}  →  ${fmt(range.end)}`;
  }

  const elapsed = Math.max(0, Math.min(range.daysTotal, Math.round((today - range.start) / 86400000) + 1));
  const left = Math.max(0, range.daysTotal - elapsed);
  const pct = Math.min(100, (elapsed / range.daysTotal) * 100);

  const eEl = document.getElementById('cycleDaysElapsed');
  const lEl = document.getElementById('cycleDaysLeft');
  const pEl = document.getElementById('cycleProgressPct');
  const bEl = document.getElementById('cycleProgressBar');
  if (eEl) eEl.textContent = elapsed;
  if (lEl) lEl.textContent = left;
  if (pEl) pEl.textContent = pct.toFixed(0) + '%';
  if (bEl) bEl.style.width = pct + '%';
}

/* ============================================================
   إشعار يوم القبض + الراتب التلقائي
   ============================================================ */
function checkPayday() {
  const today = new Date();
  const todayDay = today.getDate();
  const payday = Math.min(Math.max(state.payday || 1, 1), 28);
  const diff = payday - todayDay;
  const isPaydayToday = todayDay === payday;

  // 1) إضافة الراتب تلقائياً
  if (state.autoAddIncome && (isPaydayToday || diff < 0)) {
    const cycleKey = `${state.year}-${state.month}`;
    let applied = {};
    try { applied = JSON.parse(localStorage.getItem(PAYDAY_APPLIED_KEY) || '{}'); } catch { applied = {}; }

    if (!applied[cycleKey]) {
      const salary = parseFloat(document.getElementById('income').value) || 0;
      const hasAuto = state.incomeSources.some(s => s.auto);

      if (salary > 0 && !hasAuto) {
        state.incomeSources.push({
          id: uid(),
          name: '💰 الراتب (تلقائي)',
          amount: salary,
          auto: true,
          appliedDate: todayISO(),
          cycleKey: cycleKey
        });
        applied[cycleKey] = todayISO();
        localStorage.setItem(PAYDAY_APPLIED_KEY, JSON.stringify(applied));
        saveMonth();
        toast('✅ تم إضافة الراتب تلقائياً لهذه الدورة', 'success', 3500);
      }
    }
  }

  // 2) عرض البانر
  renderPaydayBanner(isPaydayToday, diff);

  // 3) إشعار المتصفح
  if (isPaydayToday && state.notify && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification('💰 يوم القبض!', {
          body: 'اليوم هو يوم استلام راتبك. لا تنسَ تسجيله.',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="75" font-size="80">💰</text></svg>',
          tag: 'payday-' + todayISO()
        });
      } catch (e) { /* تجاهل */ }
    }
  }
}

function renderPaydayBanner(isPaydayToday, diff) {
  const banner = document.getElementById('paydayBanner');
  if (!banner) return;

  const dismissed = localStorage.getItem(PAYDAY_DISMISSED_KEY);
  const todayKey = todayISO();
  if (dismissed === todayKey) { banner.style.display = 'none'; return; }

  const cycleKey = `${state.year}-${state.month}`;
  let applied = {};
  try { applied = JSON.parse(localStorage.getItem(PAYDAY_APPLIED_KEY) || '{}'); } catch { applied = {}; }

  if (isPaydayToday) {
    banner.className = 'payday-banner';
    banner.innerHTML = `
      <div class="pb-icon">🎉</div>
      <div class="pb-content">
        <div class="pb-title">اليوم هو يوم القبض!</div>
        <div class="pb-desc">
          ${applied[cycleKey]
            ? '✅ تم تسجيل راتبك تلقائياً لهذه الدورة.'
            : 'لا تنسَ تسجيل راتبك لهذه الدورة.'}
        </div>
      </div>
      <button class="pb-close" aria-label="إغلاق">✕</button>
    `;
  } else if (diff === 1) {
    banner.className = 'payday-banner reminder-urgent';
    banner.innerHTML = `
      <div class="pb-icon">⏰</div>
      <div class="pb-content">
        <div class="pb-title">غداً يوم القبض!</div>
        <div class="pb-desc">باقي يوم واحد فقط. استعد للدورة الجديدة.</div>
      </div>
      <button class="pb-close" aria-label="إغلاق">✕</button>
    `;
  } else if (diff > 1 && diff <= 3) {
    banner.className = 'payday-banner reminder';
    banner.innerHTML = `
      <div class="pb-icon">📅</div>
      <div class="pb-content">
        <div class="pb-title">باقي ${diff} أيام على القبض</div>
        <div class="pb-desc">استعد مالياً للدورة الجديدة.</div>
      </div>
      <button class="pb-close" aria-label="إغلاق">✕</button>
    `;
  } else {
    banner.style.display = 'none';
    return;
  }

  banner.style.display = 'flex';
  banner.querySelector('.pb-close')?.addEventListener('click', () => {
    banner.style.display = 'none';
    localStorage.setItem(PAYDAY_DISMISSED_KEY, todayKey);
  });
}

function requestNotificationPermission() {
  if (!('Notification' in window)) {
    toast('المتصفح لا يدعم الإشعارات', 'warning');
    return;
  }
  if (Notification.permission === 'granted') return;
  if (Notification.permission === 'denied') {
    toast('تم رفض إذن الإشعارات سابقاً. فعّله من إعدادات المتصفح.', 'warning', 4000);
    return;
  }
  Notification.requestPermission().then(p => {
    if (p === 'granted') toast('تم تفعيل إشعارات المتصفح ✅', 'success');
  });
}

/* ==================== SIDEBAR ==================== */
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('overlay').classList.add('show');
}
function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('overlay').classList.remove('show');
}
function toggleSidebar() {
  document.getElementById('sidebar').classList.contains('open') ? closeSidebar() : openSidebar();
}
function navigateTo(pageName) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + pageName);
  if (page) page.classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === pageName);
  });
  closeSidebar();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  if (pageName === 'charts') {
    setTimeout(() => { drawBarChart(); drawLineChart(); drawPieChart(); }, 80);
  }
}

/* ==================== STORAGE ==================== */
function storageKey(y = state.year, m = state.month) {
  return `${STORAGE_PREFIX}${y}_${m}`;
}
function emptyMonth() {
  return { version: APP_VERSION, income: 0, incomeSources: [], categories: {}, expenses: [], recurring: [], goals: [], nextId: 1 };
}
function loadMonth(year, month) {
  const raw = localStorage.getItem(storageKey(year, month));
  if (!raw) return emptyMonth();
  try { return migrateMonthSchema(JSON.parse(raw)); }
  catch (e) { toast('تعذر قراءة بيانات الدورة', 'error'); return emptyMonth(); }
}
function migrateMonthSchema(d) {
  d.version = d.version || 1;
  d.incomeSources = d.incomeSources || [];
  d.recurring = d.recurring || [];
  d.goals = d.goals || [];
  d.nextId = d.nextId || 1;
  if (d.dailyExpenses && !d.expenses) {
    d.expenses = [];
    for (const [cat, arr] of Object.entries(d.dailyExpenses)) {
      if (Array.isArray(arr)) arr.forEach(x => d.expenses.push({
        id: d.nextId++, category: cat, date: x.date, amount: x.amount, note: ''
      }));
    }
    delete d.dailyExpenses;
  }
  d.expenses = d.expenses || [];
  for (const n in d.categories) if (!d.categories[n].color) d.categories[n].color = '#3b82f6';
  return d;
}
function saveMonth() {
  localStorage.setItem(storageKey(), JSON.stringify({
    version: APP_VERSION,
    income: parseFloat(document.getElementById('income').value) || 0,
    incomeSources: state.incomeSources,
    categories: state.categories,
    expenses: state.expenses,
    recurring: state.recurring,
    goals: state.goals,
    nextId: state.nextId
  }));
}
function loadCurrentMonth() {
  const d = loadMonth(state.year, state.month);
  state.income = d.income || 0;
  state.incomeSources = d.incomeSources || [];
  state.categories = d.categories || {};
  state.expenses = d.expenses || [];
  state.recurring = d.recurring || [];
  state.goals = d.goals || [];
  state.nextId = d.nextId || 1;
  document.getElementById('income').value = state.income || '';
  applyRecurringForCurrentMonth();
}

function applyRecurringForCurrentMonth() {
  const range = getCycleRange(state.year, state.month);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (range.start > today) return;

  const key = `${state.year}-${state.month}`;
  let applied = 0;

  for (const rec of state.recurring) {
    if (rec.lastApplied === key) continue;
    const targetDate = recurringDateInCycle(state.year, state.month, rec.day);
    const exists = state.expenses.some(e => e.recurringId === rec.id && e.date === targetDate);
    if (exists) { rec.lastApplied = key; continue; }
    if (targetDate > toISO(today)) continue;

    state.expenses.push({
      id: uid(),
      category: rec.category,
      date: targetDate,
      amount: rec.amount,
      note: rec.note || 'مصروف متكرر',
      recurringId: rec.id
    });
    if (state.categories[rec.category]) state.categories[rec.category].amount += rec.amount;
    rec.lastApplied = key;
    applied++;
  }
  if (applied) { saveMonth(); toast(`تم إضافة ${applied} مصروف متكرر`, 'info'); }
}

/* ==================== CALCULATIONS ==================== */
function calcTotalIncome() {
  const baseIncome = parseFloat(document.getElementById('income').value) || 0;
  const autoSalary = state.incomeSources
    .filter(s => s.auto)
    .reduce((sum, x) => sum + (x.amount || 0), 0);
  const extras = state.incomeSources
    .filter(s => !s.auto)
    .reduce((sum, x) => sum + (x.amount || 0), 0);
  return (autoSalary > 0 ? autoSalary : baseIncome) + extras;
}
function calcTotalExpenses() {
  return Object.values(state.categories).reduce((s, c) => s + (c.amount || 0), 0);
}
function calcDailySum() {
  const today = todayISO();
  const out = {};
  state.expenses.forEach(e => { if (e.date === today) out[e.category] = (out[e.category] || 0) + e.amount; });
  return out;
}
function calcWeeklySum() {
  const today = new Date();
  const ago = new Date(); ago.setDate(today.getDate() - 7);
  const out = {};
  state.expenses.forEach(e => {
    const d = new Date(e.date);
    if (d >= ago && d <= today) out[e.category] = (out[e.category] || 0) + e.amount;
  });
  return out;
}
function calcForecast() {
  const range = getCycleRange(state.year, state.month);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysElapsed = Math.max(1, Math.min(range.daysTotal, Math.round((today - range.start) / 86400000) + 1));
  const total = calcTotalExpenses();
  if (daysElapsed < 3) return { projected: total, avg: 0, daysInCycle: range.daysTotal, daysElapsed };
  const avg = total / daysElapsed;
  return { projected: avg * range.daysTotal, avg, daysInCycle: range.daysTotal, daysElapsed };
}

/* ==================== RENDER: CATEGORIES ==================== */
function renderCategories() {
  const c = document.getElementById('categoriesList');
  c.innerHTML = '';
  const entries = Object.entries(state.categories);
  if (!entries.length) {
    c.innerHTML = `<div class="muted" style="padding:.5rem;">لا توجد فئات بعد. أضف فئة للبدء.</div>`;
    return;
  }
  for (const [name, cat] of entries) {
    const div = document.createElement('div');
    div.style.borderInlineStartColor = cat.color || '#3b82f6';
    const limit = cat.monthlyLimit || 0;
    const pct = limit > 0 ? Math.min(100, (cat.amount / limit) * 100) : 0;
    const barColor = pct >= 100 ? 'var(--danger)' : pct >= 80 ? 'var(--warning)' : 'var(--success)';
    div.innerHTML = `
      <span><strong>${escapeHtml(name)}</strong></span>
      <span class="muted">المصروف: <b>${formatMoney(cat.amount)}</b>${limit ? ` / ${formatMoney(limit)}` : ''}</span>
      ${limit ? `<div class="progress"><div style="width:${pct}%;background:${barColor};"></div></div>` : ''}
      <span class="muted" style="font-size:.78rem;">يومي: ${formatMoney(cat.dailyLimit || 0)}</span>
      <span class="muted" style="font-size:.78rem;">أسبوعي: ${formatMoney(cat.weeklyLimit || 0)}</span>
    `;
    const act = document.createElement('div');
    act.style.marginInlineStart = 'auto';
    act.style.display = 'flex';
    act.style.gap = '.3rem';
    const eb = document.createElement('button'); eb.textContent = '✏️';
    eb.addEventListener('click', () => openCategoryModal(name));
    const db = document.createElement('button'); db.textContent = '🗑️'; db.classList.add('danger');
    db.addEventListener('click', () => deleteCategory(name));
    act.append(eb, db);
    div.appendChild(act);
    c.appendChild(div);
  }
}

function openCategoryModal(oldName) {
  const isEdit = !!oldName;
  const cat = isEdit ? state.categories[oldName] : { amount: 0, monthlyLimit: 0, dailyLimit: 0, weeklyLimit: 0, color: '#3b82f6' };
  showModal(`
    <button class="modal-close">&times;</button>
    <h3>${isEdit ? '✏️ تعديل فئة' : '➕ إضافة فئة'}</h3>
    <label>اسم الفئة</label>
    <input type="text" id="mName" value="${escapeHtml(oldName || '')}">
    <label>اللون</label>
    <input type="color" id="mColor" value="${cat.color || '#3b82f6'}">
    <label>المبلغ المصروف</label>
    <input type="number" id="mAmount" value="${cat.amount || 0}" step="0.01">
    <label>الميزانية الشهرية</label>
    <input type="number" id="mMonthly" value="${cat.monthlyLimit || 0}" step="0.01">
    <label>الحد اليومي</label>
    <input type="number" id="mDaily" value="${cat.dailyLimit || 0}" step="0.01">
    <label>الحد الأسبوعي</label>
    <input type="number" id="mWeekly" value="${cat.weeklyLimit || 0}" step="0.01">
    <div class="modal-actions">
      <button class="ghost" id="mCancel">إلغاء</button>
      <button id="mSave">${isEdit ? 'حفظ' : 'إضافة'}</button>
    </div>
  `, (r) => {
    r.querySelector('#mCancel').addEventListener('click', closeModal);
    r.querySelector('#mSave').addEventListener('click', () => {
      const name = r.querySelector('#mName').value.trim();
      if (!name) return toast('اسم الفئة مطلوب', 'error');
      if (name !== oldName && state.categories[name]) return toast('الفئة موجودة', 'error');
      const data = {
        amount: parseFloat(r.querySelector('#mAmount').value) || 0,
        monthlyLimit: parseFloat(r.querySelector('#mMonthly').value) || 0,
        dailyLimit: parseFloat(r.querySelector('#mDaily').value) || 0,
        weeklyLimit: parseFloat(r.querySelector('#mWeekly').value) || 0,
        color: r.querySelector('#mColor').value || '#3b82f6'
      };
      if (isEdit && name !== oldName) {
        state.expenses.forEach(e => { if (e.category === oldName) e.category = name; });
        state.recurring.forEach(x => { if (x.category === oldName) x.category = name; });
        delete state.categories[oldName];
      }
      state.categories[name] = data;
      saveMonth(); renderAll(); closeModal();
      toast(isEdit ? 'تم التحديث' : 'تم الإضافة', 'success');
    });
  });
}
function deleteCategory(name) {
  confirmModal(`حذف الفئة "${name}" وجميع مصروفاتها؟`, () => {
    state.expenses = state.expenses.filter(e => e.category !== name);
    state.recurring = state.recurring.filter(r => r.category !== name);
    delete state.categories[name];
    saveMonth(); renderAll(); toast('تم الحذف', 'success');
  });
}

/* ==================== RENDER: EXPENSES ==================== */
function getFilteredExpenses() {
  const f = state.filters;
  return state.expenses
    .filter(e => !f.search || (e.category + ' ' + (e.note || '')).toLowerCase().includes(f.search.toLowerCase()))
    .filter(e => !f.category || e.category === f.category)
    .filter(e => !f.from || e.date >= f.from)
    .filter(e => !f.to || e.date <= f.to)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
function renderExpenses() {
  const c = document.getElementById('dailyExpensesList');
  const list = getFilteredExpenses();
  c.innerHTML = '';
  if (!list.length) {
    c.innerHTML = `<div class="muted" style="padding:.5rem;">لا توجد مصروفات مطابقة.</div>`;
  }
  list.slice(0, 300).forEach(exp => {
    const div = document.createElement('div');
    div.className = 'expense-item';
    div.style.borderInlineStartColor = state.categories[exp.category]?.color || '#3b82f6';
    div.innerHTML = `
      <span><b>${escapeHtml(exp.category)}</b></span>
      <span class="muted">${formatDate(exp.date)}</span>
      <span class="bad">${formatMoney(exp.amount)}</span>
      <span class="muted" style="flex:1;min-width:80px;">${escapeHtml(exp.note || '')}</span>
    `;
    const act = document.createElement('div');
    act.style.display = 'flex'; act.style.gap = '.3rem';
    const eb = document.createElement('button'); eb.textContent = '✏️';
    eb.addEventListener('click', () => openExpenseModal(exp.id));
    const db = document.createElement('button'); db.textContent = '🗑️'; db.classList.add('danger');
    db.addEventListener('click', () => deleteExpense(exp.id));
    act.append(eb, db);
    div.appendChild(act);
    c.appendChild(div);
  });
  const total = list.reduce((s, e) => s + e.amount, 0);
  document.getElementById('expensesSummary').textContent = `عدد: ${list.length} | الإجمالي: ${formatMoney(total)}`;
}
function openExpenseModal(id) {
  const isEdit = id != null;
  const exp = isEdit ? state.expenses.find(e => e.id === id) : null;
  if (isEdit && !exp) return;
  const opts = Object.keys(state.categories).map(n =>
    `<option value="${escapeHtml(n)}" ${isEdit && exp.category === n ? 'selected' : ''}>${escapeHtml(n)}</option>`
  ).join('');
  if (!opts) return toast('أضف فئة أولاً', 'warning');
  showModal(`
    <button class="modal-close">&times;</button>
    <h3>${isEdit ? '✏️ تعديل مصروف' : '➕ إضافة مصروف'}</h3>
    <label>الفئة</label>
    <select id="mCat">${opts}</select>
    <label>التاريخ</label>
    <input type="date" id="mDate" value="${isEdit ? exp.date : todayISO()}">
    <label>المبلغ</label>
    <input type="number" id="mAmt" value="${isEdit ? exp.amount : ''}" step="0.01">
    <label>ملاحظة</label>
    <input type="text" id="mNote" value="${isEdit ? escapeHtml(exp.note || '') : ''}">
    <div class="modal-actions">
      <button class="ghost" id="mCancel">إلغاء</button>
      <button id="mSave">${isEdit ? 'حفظ' : 'إضافة'}</button>
    </div>
  `, (r) => {
    r.querySelector('#mCancel').addEventListener('click', closeModal);
    r.querySelector('#mSave').addEventListener('click', () => {
      const cat = r.querySelector('#mCat').value;
      const date = r.querySelector('#mDate').value;
      const amount = parseFloat(r.querySelector('#mAmt').value);
      const note = r.querySelector('#mNote').value.trim();
      if (!cat || !date || !amount || amount <= 0) return toast('تحقق من الحقول', 'error');
      if (isEdit) {
        if (state.categories[exp.category]) state.categories[exp.category].amount -= exp.amount;
        if (state.categories[cat]) state.categories[cat].amount += amount;
        Object.assign(exp, { category: cat, date, amount, note });
      } else {
        state.expenses.push({ id: uid(), category: cat, date, amount, note });
        if (state.categories[cat]) state.categories[cat].amount += amount;
      }
      saveMonth(); renderAll(); closeModal();
      toast(isEdit ? 'تم التحديث' : 'تم الإضافة', 'success');
    });
  });
}
function deleteExpense(id) {
  const exp = state.expenses.find(e => e.id === id);
  if (!exp) return;
  confirmModal(`حذف مصروف ${formatMoney(exp.amount)}؟`, () => {
    if (state.categories[exp.category]) state.categories[exp.category].amount -= exp.amount;
    state.expenses = state.expenses.filter(e => e.id !== id);
    saveMonth(); renderAll(); toast('تم الحذف', 'success');
  });
}

/* ==================== RENDER: INCOME / RECURRING / GOALS ==================== */
function renderIncomeSources() {
  const c = document.getElementById('incomeSourcesList');
  c.innerHTML = '';

  if (!state.incomeSources.length) {
    c.innerHTML = `<div class="muted" style="padding:.4rem;">لا توجد مصادر دخل إضافية.</div>`;
    return;
  }

  state.incomeSources.forEach(s => {
    const div = document.createElement('div');
    div.className = 'compact-item' + (s.auto ? ' auto-source' : '');
    div.innerHTML = `
      <span>${s.auto ? '💰' : '💵'} ${escapeHtml(s.name)}
        ${s.auto ? '<span class="salary-badge">تلقائي</span>' : ''}
      </span>
      <span class="good">${formatMoney(s.amount)}</span>
      ${s.auto ? `<span class="muted" style="font-size:.72rem;">${formatDate(s.appliedDate)}</span>` : ''}
    `;
    const db = document.createElement('button');
    db.textContent = '🗑️';
    db.classList.add('danger');
    db.style.marginInlineStart = 'auto';
    db.addEventListener('click', () => {
      state.incomeSources = state.incomeSources.filter(x => x.id !== s.id);
      saveMonth(); renderAll(); toast('تم الحذف', 'success');
    });
    div.appendChild(db);
    c.appendChild(div);
  });
}
function renderRecurring() {
  const c = document.getElementById('recurringList');
  c.innerHTML = '';
  if (!state.recurring.length) {
    c.innerHTML = `<div class="muted" style="padding:.4rem;">لا توجد مصروفات متكررة.</div>`;
    return;
  }
  state.recurring.forEach(rec => {
    const div = document.createElement('div');
    div.className = 'recurring-item';
    const actualDate = recurringDateInCycle(state.year, state.month, rec.day);
    div.innerHTML = `
      <span>🔁 <b>${escapeHtml(rec.note || rec.category)}</b></span>
      <span class="muted">${escapeHtml(rec.category)}</span>
      <span class="bad">${formatMoney(rec.amount)}</span>
      <span class="muted">يوم ${rec.day} → ${formatDate(actualDate)}</span>
    `;
    const db = document.createElement('button'); db.textContent = '🗑️'; db.classList.add('danger');
    db.style.marginInlineStart = 'auto';
    db.addEventListener('click', () => {
      state.recurring = state.recurring.filter(x => x.id !== rec.id);
      saveMonth(); renderAll(); toast('تم الحذف', 'success');
    });
    div.appendChild(db);
    c.appendChild(div);
  });
}
function renderGoals() {
  const c = document.getElementById('goalsList');
  c.innerHTML = '';
  if (!state.goals.length) {
    c.innerHTML = `<div class="muted" style="padding:.4rem;">لا توجد أهداف.</div>`;
    return;
  }
  state.goals.forEach(g => {
    const pct = g.target > 0 ? Math.min(100, (g.saved / g.target) * 100) : 0;
    const color = pct >= 100 ? 'var(--success)' : pct >= 50 ? 'var(--accent)' : 'var(--warning)';
    const div = document.createElement('div');
    div.className = 'goal-item';
    div.innerHTML = `
      <span>🎯 <b>${escapeHtml(g.name)}</b></span>
      <span class="muted">${formatMoney(g.saved)} / ${formatMoney(g.target)}</span>
      <div class="progress"><div style="width:${pct}%;background:${color};"></div></div>
      <span class="muted" style="font-size:.78rem;">${pct.toFixed(0)}%</span>
    `;
    const act = document.createElement('div');
    act.style.marginInlineStart = 'auto'; act.style.display = 'flex'; act.style.gap = '.3rem';
    const ab = document.createElement('button'); ab.textContent = '➕'; ab.title = 'إيداع';
    ab.addEventListener('click', () => promptGoalDeposit(g));
    const db = document.createElement('button'); db.textContent = '🗑️'; db.classList.add('danger');
    db.addEventListener('click', () => {
      state.goals = state.goals.filter(x => x.id !== g.id);
      saveMonth(); renderAll(); toast('تم الحذف', 'success');
    });
    act.append(ab, db);
    div.appendChild(act);
    c.appendChild(div);
  });
}
function promptGoalDeposit(goal) {
  showModal(`
    <button class="modal-close">&times;</button>
    <h3>إيداع في: ${escapeHtml(goal.name)}</h3>
    <label>المبلغ</label>
    <input type="number" id="mDep" step="0.01">
    <div class="modal-actions">
      <button class="ghost" id="mCancel">إلغاء</button>
      <button id="mSave">إيداع</button>
    </div>
  `, (r) => {
    r.querySelector('#mCancel').addEventListener('click', closeModal);
    r.querySelector('#mSave').addEventListener('click', () => {
      const amt = parseFloat(r.querySelector('#mDep').value);
      if (!amt || amt <= 0) return toast('مبلغ غير صحيح', 'error');
      goal.saved = (goal.saved || 0) + amt;
      saveMonth(); renderAll(); closeModal();
      toast(`تم إيداع ${formatMoney(amt)}`, 'success');
    });
  });
}

/* ==================== ANALYZE ==================== */
function analyze() {
  const income = calcTotalIncome();
  const total = calcTotalExpenses();
  const balance = income - total;
  const rate = income > 0 ? (balance / income) * 100 : 0;
  let score = 100;
  if (balance < 0) score -= 30;
  if (rate < 10) score -= 20;
  if (total > income * 0.9) score -= 20;
  score = Math.max(0, Math.min(100, score));

  document.getElementById('statIncome').textContent = formatMoney(income);
  document.getElementById('statExpenses').textContent = formatMoney(total);
  const b = document.getElementById('statBalance');
  b.textContent = formatMoney(balance);
  b.className = `stat-value ${balance >= 0 ? 'good' : 'bad'}`;
  const s = document.getElementById('statScore');
  s.textContent = `${score}/100`;
  s.className = `stat-value ${score > 70 ? 'good' : score > 40 ? 'warning' : 'bad'}`;

  const details = document.getElementById('analysisDetails');
  if (details) {
    details.innerHTML = `
      <div>💵 الدخل: <b>${formatMoney(income)}</b></div>
      <div>💸 المصروفات: <b>${formatMoney(total)}</b></div>
      <div>📉 المتبقي: <b class="${balance >= 0 ? 'good' : 'bad'}">${formatMoney(balance)}</b>
        <span class="muted">(ادخار: ${rate.toFixed(1)}%)</span></div>
    `;
  }

  const insights = buildInsights();
  const ih = insights.length
    ? `<ul>${insights.map(i => `<li>${i}</li>`).join('')}</ul>`
    : `<span class="muted">لا توجد رؤى حالياً.</span>`;
  const ib = document.getElementById('insightsBox');
  if (ib) ib.innerHTML = ih;
  const ab = document.getElementById('analysisInsights');
  if (ab) ab.innerHTML = ih;

  const fb = document.getElementById('forecastBox');
  if (fb) {
    const f = calcForecast();
    fb.innerHTML = `
      <div>📊 المتوسط اليومي: <b>${formatMoney(f.avg)}</b></div>
      <div>🔮 التوقع لنهاية الدورة: <b>${formatMoney(f.projected)}</b></div>
      <div class="muted" style="margin-top:.5rem;">
        بناءً على ${f.daysElapsed} يوم مضت من أصل ${f.daysInCycle} يوم في دورة الراتب
      </div>
    `;
  }

  const db = document.getElementById('dashboardCategories');
  if (db) {
    const sorted = Object.entries(state.categories).sort((a,b) => b[1].amount - a[1].amount).slice(0, 5);
    db.innerHTML = sorted.length
      ? sorted.map(([n, c]) => {
          const max = sorted[0][1].amount || 1;
          const w = (c.amount / max) * 100;
          return `
            <div style="margin-bottom:.7rem;">
              <div style="display:flex;justify-content:space-between;font-size:.87rem;">
                <span><b style="color:${c.color || '#3b82f6'};">●</b> ${escapeHtml(n)}</span>
                <b>${formatMoney(c.amount)}</b>
              </div>
              <div class="progress" style="max-width:none;margin-top:.3rem;">
                <div style="width:${w}%;background:${c.color || '#3b82f6'};"></div>
              </div>
            </div>`;
        }).join('')
      : `<span class="muted">لا توجد فئات بعد.</span>`;
  }

  displayAlerts();
  renderCycleInfo();
  checkPayday();

  if (document.getElementById('page-charts').classList.contains('active')) {
    drawBarChart(); drawLineChart(); drawPieChart();
  }
}
function buildInsights() {
  const out = [];
  const sorted = Object.entries(state.categories).sort((a,b) => b[1].amount - a[1].amount);
  if (sorted.length) out.push(`🏆 أعلى فئة إنفاقاً: <b>${escapeHtml(sorted[0][0])}</b> (${formatMoney(sorted[0][1].amount)})`);
  if (state.expenses.length) {
    const big = [...state.expenses].sort((a,b) => b.amount - a.amount)[0];
    out.push(`💥 أكبر مصروف: ${formatMoney(big.amount)} في "${escapeHtml(big.category)}"`);
  }
  const f = calcForecast();
  if (f.avg > 0) out.push(`🔮 توقع نهاية الدورة: <b>${formatMoney(f.projected)}</b>`);

  const range = getCycleRange(state.year, state.month);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const daysLeft = Math.max(0, Math.round((range.end - today) / 86400000));
  if (daysLeft > 0 && daysLeft <= 5 && f.avg > 0) {
    out.push(`⏰ باقي ${daysLeft} يوم على القبض، متوسط الصرف ${formatMoney(f.avg)}/يوم`);
  }

  const prevMonth = state.month === 1 ? 12 : state.month - 1;
  const prevYear = state.month === 1 ? state.year - 1 : state.year;
  const prev = localStorage.getItem(storageKey(prevYear, prevMonth));
  if (prev) {
    try {
      const pd = JSON.parse(prev);
      const pt = Object.values(pd.categories || {}).reduce((s,c) => s + (c.amount || 0), 0);
      const cur = calcTotalExpenses();
      if (pt > 0) {
        const diff = ((cur - pt) / pt) * 100;
        if (Math.abs(diff) > 5) out.push(`${diff > 0 ? '📈 زيادة' : '📉 انخفاض'} ${Math.abs(diff).toFixed(1)}% مقارنة بالدورة السابقة`);
      }
    } catch {}
  }
  state.goals.forEach(g => {
    const p = g.target > 0 ? (g.saved / g.target) * 100 : 0;
    if (p >= 100) out.push(`🎉 اكتمل هدف "${escapeHtml(g.name)}"!`);
    else if (p >= 75) out.push(`🎯 هدف "${escapeHtml(g.name)}" وصل ${p.toFixed(0)}%`);
  });
  return out;
}

/* ==================== ALERTS ==================== */
function displayAlerts() {
  const c = document.getElementById('alertsContainer');
  c.innerHTML = '';
  const ds = calcDailySum();
  const ws = calcWeeklySum();
  for (const [cat, d] of Object.entries(state.categories)) {
    if (d.dailyLimit && ds[cat] > d.dailyLimit)
      addAlert(`⚠️ ${cat}: تجاوز الحد اليومي (${formatMoney(ds[cat])} / ${formatMoney(d.dailyLimit)})`, 'alert-daily');
    if (d.weeklyLimit && ws[cat] > d.weeklyLimit)
      addAlert(`⚠️ ${cat}: تجاوز الحد الأسبوعي (${formatMoney(ws[cat])} / ${formatMoney(d.weeklyLimit)})`, 'alert-weekly');
    if (d.monthlyLimit && d.amount > d.monthlyLimit)
      addAlert(`⚠️ ${cat}: تجاوز الميزانية الشهرية (${formatMoney(d.amount)} / ${formatMoney(d.monthlyLimit)})`, 'alert-monthly');
  }
}
function addAlert(msg, cls) {
  const div = document.createElement('div');
  div.className = `alerts ${cls}`;
  div.textContent = msg;
  document.getElementById('alertsContainer').appendChild(div);
}

/* ==================== CHARTS ==================== */
function drawBarChart() {
  const el = document.getElementById('barChart');
  if (!el) return;
  const labels = Object.keys(state.categories);
  const spent = labels.map(l => state.categories[l].amount);
  const limits = labels.map(l => state.categories[l].monthlyLimit || 0);
  if (state.charts.bar) state.charts.bar.destroy();
  state.charts.bar = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'المصروفات', data: spent, backgroundColor: labels.map(l => state.categories[l].color || '#3b82f6'), borderRadius: 8 },
        { label: 'الميزانية', data: limits, backgroundColor: 'rgba(245,158,11,0.6)', borderRadius: 8 }
      ]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}
function drawLineChart() {
  const el = document.getElementById('lineChart');
  if (!el) return;
  const totals = [];
  for (let m = 1; m <= 12; m++) {
    const raw = localStorage.getItem(storageKey(state.year, m));
    if (raw) {
      try { const p = JSON.parse(raw); totals.push(Object.values(p.categories || {}).reduce((s,c) => s + (c.amount || 0), 0)); }
      catch { totals.push(0); }
    } else totals.push(0);
  }
  if (state.charts.line) state.charts.line.destroy();
  state.charts.line = new Chart(el.getContext('2d'), {
    type: 'line',
    data: {
      labels: ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'],
      datasets: [{
        label: `دورات ${state.year}`,
        data: totals,
        borderColor: '#22c55e',
        backgroundColor: 'rgba(34,197,94,0.15)',
        tension: 0.35, fill: true, pointRadius: 4
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}
function drawPieChart() {
  const el = document.getElementById('pieChart');
  if (!el) return;
  const labels = Object.keys(state.categories);
  const data = labels.map(l => state.categories[l].amount);
  const colors = labels.map(l => state.categories[l].color || '#3b82f6');
  if (state.charts.pie) state.charts.pie.destroy();
  state.charts.pie = new Chart(el.getContext('2d'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } } }
  });
}
function compareYears() {
  const y1 = document.getElementById('compareYear1').value;
  const y2 = document.getElementById('compareYear2').value;
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const get = (y) => months.map(m => {
    const raw = localStorage.getItem(storageKey(y, m));
    if (!raw) return 0;
    try { const p = JSON.parse(raw); return Object.values(p.categories || {}).reduce((s,c) => s + (c.amount || 0), 0); }
    catch { return 0; }
  });
  const el = document.getElementById('compareChart');
  if (state.charts.compare) state.charts.compare.destroy();
  state.charts.compare = new Chart(el.getContext('2d'), {
    type: 'bar',
    data: {
      labels: months.map(m => `دورة ${m}`),
      datasets: [
        { label: `سنة ${y1}`, data: get(y1), backgroundColor: '#3b82f6', borderRadius: 6 },
        { label: `سنة ${y2}`, data: get(y2), backgroundColor: '#22c55e', borderRadius: 6 }
      ]
    },
    options: { responsive: true }
  });
}

/* ==================== RENDER ALL ==================== */
function renderAll() {
  renderCategories();
  renderExpenses();
  renderRecurring();
  renderGoals();
  renderIncomeSources();
  updateSelects();
  analyze();
}
function updateSelects() {
  const opts = Object.keys(state.categories).map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
  const sel = document.getElementById('expenseCategorySelect');
  const cur = sel.value;
  sel.innerHTML = opts;
  if (cur && state.categories[cur]) sel.value = cur;
  const rec = document.getElementById('recurringCategory');
  const curR = rec.value;
  rec.innerHTML = opts;
  if (curR && state.categories[curR]) rec.value = curR;
  const fc = document.getElementById('filterCategory');
  const curF = fc.value;
  fc.innerHTML = `<option value="">كل الفئات</option>` + opts;
  if (curF && state.categories[curF]) fc.value = curF;
}

/* ==================== EXPORT / IMPORT ==================== */
function exportExcel() {
  const rows = Object.entries(state.categories).map(([cat, d]) => ({
    'الفئة': cat, 'المصروف': d.amount, 'الميزانية': d.monthlyLimit,
    'الحد اليومي': d.dailyLimit, 'الحد الأسبوعي': d.weeklyLimit
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'الفئات');
  const exp = state.expenses.map(e => ({ 'التاريخ': e.date, 'الفئة': e.category, 'المبلغ': e.amount, 'ملاحظة': e.note || '' }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(exp), 'المصروفات');
  XLSX.writeFile(wb, `budget_cycle_${state.year}_${state.month}.xlsx`);
  toast('تم التصدير', 'success');
}
function exportCSV() {
  const rows = [['الفئة','المبلغ','التاريخ','ملاحظة']];
  state.expenses.forEach(e => rows.push([e.category, e.amount, e.date, e.note || '']));
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a'); a.href = url; a.download = `expenses_${state.year}_${state.month}.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('تم التصدير', 'success');
}
function exportPDF() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const range = getCycleRange(state.year, state.month);
  doc.setFontSize(16);
  doc.text(`Smart Budget - Cycle ${state.year}/${state.month}`, 10, 15);
  doc.setFontSize(10);
  doc.text(`Period: ${range.startISO} to ${range.endISO}`, 10, 22);
  doc.setFontSize(11);
  const inc = calcTotalIncome(), exp = calcTotalExpenses();
  doc.text(`Income: ${inc.toFixed(2)}`, 10, 32);
  doc.text(`Expenses: ${exp.toFixed(2)}`, 10, 40);
  doc.text(`Balance: ${(inc - exp).toFixed(2)}`, 10, 48);
  if (doc.autoTable) {
    doc.autoTable({
      startY: 58,
      head: [['Category', 'Spent', 'Budget']],
      body: Object.entries(state.categories).map(([c, d]) => [c, d.amount.toFixed(2), (d.monthlyLimit||0).toFixed(2)])
    });
  }
  doc.save(`budget_cycle_${state.year}_${state.month}.pdf`);
  toast('تم التصدير', 'success');
}
function exportJSON() {
  const all = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k.startsWith(STORAGE_PREFIX)) all[k] = JSON.parse(localStorage.getItem(k));
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = 'budget_backup.json'; a.click();
  URL.revokeObjectURL(url);
  toast('تم إنشاء النسخة الاحتياطية', 'success');
}
function importJSON(e) {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    try {
      const d = JSON.parse(ev.target.result);
      let n = 0;
      for (const [k, v] of Object.entries(d)) {
        if (k.startsWith(STORAGE_PREFIX)) { localStorage.setItem(k, JSON.stringify(v)); n++; }
      }
      toast(`تم استيراد ${n} دورة`, 'success');
      loadCurrentMonth(); renderAll();
    } catch { toast('ملف غير صالح', 'error'); }
  };
  r.readAsText(f);
  e.target.value = '';
}
function migrateFromOldVersion() {
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(OLD_PREFIX)) keys.push(k);
  }
  if (!keys.length) return toast('لا توجد بيانات قديمة', 'warning');
  let n = 0;
  for (const ok of keys) {
    try {
      const od = JSON.parse(localStorage.getItem(ok));
      const [, y, m] = ok.split('_');
      const nk = `${STORAGE_PREFIX}${y}_${m}`;
      const cats = {};
      for (const [name, c] of Object.entries(od.categories || {})) {
        cats[name] = { amount: c.amount || 0, monthlyLimit: 0, dailyLimit: c.limit || 0, weeklyLimit: c.weeklyLimit || 0, color: '#3b82f6' };
      }
      const exp = [];
      let nid = 1;
      for (const [cat, arr] of Object.entries(od.dailyExpenses || {})) {
        if (Array.isArray(arr)) arr.forEach(x => exp.push({ id: nid++, category: cat, date: x.date, amount: x.amount, note: '' }));
      }
      localStorage.setItem(nk, JSON.stringify({
        version: APP_VERSION, income: od.income || 0, incomeSources: [],
        categories: cats, expenses: exp, recurring: [], goals: [], nextId: nid
      }));
      n++;
    } catch (e) { console.error(e); }
  }
  if (n) { toast(`تم ترحيل ${n} دورة`, 'success'); loadCurrentMonth(); renderAll(); }
}

/* ==================== COPY MONTH ==================== */
function copyMonthData() {
  const fy = document.getElementById('copyFromYear').value;
  const fm = document.getElementById('copyFromMonth').value;
  const ty = document.getElementById('copyToYear').value;
  const tm = document.getElementById('copyToMonth').value;
  const src = localStorage.getItem(storageKey(fy, fm));
  if (!src) return toast('لا توجد بيانات في الدورة المصدر', 'error');
  showModal(`
    <button class="modal-close">&times;</button>
    <h3>نسخ ${fy}/${fm} → ${ty}/${tm}</h3>
    <p class="muted">اختر نوع النسخ:</p>
    <div style="display:flex;flex-direction:column;gap:.5rem;">
      <button id="cFull">📋 نسخ كامل (مع المصروفات)</button>
      <button id="cStruct" class="ghost">🏗️ هيكل فقط (بدون مصروفات)</button>
      <button id="cCancel" class="ghost">إلغاء</button>
    </div>
  `, (r) => {
    r.querySelector('#cCancel').addEventListener('click', closeModal);
    r.querySelector('#cFull').addEventListener('click', () => {
      localStorage.setItem(storageKey(ty, tm), src);
      closeModal(); toast('تم النسخ الكامل', 'success');
      if (+ty === state.year && +tm === state.month) { loadCurrentMonth(); renderAll(); }
    });
    r.querySelector('#cStruct').addEventListener('click', () => {
      try {
        const p = JSON.parse(src);
        p.expenses = []; p.nextId = 1;
        for (const c in p.categories) p.categories[c].amount = 0;
        p.recurring = (p.recurring || []).map(x => ({ ...x, lastApplied: null }));
        localStorage.setItem(storageKey(ty, tm), JSON.stringify(p));
        closeModal(); toast('تم نسخ الهيكل', 'success');
        if (+ty === state.year && +tm === state.month) { loadCurrentMonth(); renderAll(); }
      } catch { toast('خطأ', 'error'); }
    });
  });
}

/* ==================== SETTINGS ==================== */
function loadSettings() {
  const s = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  document.getElementById('settingsCurrency').value = s.currency || 'ر.س';
  document.getElementById('settingsDarkMode').checked = !!s.darkMode;
  document.getElementById('settingsAutoBackup').checked = !!s.autoBackup;
  document.getElementById('settingsPayday').value = s.payday || 1;
  document.getElementById('settingsNotify').checked = !!s.notify;
  document.getElementById('settingsAutoAddIncome').checked = !!s.autoAddIncome;
  state.payday = s.payday || 1;
  state.notify = !!s.notify;
  state.autoAddIncome = !!s.autoAddIncome;
  if (s.darkMode) document.body.classList.add('dark');
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = s.currency || 'ر.س');
}
function saveSettings() {
  const payday = Math.min(Math.max(parseInt(document.getElementById('settingsPayday').value) || 1, 1), 28);
  const s = {
    currency: document.getElementById('settingsCurrency').value || 'ر.س',
    darkMode: document.getElementById('settingsDarkMode').checked,
    autoBackup: document.getElementById('settingsAutoBackup').checked,
    payday: payday,
    notify: document.getElementById('settingsNotify').checked,
    autoAddIncome: document.getElementById('settingsAutoAddIncome').checked
  };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  document.body.classList.toggle('dark', s.darkMode);
  document.querySelectorAll('.currency-symbol').forEach(el => el.textContent = s.currency);
  state.payday = payday;
  state.notify = s.notify;
  state.autoAddIncome = s.autoAddIncome;
}

/* ==================== SELECTORS INIT ==================== */
function initSelectors() {
  const now = new Date();
  const curY = now.getFullYear();

  const years = Array.from({ length: 11 }, (_, i) => curY - 5 + i);
  ['yearSelect','compareYear1','compareYear2','copyFromYear','copyToYear'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = years.map(y =>
      `<option value="${y}" ${y === curY ? 'selected' : ''}>سنة ${y}</option>`).join('');
  });

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  ['monthSelect','copyFromMonth','copyToMonth'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = months.map(m => `<option value="${m}">دورة ${m}</option>`).join('');
  });

  const cycle = getCurrentCycle();
  state.year = cycle.year;
  state.month = cycle.month;
  document.getElementById('yearSelect').value = cycle.year;
  document.getElementById('monthSelect').value = cycle.month;
}

/* ==================== EVENTS ==================== */
function bindEvents() {
  // Sidebar
  document.getElementById('hamburger').addEventListener('click', toggleSidebar);
  document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
  document.getElementById('overlay').addEventListener('click', closeSidebar);
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => navigateTo(item.dataset.page));
  });

  // Year/Month
  document.getElementById('yearSelect').addEventListener('change', e => {
    state.year = +e.target.value; loadCurrentMonth(); renderAll();
  });
  document.getElementById('monthSelect').addEventListener('change', e => {
    state.month = +e.target.value; loadCurrentMonth(); renderAll();
  });

  // Income
  document.getElementById('income').addEventListener('input', debounce(() => { saveMonth(); analyze(); }, 400));
  document.getElementById('addIncomeSourceBtn').addEventListener('click', () => {
    const n = document.getElementById('newIncomeSourceName').value.trim();
    const a = parseFloat(document.getElementById('newIncomeSourceAmount').value);
    if (!n || !a) return toast('أكمل الحقول', 'error');
    state.incomeSources.push({ id: uid(), name: n, amount: a });
    document.getElementById('newIncomeSourceName').value = '';
    document.getElementById('newIncomeSourceAmount').value = '';
    saveMonth(); renderAll(); toast('تم الإضافة', 'success');
  });

  // Categories
  document.getElementById('addCategoryBtn').addEventListener('click', () => {
    const name = document.getElementById('newCategoryName').value.trim();
    if (!name) return toast('أدخل اسم الفئة', 'error');
    if (state.categories[name]) return toast('الفئة موجودة', 'error');
    state.categories[name] = {
      amount: 0,
      monthlyLimit: parseFloat(document.getElementById('newCategoryMonthly').value) || 0,
      dailyLimit: parseFloat(document.getElementById('newCategoryDaily').value) || 0,
      weeklyLimit: parseFloat(document.getElementById('newCategoryWeekly').value) || 0,
      color: document.getElementById('newCategoryColor').value || '#3b82f6'
    };
    ['newCategoryName','newCategoryMonthly','newCategoryDaily','newCategoryWeekly'].forEach(id => document.getElementById(id).value = '');
    saveMonth(); renderAll(); toast('تم الإضافة', 'success');
  });

  // Expenses
  document.getElementById('addExpenseBtn').addEventListener('click', () => {
    const cat = document.getElementById('expenseCategorySelect').value;
    const date = document.getElementById('expenseDate').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const note = document.getElementById('expenseNote').value.trim();
    if (!cat) return toast('اختر فئة', 'error');
    if (!date) return toast('أدخل التاريخ', 'error');
    if (!amount || amount <= 0) return toast('مبلغ غير صحيح', 'error');
    state.expenses.push({ id: uid(), category: cat, date, amount, note });
    state.categories[cat].amount += amount;
    document.getElementById('expenseAmount').value = '';
    document.getElementById('expenseNote').value = '';
    saveMonth(); renderAll(); toast('تم الإضافة', 'success');
  });

  // Recurring
  document.getElementById('addRecurringBtn').addEventListener('click', () => {
    const cat = document.getElementById('recurringCategory').value;
    const amount = parseFloat(document.getElementById('recurringAmount').value);
    const day = parseInt(document.getElementById('recurringDay').value);
    const note = document.getElementById('recurringNote').value.trim();
    if (!cat || !amount || !day || day < 1 || day > 28) return toast('تحقق من الحقول (يوم 1-28)', 'error');
    state.recurring.push({ id: uid(), category: cat, amount, day, note, lastApplied: null });
    ['recurringAmount','recurringDay','recurringNote'].forEach(id => document.getElementById(id).value = '');
    saveMonth(); renderAll(); toast('تم الإضافة', 'success');
  });

  // Goals
  document.getElementById('addGoalBtn').addEventListener('click', () => {
    const n = document.getElementById('newGoalName').value.trim();
    const t = parseFloat(document.getElementById('newGoalTarget').value);
    const d = document.getElementById('newGoalDeadline').value;
    if (!n || !t) return toast('أكمل الحقول', 'error');
    state.goals.push({ id: uid(), name: n, target: t, saved: 0, deadline: d });
    ['newGoalName','newGoalTarget','newGoalDeadline'].forEach(id => document.getElementById(id).value = '');
    saveMonth(); renderAll(); toast('تم الإضافة', 'success');
  });

  // Filters
  document.getElementById('searchExpenses').addEventListener('input', debounce(e => {
    state.filters.search = e.target.value; renderExpenses();
  }, 200));
  document.getElementById('filterCategory').addEventListener('change', e => {
    state.filters.category = e.target.value; renderExpenses();
  });
  document.getElementById('filterFrom').addEventListener('change', e => {
    state.filters.from = e.target.value; renderExpenses();
  });
  document.getElementById('filterTo').addEventListener('change', e => {
    state.filters.to = e.target.value; renderExpenses();
  });
  document.getElementById('clearFiltersBtn').addEventListener('click', () => {
    state.filters = { search: '', category: '', from: '', to: '' };
    ['searchExpenses','filterCategory','filterFrom','filterTo'].forEach(id => document.getElementById(id).value = '');
    renderExpenses();
  });

  // Toolbar
  document.getElementById('exportExcelBtn').addEventListener('click', exportExcel);
  document.getElementById('exportCSVBtn').addEventListener('click', exportCSV);
  document.getElementById('exportPDFBtn').addEventListener('click', exportPDF);
  document.getElementById('exportJSONBtn').addEventListener('click', exportJSON);
  document.getElementById('importJSONBtn').addEventListener('click', () => document.getElementById('importJSONInput').click());
  document.getElementById('importJSONInput').addEventListener('change', importJSON);
  document.getElementById('migrateBtn').addEventListener('click', migrateFromOldVersion);
  document.getElementById('compareYearsBtn').addEventListener('click', compareYears);
  document.getElementById('copyMonthBtn').addEventListener('click', copyMonthData);

  // Settings
  document.getElementById('saveSettingsBtn').addEventListener('click', () => {
    const wasNotify = state.notify;
    saveSettings();

    if (state.notify && !wasNotify) {
      requestNotificationPermission();
    }

    const c = getCurrentCycle();
    state.year = c.year; state.month = c.month;
    document.getElementById('yearSelect').value = c.year;
    document.getElementById('monthSelect').value = c.month;
    loadCurrentMonth();
    renderAll();
    toast('تم الحفظ. تم تحديث دورة الراتب', 'success');
  });
  document.getElementById('darkModeToggle').addEventListener('click', () => {
    document.body.classList.toggle('dark');
    document.getElementById('settingsDarkMode').checked = document.body.classList.contains('dark');
    saveSettings();
  });
}

/* ==================== SHORTCUTS ==================== */
function bindShortcuts() {
  document.addEventListener('keydown', e => {
    if (e.target.matches('input, select, textarea')) return;
    if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openExpenseModal(); }
    if (e.ctrlKey && e.key === 'k') {
      e.preventDefault();
      navigateTo('expenses');
      setTimeout(() => document.getElementById('searchExpenses').focus(), 100);
    }
    if (e.key === 'Escape') { closeModal(); closeSidebar(); }
  });
}

/* ==================== INIT ==================== */
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initSelectors();
  bindEvents();
  bindShortcuts();
  loadCurrentMonth();
  document.getElementById('expenseDate').value = todayISO();
  renderAll();
  setTimeout(() => toast('مرحباً بك في الميزانية الذكية PRO', 'info', 2500), 400);
});
