// 退休金固收：离线时不在后台执行；启动/回到前台后按原定日期补记，每月最多一笔。

function fixedIncomeMonthKey(date = new Date()) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function fixedIncomeShiftMonth(month, offset) {
  const [year, number] = String(month || "").split("-").map(Number);
  const date = new Date(year, number - 1 + offset, 1);
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

function fixedIncomeDueDate(month, day) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(month))) return "";
  const [year, number] = month.split("-").map(Number);
  const last = new Date(year, number, 0).getDate();
  return month + "-" + String(Math.min(Math.max(1, Number(day) || 1), last)).padStart(2, "0");
}

function renderFixedIncomeSettings() {
  const daySelect = document.getElementById("fixedIncomeDay");
  const accountSelect = document.getElementById("fixedIncomeAccount");
  if (!daySelect || !accountSelect) return;
  const day = daySelect.value || "1";
  daySelect.innerHTML = Array.from({ length: 31 }, (_, index) => `<option value="${index + 1}">每月 ${index + 1} 日</option>`).join("");
  daySelect.value = day;
  const previousAccount = dataState.fixedIncomePlan ? String(dataState.fixedIncomePlan.accountId) : accountSelect.value;
  accountSelect.innerHTML = '<option value="">请选择账户</option>' + dataState.accounts
    .filter(account => !account.fundOnly && account.kind === "资金")
    .map(account => `<option value="${esc(account.id)}">${esc(account.name)}</option>`).join("");
  if ([...accountSelect.options].some(option => option.value === previousAccount)) accountSelect.value = previousAccount;
  const plan = dataState.fixedIncomePlan;
  const amount = document.getElementById("fixedIncomeAmount");
  const start = document.getElementById("fixedIncomeStartMonth");
  const enabled = document.getElementById("fixedIncomeEnabled");
  const stop = document.getElementById("fixedIncomeStopBtn");
  if (plan) {
    if (amount) amount.value = (Number(plan.amountCents) / 100).toFixed(2);
    daySelect.value = String(plan.day);
    accountSelect.value = String(plan.accountId);
    if (start) start.value = plan.startMonth;
    if (enabled) enabled.checked = !!plan.active;
  } else {
    if (amount && !amount.value) amount.value = "";
    if (start && !start.value) start.value = fixedIncomeMonthKey();
    if (enabled) enabled.checked = false;
  }
  if (start) start.min = plan ? plan.startMonth : fixedIncomeMonthKey();
  if (stop) stop.disabled = !plan;
  renderCompactFilterPicker("fixedIncomeDay", "fixedIncomeDayPickerBtn", "fixedIncomeDayPickerMenu", "选择日期");
  if (typeof syncPrivacyInputMasks === "function" && document.body && document.body.classList &&
      typeof document.body.classList.contains === "function" && document.body.classList.contains("privacy-masked")) {
    syncPrivacyInputMasks(true);
  }
}

function fixedIncomeSay(message, warn = false) {
  const box = document.getElementById("fixedIncomeMsg");
  if (!box) return;
  box.textContent = message;
  box.classList.toggle("warn", warn);
}

function nextEligibleMonthAfterPause(plan, today = todayStr()) {
  const currentMonth = today.slice(0, 7);
  return fixedIncomeDueDate(currentMonth, plan.day) <= today ? fixedIncomeShiftMonth(currentMonth, 1) : currentMonth;
}

function processDueFixedIncome() {
  const plan = dataState.fixedIncomePlan;
  if (!plan || !dataState.currentBookId) return 0;
  const today = todayStr();
  const currentMonth = today.slice(0, 7);
  if (!plan.active) {
    const next = nextEligibleMonthAfterPause(plan, today);
    if (plan.nextEligibleMonth !== next) {
      plan.nextEligibleMonth = next;
      try { saveFixedIncomePlan(); } catch (_) { /* keep the current session usable */ }
    }
    return 0;
  }
  const account = dataState.accounts.find(item => String(item.id) === String(plan.accountId) && !item.fundOnly && item.kind === "资金");
  if (!account || !Number.isSafeInteger(Number(plan.amountCents)) || Number(plan.amountCents) <= 0) return 0;
  let month = /^\d{4}-\d{2}$/.test(plan.nextEligibleMonth || "") ? plan.nextEligibleMonth : plan.startMonth;
  const startMonth = /^\d{4}-\d{2}$/.test(plan.startMonth || "") ? plan.startMonth : currentMonth;
  if (month < startMonth) month = startMonth;
  const added = [];
  let guard = 0;
  while (month <= currentMonth && guard++ < 720) {
    const date = fixedIncomeDueDate(month, plan.day);
    if (date > today) break;
    const alreadyRecorded = dataState.records.some(record =>
      String(record.fixedIncomePlanId || "") === String(plan.id) && record.fixedIncomeMonth === month);
    if (!alreadyRecorded) {
      added.push({
        id: nextId(dataState.records.concat(added)), type: "收入",
        amount: Number(plan.amountCents) / 100, amountCents: Number(plan.amountCents),
        category: "退休金收入", note: "退休金固收 · " + month.replace("-", "年") + "月",
        date, account: account.id, toAccount: null, transferMode: null,
        fixedIncomePlanId: plan.id, fixedIncomeMonth: month
      });
    }
    month = fixedIncomeShiftMonth(month, 1);
  }
  const nextMonth = fixedIncomeShiftMonth(currentMonth, 1);
  const newNextEligibleMonth = fixedIncomeDueDate(currentMonth, plan.day) <= today ? nextMonth : (plan.nextEligibleMonth || startMonth);
  if (!added.length && newNextEligibleMonth === plan.nextEligibleMonth) return 0;

  const previousRecords = appStorage.get(recordsKey(dataState.currentBookId));
  const previousPlan = appStorage.get(fixedIncomeKey(dataState.currentBookId));
  const previousState = dataState.records;
  dataState.records = normalizeRecords(previousState.concat(added));
  plan.nextEligibleMonth = newNextEligibleMonth;
  try {
    save();
    saveFixedIncomePlan();
  } catch (error) {
    dataState.records = previousState;
    try {
      if (previousRecords === null) appStorage.remove(recordsKey(dataState.currentBookId));
      else appStorage.set(recordsKey(dataState.currentBookId), previousRecords);
      if (previousPlan === null) appStorage.remove(fixedIncomeKey(dataState.currentBookId));
      else appStorage.set(fixedIncomeKey(dataState.currentBookId), previousPlan);
    } catch (_) { /* best-effort rollback */ }
    fixedIncomeSay("自动补记保存失败，原账目未主动覆盖；请检查手机存储空间。", true);
    return 0;
  }
  if (added.length && typeof markLocalChangePending === "function" && typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange()) {
    markLocalChangePending("fixed_income_catch_up");
  }
  if (added.length) {
    fillCategoryFilter();
    render();
    fixedIncomeSay("已补记 " + added.length + " 笔退休金收入，日期按每月设定日记录。");
  }
  return added.length;
}

async function saveFixedIncomeSettings(event) {
  event.preventDefault();
  const amountCents = toCents(document.getElementById("fixedIncomeAmount").value);
  const accountId = document.getElementById("fixedIncomeAccount").value;
  const day = Number(document.getElementById("fixedIncomeDay").value);
  const startMonth = document.getElementById("fixedIncomeStartMonth").value;
  const active = document.getElementById("fixedIncomeEnabled").checked;
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || !day || !/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) ||
      !dataState.accounts.some(account => String(account.id) === String(accountId) && account.kind === "资金" && !account.fundOnly)) {
    fixedIncomeSay("请填写有效金额、到账账户、每月日期和开始月份。", true);
    return;
  }
  const old = dataState.fixedIncomePlan;
  const plan = {
    id: old ? old.id : "社保固收-" + Date.now(),
    amountCents, accountId, day, startMonth,
    nextEligibleMonth: old ? old.nextEligibleMonth : startMonth,
    active
  };
  if (!active) plan.nextEligibleMonth = nextEligibleMonthAfterPause(plan);
  dataState.fixedIncomePlan = plan;
  try {
    saveFixedIncomePlan();
  } catch (error) {
    dataState.fixedIncomePlan = old;
    fixedIncomeSay("保存失败，原设置仍保留。", true);
    return;
  }
  if (typeof markLocalChangePending === "function" && typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange()) {
    markLocalChangePending("fixed_income_settings");
  }
  renderFixedIncomeSettings();
  if (active) processDueFixedIncome();
  fixedIncomeSay(active ? "已保存。到期月份会在应用打开时自动补记，历史记录不会被改写。" : "已暂停退休金固收，历史记录会保留。");
}

function bindFixedIncomeEvents() {
  const form = document.getElementById("fixedIncomeForm");
  const stop = document.getElementById("fixedIncomeStopBtn");
  if (form) form.onsubmit = saveFixedIncomeSettings;
  if (stop) stop.onclick = async () => {
    if (!dataState.fixedIncomePlan || !await appConfirm("清除退休金固收设置吗？已生成的收入流水会保留。")) return;
    const previousPlan = dataState.fixedIncomePlan;
    dataState.fixedIncomePlan = null;
    try {
      saveFixedIncomePlan();
      renderFixedIncomeSettings();
      fixedIncomeSay("设置已清除，历史流水保留。");
    } catch (error) {
      dataState.fixedIncomePlan = previousPlan;
      fixedIncomeSay("清除失败，原设置和历史流水已保留，请重试。", true);
    }
  };
}
