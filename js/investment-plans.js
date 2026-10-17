// 基金台账：专属账户、定投计划、赎回和最终差额结算，仅在本机记账。
// 旧版 investmentPlans 只读保留，不再自动生成流水。

const fundUi = { view: "home", mode: "recurring", selectedId: null, lastRunDate: "" };

// 上交所公布的沪深市场休市安排；未公布年份必须暂停自动记账。
// 2025: https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20241223_10767110.shtml
// 2026: https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml
const FUND_CLOSED_PERIODS = {
  2025: [
    ["2025-01-01", "2025-01-01"], ["2025-01-28", "2025-02-04"],
    ["2025-04-04", "2025-04-06"], ["2025-05-01", "2025-05-05"],
    ["2025-05-31", "2025-06-02"], ["2025-10-01", "2025-10-08"]
  ],
  2026: [
    ["2026-01-01", "2026-01-03"], ["2026-02-15", "2026-02-23"],
    ["2026-04-04", "2026-04-06"], ["2026-05-01", "2026-05-05"],
    ["2026-06-19", "2026-06-21"], ["2026-09-25", "2026-09-27"],
    ["2026-10-01", "2026-10-07"]
  ]
};

function fundLocalMode() {
  return !!dataState.offlineMode || typeof backendApi === "undefined" || !backendApi.baseUrl();
}

function fundDateText(date) {
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");
}

function fundCalendarKnown(dateText) {
  return Object.prototype.hasOwnProperty.call(FUND_CLOSED_PERIODS, Number(String(dateText).slice(0, 4)));
}

function fundTradingDay(dateText) {
  const date = parseLocalDate(dateText);
  if (!date || !fundCalendarKnown(dateText)) return null;
  if (date.getDay() === 0 || date.getDay() === 6) return false;
  return !FUND_CLOSED_PERIODS[date.getFullYear()].some(([start, end]) => dateText >= start && dateText <= end);
}

function fundMonthlyExecutionDate(year, month, monthDay) {
  const last = new Date(year, month, 0).getDate();
  const date = new Date(year, month - 1, Math.min(Number(monthDay) || 1, last));
  for (let index = 0; index < 15; index += 1) {
    const text = fundDateText(date);
    const trading = fundTradingDay(text);
    if (trading === null) return null;
    if (trading) return text;
    date.setDate(date.getDate() + 1);
  }
  return null;
}

function fundMonthlyDays(project) {
  if (Array.isArray(project.monthDays)) return project.monthDays;
  return Number.isInteger(project.monthDay) ? [project.monthDay] : [];
}

function fundScheduleKeysOn(project, dateText) {
  if (!project || project.mode !== "recurring") return [];
  if (dateText < project.startDate || (project.endDate && dateText > project.endDate)) return [];
  const trading = fundTradingDay(dateText);
  if (trading !== true) return [];
  const date = parseLocalDate(dateText);
  if (project.frequency === "daily") return [dateText];
  if (project.frequency === "weekly") return (project.weekdays || []).includes(date.getDay()) ? [dateText] : [];
  if (project.frequency !== "monthly") return [];
  const previousMonth = new Date(date.getFullYear(), date.getMonth() - 1, 1);
  const months = [[date.getFullYear(), date.getMonth() + 1],
    [previousMonth.getFullYear(), previousMonth.getMonth() + 1]];
  const keys = [];
  months.forEach(([year, month]) => fundMonthlyDays(project).forEach(day => {
    if (!Number.isInteger(day) || day < 1 || day > 31) return;
    const target = fundDateText(new Date(year, month - 1, Math.min(day, new Date(year, month, 0).getDate())));
    const firstPlannedDate = project.resumeFromDate && project.resumeFromDate > project.startDate
      ? project.resumeFromDate : project.startDate;
    if (target < firstPlannedDate || fundMonthlyExecutionDate(year, month, day) !== dateText) return;
    // 旧项目按实际执行日去重；新项目按“月份+所选日期”去重，允许同一天顺延两笔。
    keys.push(Array.isArray(project.monthDays) ? `${year}-${String(month).padStart(2, "0")}#${day}` : dateText);
  }));
  return keys;
}

function fundScheduleOccurs(project, dateText) {
  return fundScheduleKeysOn(project, dateText).length > 0;
}

function fundDueOccurrences(project, throughDate = todayStr()) {
  if (!project || project.mode !== "recurring") return [];
  const startText = project.resumeFromDate && project.resumeFromDate > project.startDate ? project.resumeFromDate : project.startDate;
  const start = parseLocalDate(startText);
  const endText = project.endDate && project.endDate < throughDate ? project.endDate : throughDate;
  const end = parseLocalDate(endText);
  if (!start || !end || start > end) return [];
  const processed = new Set(Array.isArray(project.processedDates) ? project.processedDates : []);
  const due = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let scanned = 0; cursor <= end && scanned < 50000; scanned += 1) {
    const dateText = fundDateText(cursor);
    if (!fundCalendarKnown(dateText)) break;
    fundScheduleKeysOn(project, dateText).forEach(key => {
      if (!processed.has(key)) due.push({ date: dateText, key });
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return due;
}

function fundDueDates(project, throughDate = todayStr()) {
  return fundDueOccurrences(project, throughDate).map(item => item.date);
}

function fundNextDate(project, fromDate = todayStr()) {
  if (project.mode !== "recurring" || project.status === "closed" || project.scheduleStatus !== "active") return "";
  const first = [project.startDate, project.resumeFromDate || "", fromDate]
    .reduce((latest, value) => value > latest ? value : latest, "");
  const cursor = parseLocalDate(first);
  if (!cursor) return "";
  for (let index = 0; index < 370; index += 1) {
    const dateText = fundDateText(cursor);
    if (project.endDate && dateText > project.endDate) return "已到结束日期";
    if (!fundCalendarKnown(dateText)) return "待更新休市表";
    if (fundScheduleKeysOn(project, dateText).some(key => !(project.processedDates || []).includes(key))) return dateText;
    cursor.setDate(cursor.getDate() + 1);
  }
  return "待更新休市表";
}

function fundProjectById(id) {
  return (dataState.fundProjects || []).find(project => String(project.id) === String(id));
}

function fundMoney(cents) {
  return "¥" + (Number(cents || 0) / 100).toFixed(2);
}

function fundTotals(project, records = dataState.records) {
  let investedCents = Number(project.originalCostCents || 0);
  let withdrawnCents = 0;
  (records || []).forEach(record => {
    if (String(record.fundProjectId || "") !== String(project.id)) return;
    if (record.fundAction === "contribution") investedCents += toCents(amountOf(record));
    if (record.fundAction === "withdrawal") withdrawnCents += toCents(amountOf(record));
  });
  return { investedCents, withdrawnCents, differenceCents: withdrawnCents - investedCents };
}

function fundProjectRecords(project) {
  return (dataState.records || []).filter(record => String(record.fundProjectId || "") === String(project.id));
}

function deleteFundProject(id) {
  const project = fundProjectById(id);
  if (!project || !fundLocalMode()) return false;
  const account = dataState.accounts.find(item => String(item.id) === String(project.fundAccountId));
  if (!account || !account.fundOnly || String(account.fundProjectId) !== String(project.id)) return false;
  if (dataState.fundProjects.some(item => String(item.id) !== String(project.id) &&
      String(item.fundAccountId) === String(account.id))) return false;
  if (dataState.records.some(record => String(record.fundProjectId || "") !== String(project.id) &&
      (String(record.account) === String(account.id) || String(record.toAccount) === String(account.id)))) return false;
  dataState.records = dataState.records.filter(record => String(record.fundProjectId || "") !== String(project.id));
  dataState.accounts = dataState.accounts.filter(item => String(item.id) !== String(account.id));
  dataState.fundProjects = dataState.fundProjects.filter(item => String(item.id) !== String(project.id));
  fundPersistState(true);
  return true;
}

function fundPersistState(includeAccounts = false) {
  const keys = [recordsKey(dataState.currentBookId), fundProjectsKey(dataState.currentBookId)];
  if (includeAccounts) keys.push(accountsKey(dataState.currentBookId));
  const previous = Object.fromEntries(keys.map(key => [key, appStorage.get(key)]));
  try {
    dataState.records = normalizeRecords(dataState.records);
    const updates = {
      [recordsKey(dataState.currentBookId)]: JSON.stringify(dataState.records),
      [fundProjectsKey(dataState.currentBookId)]: JSON.stringify(dataState.fundProjects || [])
    };
    if (includeAccounts) updates[accountsKey(dataState.currentBookId)] = JSON.stringify(dataState.accounts);
    // 原生端把资金流水与计划状态放在同一个事务，避免只提交一半。
    appStorage.setMany(updates);
  } catch (error) {
    keys.forEach(key => {
      try {
        if (previous[key] === null) appStorage.remove(key);
        else appStorage.set(key, previous[key]);
      } catch (rollbackError) { /* 原生批量提交失败时本来就未写入；仍要恢复内存。 */ }
    });
    load();
    loadFundProjects();
    if (includeAccounts) loadAccounts();
    throw error;
  }
}

// 只有用户保存或撤销指定资金记录时调用，启动读取不会更正历史流水。
function correctFundRecord(projectId, recordId, changes, expectedFingerprint = null) {
  if (!fundLocalMode()) throw new Error("请先切换到本机离线模式。");
  if (String(changes.bookId) !== String(dataState.currentBookId)) throw new Error("账本已切换，请重新打开这笔记录。");
  const currentProject = fundProjectById(projectId);
  const current = dataState.records.find(record => String(record.id) === String(recordId));
  if (!currentProject || !current || String(current.fundProjectId) !== String(projectId) ||
      current.type !== "转账" || !["contribution", "withdrawal"].includes(current.fundAction)) {
    throw new Error("这笔资金记录无法更正，请重新打开基金详情。");
  }
  if (expectedFingerprint !== null && JSON.stringify(current) !== expectedFingerprint) {
    throw new Error("这笔记录已变化，请重新打开后核对。");
  }
  if (dataState.records.filter(record => String(record.id) === String(recordId)).length !== 1 ||
      dataState.fundProjects.filter(project => String(project.id) === String(projectId)).length !== 1) {
    throw new Error("发现重复编号，请先导出备份核对，暂不能安全更正。");
  }
  if (changes.void && currentProject.status === "closed" && current.fundAction === "withdrawal") {
    throw new Error("已结清的到账记录请更正金额，暂不能撤销，以免误撤销全部赎回状态。");
  }
  const fundAccount = dataState.accounts.find(account => String(account.id) === String(currentProject.fundAccountId));
  if (!fundAccount || !fundAccount.fundOnly || (fundAccount.fundProjectId != null &&
      String(fundAccount.fundProjectId) !== String(projectId))) throw new Error("基金专属账户缺失或关联不一致，无法安全更正。");
  const projects = JSON.parse(JSON.stringify(dataState.fundProjects));
  const records = JSON.parse(JSON.stringify(dataState.records));
  const project = projects.find(item => String(item.id) === String(projectId));
  const record = records.find(item => String(item.id) === String(recordId));
  const before = JSON.parse(JSON.stringify(record));
  if (!changes.void) {
    if (!Number.isSafeInteger(changes.amountCents) || changes.amountCents <= 0 || !parseLocalDate(changes.date) ||
        changes.date > todayStr() || (project.status === "closed" && (!project.closedDate || changes.date > project.closedDate)) ||
        !fundOrdinaryAccounts().some(account => String(account.id) === String(changes.accountId))) {
      throw new Error("请填写有效金额、资金账户及日期；已结清基金的日期不能晚于全部赎回日。");
    }
    record.amountCents = changes.amountCents;
    record.amount = changes.amountCents / 100;
    record.date = changes.date;
    record.account = record.fundAction === "contribution" ? changes.accountId : project.fundAccountId;
    record.toAccount = record.fundAction === "contribution" ? project.fundAccountId : changes.accountId;
    record.fundCorrectedAt = new Date().toISOString();
  } else {
    records.splice(records.indexOf(record), 1);
  }
  // 保留原发生项标识；即使改了日期或撤销，也不会当作漏记重新补回。
  const scheduleKey = before.fundScheduleKey || before.fundScheduledDate;
  if (before.fundAction === "contribution" && scheduleKey) {
    project.processedDates = [...new Set([...(project.processedDates || []), scheduleKey])];
  }
  if (changes.pauseSchedule && project.mode === "recurring" && project.status === "open") project.scheduleStatus = "paused";
  const settlements = records.filter(item => String(item.fundProjectId) === String(projectId) && item.fundAction === "settlement");
  if (settlements.length > 1 || (project.status !== "closed" && settlements.length)) {
    throw new Error("发现不一致的结算记录，暂不能自动更正；请先导出备份核对。");
  }
  const settlementBefore = settlements.length ? JSON.parse(JSON.stringify(settlements[0])) : null;
  const totalsAfter = fundTotals(project, records);
  if (![totalsAfter.investedCents, totalsAfter.withdrawnCents, totalsAfter.differenceCents].every(Number.isSafeInteger)) {
    throw new Error("更正后的累计金额超出可精确计算范围，请核对金额。");
  }
  if (project.status === "closed") {
    const difference = totalsAfter.differenceCents;
    if (!parseLocalDate(project.closedDate)) throw new Error("全部赎回日期缺失，无法安全同步结算。");
    if (difference === 0 && settlements.length) records.splice(records.indexOf(settlements[0]), 1);
    else if (difference !== 0) {
      const settlement = settlements[0] || {
        id: nextId(records), type: "基金结算", category: "其他", date: project.closedDate,
        account: project.fundAccountId, note: "基金全部赎回结算：" + project.fundName,
        fundProjectId: String(project.id), fundAction: "settlement"
      };
      Object.assign(settlement, { amountCents: Math.abs(difference), amount: Math.abs(difference) / 100,
        fundResult: difference > 0 ? "income" : "expense" });
      if (!settlements.length) records.push(settlement);
    }
  }
  project.corrections = [...(Array.isArray(project.corrections) ? project.corrections : []), {
    action: changes.void ? "void" : "edit", at: new Date().toISOString(), before,
    after: changes.void ? null : JSON.parse(JSON.stringify(record)), settlementBefore
  }];
  const originalRecords = dataState.records, originalProjects = dataState.fundProjects;
  dataState.records = records;
  dataState.fundProjects = projects;
  try { fundPersistState(); }
  catch (error) {
    // 连读取提交前快照都失败时，也不能把未保存的更正留在页面内存中。
    dataState.records = originalRecords;
    dataState.fundProjects = originalProjects;
    throw error;
  }
  return true;
}

function makeFundTransfer(project, dateText, amountCents, action, sourceId, targetId, scheduled = false, scheduleKey = dateText) {
  if (scheduled && dataState.records.some(record =>
    String(record.fundProjectId || "") === String(project.id) &&
    record.fundAction === "contribution" && (record.fundScheduleKey || record.fundScheduledDate) === scheduleKey
  )) return false;
  dataState.records.push({
    id: nextId(dataState.records), type: "转账", amount: amountCents / 100, amountCents,
    category: "其他", date: dateText, account: sourceId, toAccount: targetId,
    transferMode: "账户间转账", note: action === "contribution"
      ? (project.mode === "recurring" ? "基金定投：" : scheduled ? "基金投资：" : "基金追加投资：") + project.fundName
      : "基金赎回：" + project.fundName,
    fundProjectId: String(project.id), fundMode: project.mode, fundAction: action,
    fundManual: !scheduled && project.mode === "one-time",
    fundScheduledDate: scheduled ? dateText : null,
    fundScheduleKey: scheduled ? scheduleKey : null
  });
  return true;
}

function makeFundSettlement(project, dateText, differenceCents) {
  if (differenceCents === 0) return false;
  dataState.records.push({
    id: nextId(dataState.records), type: "基金结算",
    amount: Math.abs(differenceCents) / 100, amountCents: Math.abs(differenceCents),
    category: "其他", date: dateText, account: project.fundAccountId,
    note: "基金全部赎回结算：" + project.fundName,
    fundProjectId: String(project.id), fundAction: "settlement",
    fundResult: differenceCents > 0 ? "income" : "expense"
  });
  return true;
}

function processDueInvestmentPlans(force = false) {
  if (!fundLocalMode() || !(dataState.fundProjects || []).length) return;
  const today = todayStr();
  if (!force && fundUi.lastRunDate === today) return;
  fundUi.lastRunDate = today;
  let recordChanged = false;
  let projectChanged = false;
  dataState.fundProjects.forEach(project => {
    if (project.status !== "open") return;
    const sourceExists = dataState.accounts.some(account =>
      String(account.id) === String(project.sourceAccountId) && account.kind === "资金" && !account.fundOnly);
    const fundAccountExists = dataState.accounts.some(account =>
      String(account.id) === String(project.fundAccountId) && account.fundOnly);
    if (!sourceExists || !fundAccountExists) return;
    project.processedDates = Array.isArray(project.processedDates) ? project.processedDates : [];
    if (project.mode === "one-time") {
      const alreadyInvested = fundProjectRecords(project).some(record =>
        record.fundAction === "contribution" && record.fundScheduledDate);
      if (project.startDate <= today && !alreadyInvested && !project.processedDates.includes(project.startDate)) {
        if (Number(project.amountCents) > 0 && makeFundTransfer(project, project.startDate, project.amountCents, "contribution",
          project.sourceAccountId, project.fundAccountId, true)) recordChanged = true;
        project.processedDates.push(project.startDate);
        projectChanged = true;
      }
      return;
    }
    if (project.scheduleStatus !== "active") return;
    fundDueOccurrences(project, today).forEach(({ date, key }) => {
      if (makeFundTransfer(project, date, project.amountCents, "contribution",
        project.sourceAccountId, project.fundAccountId, true, key)) recordChanged = true;
      project.processedDates.push(key);
      projectChanged = true;
    });
    if (project.endDate && today > project.endDate && fundCalendarKnown(project.endDate)) {
      project.scheduleStatus = "ended";
      projectChanged = true;
    }
  });
  if (recordChanged || projectChanged) {
    try {
      fundPersistState();
      fundUi.storageError = "";
    } catch (error) {
      fundUi.lastRunDate = "";
      fundUi.storageError = "本机存储失败，基金自动记账未完成；请检查剩余空间并重试。";
      renderInvestmentPlans();
      return;
    }
  }
  if (recordChanged || projectChanged) {
    renderInvestmentPlans();
    if (recordChanged && typeof render === "function") render();
  }
}

function fundOrdinaryAccounts() {
  return (dataState.accounts || []).filter(account => account.kind === "资金" && !account.fundOnly);
}

const FUND_PICKER_IDS = ["fundSourceAccount", "fundFrequency", "fundRedeemAccount", "fundAdjustAccount", "fundRecordAccount"];

function closeFundPickers(exceptId = "") {
  FUND_PICKER_IDS.forEach(id => {
    if (id === exceptId) return;
    const menu = document.getElementById(id + "Menu");
    const button = document.getElementById(id + "Btn");
    if (menu) menu.hidden = true;
    if (button) button.setAttribute("aria-expanded", "false");
  });
}

function syncFundPicker(id) {
  const select = document.getElementById(id);
  const menu = document.getElementById(id + "Menu");
  const button = document.getElementById(id + "Btn");
  if (!select || !menu || !button) return;
  const selected = select.options[select.selectedIndex];
  button.textContent = selected?.textContent || "请选择";
  menu.innerHTML = Array.from(select.options).filter(option => option.value).map(option =>
    `<button type="button" data-fund-option="${esc(id)}" data-fund-value="${esc(option.value)}" aria-selected="${option.value === select.value}">${esc(option.textContent)}</button>`
  ).join("");
}

function renderFundAccountOptions() {
  const options = '<option value="">请选择资金账户</option>' + fundOrdinaryAccounts()
    .map(account => `<option value="${esc(account.id)}">${esc(account.name)}</option>`).join("");
  ["fundSourceAccount", "fundRedeemAccount", "fundAdjustAccount", "fundRecordAccount"].forEach(id => {
    const select = document.getElementById(id);
    if (!select) return;
    const previous = select.value;
    select.innerHTML = options;
    if (fundOrdinaryAccounts().some(account => String(account.id) === previous)) select.value = previous;
    syncFundPicker(id);
  });
}

function setFundView(view) {
  closeFundPickers();
  if (view !== "transaction") fundUi.recordEdit = null;
  fundUi.view = view;
  ["fundHome", "fundFormPage", "fundDetailPage", "fundRedeemPage", "fundSettingsPage", "fundAdjustPage", "fundTransactionPage"].forEach((id, index) => {
    const node = document.getElementById(id);
    if (node) node.hidden = ["home", "form", "detail", "redeem", "settings", "adjust", "transaction"][index] !== view;
  });
  if (view === "home") renderInvestmentPlans();
  if (view === "detail") renderFundDetail();
  if (view === "redeem") renderFundRedeem();
  if (view === "settings") renderFundSettings();
  if (view === "adjust") renderFundAdjust();
  const panel = document.getElementById("panelInvestment");
  if (panel) panel.scrollIntoView({ block: "start" });
}

function fundBack() {
  if (fundUi.recordBusy) return;
  if (["redeem", "settings", "adjust", "transaction"].includes(fundUi.view)) setFundView("detail");
  else if (fundUi.view === "form" && fundUi.editId) {
    fundUi.editId = null;
    setFundView("detail");
  }
  else if (fundUi.view !== "home") setFundView("home");
  else switchTab("home", { replaceHistory: true });
}

function openFundCreate(mode) {
  fundUi.editId = null;
  fundUi.mode = mode === "one-time" ? "one-time" : "recurring";
  const form = document.getElementById("fundCreateForm");
  if (form) form.reset();
  document.getElementById("fundFormTitle").textContent = fundUi.mode === "recurring" ? "基金定投" : "基金投资";
  document.getElementById("fundAmountLabel").textContent = fundUi.mode === "recurring" ? "每次定投金额" : "一次性投资金额";
  document.getElementById("fundScheduleFields").hidden = fundUi.mode !== "recurring";
  document.getElementById("fundEndDateField").hidden = fundUi.mode !== "recurring";
  document.getElementById("fundEndHint").hidden = fundUi.mode !== "recurring";
  document.getElementById("fundOriginalCostLabel").textContent = fundUi.mode === "recurring"
    ? "原始总成本（选填）" : "投资总原始成本（选填）";
  document.getElementById("fundEditHint").hidden = true;
  document.getElementById("fundFormSubmit").textContent = "建立基金账户";
  document.getElementById("fundStartDateLabel").textContent = fundUi.mode === "recurring" ? "开始日期" : "日期";
  document.getElementById("fundStartDate").value = todayStr();
  document.getElementById("fundMonthDay").value = "";
  renderFundMonthDays();
  document.getElementById("fundCreateMsg").textContent = "";
  renderFundFrequencyFields();
  renderFundAccountOptions();
  setFundView("form");
}

function openFundEdit() {
  const project = fundProjectById(fundUi.selectedId);
  if (!project || project.status !== "open") return;
  openFundCreate(project.mode);
  fundUi.editId = String(project.id);
  document.getElementById("fundFormTitle").textContent = project.mode === "recurring" ? "更改基金定投" : "更改基金投资";
  document.getElementById("fundFormSubmit").textContent = "保存更改";
  document.getElementById("fundName").value = project.fundName;
  document.getElementById("fundPlatform").value = project.platform;
  document.getElementById("fundAmount").value = (project.amountCents / 100).toFixed(2);
  document.getElementById("fundStartDate").value = project.startDate;
  document.getElementById("fundEndDate").value = project.endDate || "";
  document.getElementById("fundOriginalCost").value = project.originalCostCents
    ? (project.originalCostCents / 100).toFixed(2) : "";
  const source = document.getElementById("fundSourceAccount");
  source.value = String(project.sourceAccountId);
  syncFundPicker("fundSourceAccount");
  const frequency = document.getElementById("fundFrequency");
  frequency.value = project.frequency || "daily";
  renderFundFrequencyFields();
  document.querySelectorAll("#fundWeekdaysField input").forEach(input => {
    input.checked = (project.weekdays || []).includes(Number(input.value));
  });
  document.getElementById("fundMonthDay").value = fundMonthlyDays(project).join(",");
  renderFundMonthDays();
  const hint = document.getElementById("fundEditHint");
  hint.hidden = false;
  hint.textContent = project.mode === "recurring"
    ? "保存后，新定投计划从下一天起按这些设置执行；已经生成的流水保持原金额、账户和日期。修改原始总成本会调整基金账户初始余额及结算成本。"
    : "已生成的一次性投资流水不会改写，也不会因改动日期或金额而重复投入；如果尚未投入，新的日期、金额和账户会用于首次记账。";
}

function openFundDetail(id) {
  if (!fundProjectById(id)) return;
  fundUi.selectedId = String(id);
  setFundView("detail");
}

function renderFundFrequencyFields() {
  const frequency = document.getElementById("fundFrequency")?.value || "daily";
  const week = document.getElementById("fundWeekdaysField");
  const month = document.getElementById("fundMonthDayField");
  if (week) week.hidden = frequency !== "weekly";
  if (month) month.hidden = frequency !== "monthly";
  syncFundPicker("fundFrequency");
}

function selectedFundMonthDays() {
  return document.getElementById("fundMonthDay").value.split(",")
    .map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 31)
    .sort((a, b) => a - b);
}

function renderFundMonthDays() {
  const days = selectedFundMonthDays();
  const button = document.getElementById("fundMonthDayBtn");
  button.textContent = !days.length ? "选择每月日期" :
    days.length <= 3 ? `每月 ${days.join("、")} 日` : `已选 ${days.length} 个日期`;
  button.setAttribute("aria-label", days.length ? `每月 ${days.join("、")} 日` : "选择每月日期");
  document.querySelectorAll("#fundMonthDayMenu [data-fund-day]").forEach(button => {
    button.setAttribute("aria-pressed", String(days.includes(Number(button.dataset.fundDay))));
  });
}

function renderInvestmentPlans() {
  const list = document.getElementById("fundProjectList");
  if (!list) return;
  const projects = [...(dataState.fundProjects || [])].sort((a, b) =>
    String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  document.getElementById("fundEmpty").hidden = projects.length > 0;
  const investedCents = projects.reduce((sum, project) => sum + fundTotals(project).investedCents, 0);
  const withdrawnCents = projects.reduce((sum, project) => sum + fundTotals(project).withdrawnCents, 0);
  document.getElementById("fundSummary").innerHTML =
    `<div><span>累计投入本金</span><strong>${fundMoney(investedCents)}</strong></div><div><span>已取出到账</span><strong>${fundMoney(withdrawnCents)}</strong></div>`;
  list.innerHTML = projects.map(project => {
    const totals = fundTotals(project);
    const type = project.mode === "recurring" ? "基金定投" : "基金投资";
    const status = project.status === "closed" ? "已全部赎回" :
      project.mode === "one-time" && totals.investedCents === 0 ? "待投入" :
      project.scheduleStatus === "paused" ? "已暂停" : project.scheduleStatus === "ended" ? "定投已结束" : "进行中";
    return `<button class="fund-project-card" type="button" data-fund-detail="${esc(project.id)}">
      <span class="fund-project-top"><strong>${esc(project.fundName)}</strong><em>${type}</em></span>
      <span class="fund-project-platform">${esc(project.platform)} · 专属基金账户 · ${status}</span>
      <span class="fund-project-stats"><span>投入本金 <b>${fundMoney(totals.investedCents)}</b></span><span>已取出 <b>${fundMoney(totals.withdrawnCents)}</b></span></span>
      ${project.mode === "one-time" ? `<span class="fund-project-original">投资总原始成本 <strong>${fundMoney(project.originalCostCents)}</strong></span>` : ""}
    </button>`;
  }).join("");
  const legacy = document.getElementById("fundLegacyNotice");
  const oldCount = (dataState.investmentPlans || []).length;
  legacy.hidden = oldCount === 0;
  if (oldCount) legacy.textContent = `旧版定投计划 ${oldCount} 个已停止自动生成；原有流水与账户保留。请在此新建基金账户，旧数据可从备份和流水核对。`;
  const calendar = document.getElementById("fundCalendarNotice");
  const missing = projects.some(project => project.mode === "recurring" && project.status === "open" &&
    project.scheduleStatus === "active" && !fundCalendarKnown(todayStr()));
  calendar.hidden = !missing;
  if (missing) calendar.textContent = "当前年份的休市表尚未公布，定投自动记账已暂停。更新应用内休市表后才会继续，避免节假日记错。";
  if (fundUi.storageError) {
    calendar.hidden = false;
    calendar.textContent = fundUi.storageError;
  }
  if (!fundLocalMode()) {
    calendar.hidden = false;
    calendar.textContent = "基金台账目前仅在本机离线账本中使用。请先切换到离线模式。";
  }
  renderFundAccountOptions();
}

function renderFundDetail() {
  const project = fundProjectById(fundUi.selectedId);
  if (!project) return setFundView("home");
  const totals = fundTotals(project);
  const transactions = fundProjectRecords(project).sort((a, b) =>
    String(b.date || "").localeCompare(String(a.date || "")));
  const status = project.status === "closed" ? "已全部赎回" :
    project.mode === "one-time" && totals.investedCents === 0 ? "待投入" :
    project.scheduleStatus === "paused" ? "已暂停" : project.scheduleStatus === "ended" ? "定投已结束" : "进行中";
  const next = project.mode === "recurring" && project.status === "open" && project.scheduleStatus === "active"
    ? `<p class="fund-detail-meta">下次定投：${esc(fundNextDate(project))}</p>` : "";
  const toggle = project.mode === "recurring" && project.status === "open" && project.scheduleStatus !== "ended"
    ? `<button class="fund-text-button" type="button" data-fund-action="toggle">${project.scheduleStatus === "active" ? "暂停定投" : "继续定投"}</button>` : "";
  const result = project.status === "closed"
    ? `<p class="fund-result ${totals.differenceCents >= 0 ? "gain" : "loss"}">结算${totals.differenceCents >= 0 ? "收入" : "支出"} ${fundMoney(Math.abs(totals.differenceCents))}</p>` : "";
  document.getElementById("fundDetailContent").innerHTML = `
    <div class="fund-detail-hero"><span class="fund-type-label">${project.mode === "recurring" ? "基金定投" : "基金投资"} · ${status}</span>
      <h2>${esc(project.fundName)}</h2><p>${esc(project.platform)} · 专属基金账户</p>
      <p class="fund-detail-meta">投资资金账户：${esc(accountName(project.sourceAccountId))}</p>${next}
    </div>
    <div class="fund-detail-numbers"><div><span>投入本金</span><strong>${fundMoney(totals.investedCents)}</strong></div>
      <div><span>已取出到账</span><strong>${fundMoney(totals.withdrawnCents)}</strong></div></div>
    ${(project.mode === "one-time" || project.originalCostCents > 0)
      ? `<p class="fund-detail-meta">${project.mode === "recurring" ? "原始总成本" : "投资总原始成本"}：<strong>${fundMoney(project.originalCostCents)}</strong>（建账前已投入）</p>` : ""}
    ${result}
    ${project.status === "open" ? `<div class="fund-detail-actions"><button class="btn-primary" type="button" data-fund-action="redeem">赎回</button>${toggle}</div>` : ""}
    ${project.mode === "one-time" && project.status === "open"
      ? `<button class="fund-adjust-entry" type="button" data-fund-action="adjust">＋ 追加投资</button>` : ""}
    <button class="fund-text-button" type="button" data-fund-action="settings">账户设置</button>
    <p class="fund-hint">账户余额是本金流转账面数，不代表基金实时市值。部分赎回暂不计算收益；全部赎回后统一结算。</p>
    <div id="fundDetailMsg" class="form-msg" role="status" aria-live="polite"></div>
    <h3 class="fund-section-title">资金记录</h3>
    <div class="fund-history">${transactions.length ? transactions.map(record => {
      const label = record.fundAction === "contribution" ? "投入" : record.fundAction === "withdrawal" ? "取出" : "最终结算";
      const edit = ["contribution", "withdrawal"].includes(record.fundAction)
        ? `<button class="fund-record-edit" type="button" data-fund-record="${esc(record.id)}" aria-label="更正${esc(record.date)}的${label}记录">更正 <span aria-hidden="true">›</span></button>` : "";
      return `<div><span>${esc(record.date)} · ${label}</span><strong>${fundMoney(toCents(amountOf(record)))}</strong>${edit}</div>`;
    }).join("") : "<p>尚无资金记录</p>"}</div>
    ${Array.isArray(project.corrections) && project.corrections.length ? `<details class="fund-correction-log"><summary>更正记录（${project.corrections.length}）</summary><div class="fund-history">${project.corrections.slice().reverse().map(item => `<div><span>${esc(String(item.at || "").slice(0, 10))} · ${item.action === "void" ? "撤销" : "更正"}${item.before?.fundAction === "withdrawal" ? "取出" : "投入"}<br>原记账日期 ${esc(item.before?.date || "")}</span><strong>${fundMoney(toCents(amountOf(item.before || {})))}${item.after ? " → " + fundMoney(toCents(amountOf(item.after))) : " → 已撤销"}</strong></div>`).join("")}</div></details>` : ""}`;
}

function openFundRecordEditor(recordId) {
  const project = fundProjectById(fundUi.selectedId);
  const record = dataState.records.find(item => String(item.id) === String(recordId) && String(item.fundProjectId) === String(project?.id));
  if (!project || !record || !["contribution", "withdrawal"].includes(record.fundAction)) return;
  setFundView("transaction");
  fundUi.recordEdit = { bookId: dataState.currentBookId, projectId: project.id, recordId: record.id, fingerprint: JSON.stringify(record) };
  document.getElementById("fundRecordForm").reset();
  document.getElementById("fundRecordTitle").textContent = record.fundAction === "contribution" ? "更正投入记录" : "更正取出记录";
  document.getElementById("fundRecordName").textContent = project.fundName + " · " + project.platform;
  document.getElementById("fundRecordAmount").value = (toCents(amountOf(record)) / 100).toFixed(2);
  document.getElementById("fundRecordDate").value = record.date;
  document.getElementById("fundRecordDate").max = project.status === "closed" ? project.closedDate : todayStr();
  document.getElementById("fundRecordAccountLabel").textContent = record.fundAction === "contribution" ? "出账资金账户" : "到账资金账户";
  renderFundAccountOptions();
  document.getElementById("fundRecordAccount").value = String(record.fundAction === "contribution" ? record.account : record.toAccount);
  syncFundPicker("fundRecordAccount");
  document.getElementById("fundRecordPauseField").hidden = project.mode !== "recurring" || project.status !== "open" || project.scheduleStatus !== "active";
  document.getElementById("fundRecordVoidBtn").hidden = project.status === "closed" && record.fundAction === "withdrawal";
  showFundMessage("fundRecordMsg", "");
}

async function handleFundRecordSave(event, voidRecord = false) {
  event?.preventDefault();
  if (fundUi.recordBusy || !fundUi.recordEdit) return;
  const edit = { ...fundUi.recordEdit };
  const changes = { bookId: edit.bookId, void: voidRecord,
    amountCents: toCents(Number(document.getElementById("fundRecordAmount").value)),
    date: document.getElementById("fundRecordDate").value,
    accountId: document.getElementById("fundRecordAccount").value,
    pauseSchedule: document.getElementById("fundRecordPause").checked };
  fundUi.recordBusy = true;
  const buttons = document.querySelectorAll("#fundRecordForm button");
  buttons.forEach(button => { button.disabled = true; });
  try {
    if (voidRecord && !await appConfirm("撤销后会移除这笔资金流水并重算本金、账户余额及最终结算。自动定投的这一笔不会再次补记。后续定投仅在勾选暂停时停止。", { title: "确认撤销这笔记录" })) return;
    correctFundRecord(edit.projectId, edit.recordId, changes, edit.fingerprint);
    render();
    setFundView("detail");
  } catch (error) {
    showFundMessage("fundRecordMsg", "更正未保存：" + (error.message || "本机保存失败，请重试。"), true);
  } finally {
    fundUi.recordBusy = false;
    buttons.forEach(button => { button.disabled = false; });
  }
}

function renderFundSettings() {
  const project = fundProjectById(fundUi.selectedId);
  if (!project) return setFundView("home");
  document.getElementById("fundSettingsName").textContent = project.fundName + " · " + project.platform;
  document.getElementById("fundEditButton").hidden = project.status !== "open";
  document.getElementById("fundSettingsEditIntro").hidden = project.status !== "open";
  document.getElementById("fundDeleteHint").textContent =
    `删除会移除该基金专属账户，以及关联的 ${fundProjectRecords(project).length} 笔投入、赎回和结算流水，` +
    "并重新计算资金账户余额和收支。此操作无法撤销，建议先在设置中导出备份。";
  showFundMessage("fundSettingsMsg", "");
}

function renderFundRedeem() {
  const project = fundProjectById(fundUi.selectedId);
  if (!project || project.status !== "open") return setFundView("home");
  const totals = fundTotals(project);
  document.getElementById("fundRedeemForm").reset();
  document.getElementById("fundRedeemName").textContent =
    project.fundName + " · 已投入 " + fundMoney(totals.investedCents) + " · 已取出 " + fundMoney(totals.withdrawnCents);
  document.getElementById("fundRedeemDate").value = todayStr();
  document.getElementById("fundRedeemMsg").textContent = "";
  renderFundAccountOptions();
  const account = document.getElementById("fundRedeemAccount");
  if (fundOrdinaryAccounts().some(item => String(item.id) === String(project.sourceAccountId))) {
    account.value = String(project.sourceAccountId);
    syncFundPicker("fundRedeemAccount");
  }
}

function renderFundAdjust() {
  const project = fundProjectById(fundUi.selectedId);
  if (!project || project.mode !== "one-time" || project.status !== "open") return setFundView("home");
  const totals = fundTotals(project);
  document.getElementById("fundAdjustForm").reset();
  document.getElementById("fundAdjustName").textContent =
    project.fundName + " · 投入本金 " + fundMoney(totals.investedCents) + " · 已取出 " + fundMoney(totals.withdrawnCents);
  document.getElementById("fundAdjustDate").value = todayStr();
  showFundMessage("fundAdjustMsg", "");
  renderFundAccountOptions();
  const account = document.getElementById("fundAdjustAccount");
  if (fundOrdinaryAccounts().some(item => String(item.id) === String(project.sourceAccountId))) {
    account.value = String(project.sourceAccountId);
    syncFundPicker("fundAdjustAccount");
  }
}

async function handleFundAdjust(event) {
  event.preventDefault();
  if (fundUi.adjustBusy) return;
  fundUi.adjustBusy = true;
  try {
    if (!fundLocalMode()) return showFundMessage("fundAdjustMsg", "请先切换到本机离线模式。", true);
    fundUi.storageError = "";
    processDueInvestmentPlans(true);
    if (fundUi.storageError) return showFundMessage("fundAdjustMsg", fundUi.storageError, true);
    const project = fundProjectById(fundUi.selectedId);
    if (!project || project.mode !== "one-time" || project.status !== "open") {
      return showFundMessage("fundAdjustMsg", "这只基金的状态已变化，请返回详情重新打开。", true);
    }
    const amountText = document.getElementById("fundAdjustAmount").value.trim();
    const amountCents = toCents(amountText);
    const dateText = document.getElementById("fundAdjustDate").value;
    const accountId = document.getElementById("fundAdjustAccount").value;
    const latestDate = fundProjectRecords(project).reduce((latest, record) =>
      record.date > latest ? record.date : latest, "");
    if (!amountText || !Number.isSafeInteger(amountCents) || amountCents <= 0 ||
        !parseLocalDate(dateText) || dateText > todayStr() || dateText < latestDate ||
        !fundOrdinaryAccounts().some(account => String(account.id) === accountId)) {
      return showFundMessage("fundAdjustMsg", "请填写有效金额、资金账户及不早于最近一笔的记账日期。", true);
    }
    makeFundTransfer(project, dateText, amountCents, "contribution",
      accountId, project.fundAccountId);
    try {
      fundPersistState();
    } catch (error) {
      return showFundMessage("fundAdjustMsg", "本机保存失败，这笔调整未记账。", true);
    }
    render();
    setFundView("detail");
  } finally {
    fundUi.adjustBusy = false;
  }
}

function showFundMessage(id, message, error = false) {
  const node = document.getElementById(id);
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", error);
  node.classList.toggle("success", !error && Boolean(message));
}

function saveFundEdits(values) {
  if (!fundLocalMode()) return showFundMessage("fundCreateMsg", "请先切换到本机离线模式。", true);
  let project = fundProjectById(fundUi.editId);
  if (!project || project.status !== "open" || project.mode !== fundUi.mode) {
    return showFundMessage("fundCreateMsg", "这只基金的状态已变化，请返回详情重新打开。", true);
  }
  const fundAccount = dataState.accounts.find(account =>
    String(account.id) === String(project.fundAccountId) && account.fundOnly &&
    String(account.fundProjectId) === String(project.id));
  if (!fundAccount) return showFundMessage("fundCreateMsg", "基金专属账户缺失，无法安全保存。", true);
  if (project.mode === "recurring") {
    // 先结清旧设置截至今天的到期流水，再让新设置从明天起生效。
    processDueInvestmentPlans(true);
    if (fundUi.storageError) return showFundMessage("fundCreateMsg", fundUi.storageError, true);
    project = fundProjectById(fundUi.editId);
  }
  Object.assign(project, values);
  fundAccount.name = values.fundName + " · " + values.platform;
  fundAccount.initialCents = values.originalCostCents;
  fundAccount.initial = values.originalCostCents / 100;
  if (project.mode === "recurring") {
    const tomorrow = parseLocalDate(todayStr());
    tomorrow.setDate(tomorrow.getDate() + 1);
    project.resumeFromDate = fundDateText(tomorrow);
    if (project.endDate && project.endDate < project.resumeFromDate) project.scheduleStatus = "ended";
    else if (project.scheduleStatus === "ended") project.scheduleStatus = "active";
  }
  try {
    fundPersistState(true);
  } catch (error) {
    return showFundMessage("fundCreateMsg", "本机保存失败，基金设置未更改。", true);
  }
  fundUi.lastRunDate = "";
  if (project.mode === "one-time") processDueInvestmentPlans(true);
  renderAccountSelects();
  render();
  fundUi.editId = null;
  openFundDetail(project.id);
}

async function handleFundCreate(event) {
  event.preventDefault();
  if (fundUi.createBusy) return;
  fundUi.createBusy = true;
  try {
  if (!fundLocalMode()) return showFundMessage("fundCreateMsg", "请先切换到本机离线模式。", true);
  const fundName = document.getElementById("fundName").value.trim();
  const platform = document.getElementById("fundPlatform").value.trim();
  const amountCents = toCents(document.getElementById("fundAmount").value);
  const sourceAccountId = document.getElementById("fundSourceAccount").value;
  const originalCostRaw = document.getElementById("fundOriginalCost").value.trim();
  const originalCostCents = originalCostRaw ? toCents(originalCostRaw) : 0;
  const startDate = document.getElementById("fundStartDate").value;
  const endDate = fundUi.mode === "recurring" ? document.getElementById("fundEndDate").value : "";
  const frequency = fundUi.mode === "recurring" ? document.getElementById("fundFrequency").value : null;
  const weekdays = frequency === "weekly" ? Array.from(document.querySelectorAll("#fundWeekdaysField input:checked"))
    .map(input => Number(input.value)).sort() : [];
  const monthDays = frequency === "monthly" ? selectedFundMonthDays() : [];
  const amountIsValid = Number.isSafeInteger(amountCents) &&
    (fundUi.mode === "one-time" ? amountCents >= 0 : amountCents > 0);
  if (!fundName || !platform || !amountIsValid || !startDate ||
      !fundOrdinaryAccounts().some(account => String(account.id) === sourceAccountId)) {
    return showFundMessage("fundCreateMsg", "请填写基金名称、平台、有效金额、日期和投资资金账户。", true);
  }
  if (!Number.isSafeInteger(originalCostCents) || originalCostCents < 0) {
    return showFundMessage("fundCreateMsg", "原始总成本请填写不小于零的金额。", true);
  }
  if (endDate && endDate < startDate) return showFundMessage("fundCreateMsg", "结束日期不能早于开始日期。", true);
  if (frequency === "weekly" && !weekdays.length) return showFundMessage("fundCreateMsg", "请至少选择一个周几。", true);
  if (frequency === "monthly" && !monthDays.length) return showFundMessage("fundCreateMsg", "请至少选择一个每月日期。", true);
  if (fundUi.mode === "recurring" && !fundCalendarKnown(startDate)) {
    return showFundMessage("fundCreateMsg", "开始年份缺少官方休市表，暂不能建立自动定投。", true);
  }
  if (fundUi.editId) {
    return saveFundEdits({ fundName, platform, amountCents, sourceAccountId,
      originalCostCents, frequency, weekdays, monthDays, startDate, endDate });
  }
  const fundAccountId = nextId(dataState.accounts);
  const project = {
    id: nextId(dataState.fundProjects), mode: fundUi.mode, fundName, platform,
    fundAccountId, sourceAccountId, amountCents, frequency, weekdays, monthDays, originalCostCents,
    startDate, endDate, status: "open", scheduleStatus: "active",
    processedDates: [], createdAt: new Date().toISOString()
  };
  if (project.mode === "recurring" && startDate < todayStr()) {
    const dates = fundDueDates(project, todayStr());
    if (dates.length) {
      const accepted = await appConfirm(`开始日期早于今天，会补记 ${dates.length} 笔、共 ${fundMoney(dates.length * amountCents)} 的本地转账。确认建立？`,
        { title: "确认补记基金定投" });
      if (!accepted) return;
    }
  }
  dataState.accounts.push({
    id: fundAccountId, name: fundName + " · " + platform, kind: "资金",
    initial: originalCostCents / 100, initialCents: originalCostCents,
    fundOnly: true, fundProjectId: String(project.id)
  });
  dataState.fundProjects.push(project);
  try {
    fundPersistState(true);
    fundUi.storageError = "";
  } catch (error) {
    return showFundMessage("fundCreateMsg", "本机保存失败，基金账户未建立。", true);
  }
  fundUi.lastRunDate = "";
  processDueInvestmentPlans(true);
  renderAccountSelects();
  render();
  openFundDetail(project.id);
  } finally {
    fundUi.createBusy = false;
  }
}

async function handleFundRedeem(event) {
  event.preventDefault();
  if (!fundLocalMode()) return showFundMessage("fundRedeemMsg", "请先切换到本机离线模式。", true);
  const project = fundProjectById(fundUi.selectedId);
  if (!project || project.status !== "open") return;
  processDueInvestmentPlans(true);
  if (fundUi.storageError) return showFundMessage("fundRedeemMsg", fundUi.storageError, true);
  const totals = fundTotals(project);
  const amountCents = toCents(document.getElementById("fundRedeemAmount").value);
  const amountEntered = document.getElementById("fundRedeemAmount").value.trim() !== "";
  const dateText = document.getElementById("fundRedeemDate").value;
  const targetId = document.getElementById("fundRedeemAccount").value;
  const full = document.querySelector('input[name="fundRedeemKind"]:checked')?.value === "full";
  const priorRecords = fundProjectRecords(project);
  const latestDate = priorRecords.length ? priorRecords.reduce((latest, record) =>
    record.date > latest ? record.date : latest, "") : project.startDate;
  if (totals.investedCents <= 0) return showFundMessage("fundRedeemMsg", "这只基金尚无投入记录。", true);
  if (!amountEntered || !Number.isFinite(amountCents) || amountCents < 0 || (!full && amountCents === 0) ||
      !dateText || dateText > todayStr() || dateText < latestDate ||
      !fundOrdinaryAccounts().some(account => String(account.id) === targetId)) {
    return showFundMessage("fundRedeemMsg", "请填写有效到账金额、资金账户及不早于最近投入的到账日期。", true);
  }
  if (amountCents > 0) makeFundTransfer(project, dateText, amountCents, "withdrawal",
    project.fundAccountId, targetId);
  if (full) {
    const differenceCents = totals.withdrawnCents + amountCents - totals.investedCents;
    makeFundSettlement(project, dateText, differenceCents);
    project.status = "closed";
    project.scheduleStatus = "ended";
    project.closedDate = dateText;
  }
  try {
    fundPersistState();
  } catch (error) {
    return showFundMessage("fundRedeemMsg", "本机保存失败，赎回未记账。", true);
  }
  render();
  setFundView("detail");
}

function bindInvestmentPlanEvents() {
  const panel = document.getElementById("panelInvestment");
  if (!panel) return;
  document.getElementById("fundCreateForm").onsubmit = handleFundCreate;
  document.getElementById("fundRedeemForm").onsubmit = handleFundRedeem;
  document.getElementById("fundAdjustForm").onsubmit = handleFundAdjust;
  document.getElementById("fundRecordForm").onsubmit = handleFundRecordSave;
  document.getElementById("fundRecordVoidBtn").onclick = event => handleFundRecordSave(event, true);
  document.getElementById("fundFrequency").onchange = renderFundFrequencyFields;
  const monthMenu = document.getElementById("fundMonthDayMenu");
  monthMenu.innerHTML = Array.from({ length: 31 }, (_, index) =>
    `<button type="button" data-fund-day="${index + 1}" aria-pressed="false">${index + 1} 日</button>`).join("") +
    '<button type="button" class="fund-day-done" data-fund-day-done>完成</button>';
  panel.addEventListener("click", async event => {
    const open = event.target.closest("[data-fund-open]");
    if (open) return openFundCreate(open.dataset.fundOpen);
    const back = event.target.closest("[data-fund-back]");
    if (back) return fundBack();
    const detail = event.target.closest("[data-fund-detail]");
    if (detail) return openFundDetail(detail.dataset.fundDetail);
    const record = event.target.closest("[data-fund-record]");
    if (record) return openFundRecordEditor(record.dataset.fundRecord);
    const option = event.target.closest("[data-fund-option]");
    if (option) {
      const select = document.getElementById(option.dataset.fundOption);
      if (!select) return;
      select.value = option.dataset.fundValue;
      syncFundPicker(select.id);
      closeFundPickers();
      if (select.id === "fundFrequency") renderFundFrequencyFields();
      return;
    }
    const picker = event.target.closest("[data-fund-picker]");
    if (picker) {
      const id = picker.dataset.fundPicker;
      const menu = document.getElementById(id + "Menu");
      if (!menu) return;
      const opening = menu.hidden;
      closeFundPickers();
      menu.hidden = !opening;
      picker.setAttribute("aria-expanded", String(opening));
      return;
    }
    const day = event.target.closest("[data-fund-day]");
    if (day) {
      const value = Number(day.dataset.fundDay);
      const selected = selectedFundMonthDays();
      const next = selected.includes(value) ? selected.filter(item => item !== value) : [...selected, value];
      document.getElementById("fundMonthDay").value = next.sort((a, b) => a - b).join(",");
      renderFundMonthDays();
      return;
    }
    if (event.target.closest("[data-fund-day-done]")) {
      monthMenu.hidden = true;
      document.getElementById("fundMonthDayBtn").setAttribute("aria-expanded", "false");
      return;
    }
    if (event.target.closest("#fundMonthDayBtn")) {
      monthMenu.hidden = !monthMenu.hidden;
      document.getElementById("fundMonthDayBtn").setAttribute("aria-expanded", String(!monthMenu.hidden));
      return;
    }
    const action = event.target.closest("[data-fund-action]")?.dataset.fundAction;
    if (action === "redeem") return setFundView("redeem");
    if (action === "adjust") return setFundView("adjust");
    if (action === "settings") return setFundView("settings");
    if (action === "edit") return openFundEdit();
    if (action === "delete") {
      if (fundUi.deleteBusy) return;
      const project = fundProjectById(fundUi.selectedId);
      if (!project) return;
      fundUi.deleteBusy = true;
      try {
        const count = fundProjectRecords(project).length;
        const accepted = await appConfirm(
          `确定删除「${project.fundName}」吗？其专属账户和 ${count} 笔关联流水会一并删除，` +
          "资金账户余额与收支会重新计算。无法撤销，建议先导出备份。",
          { title: "确认删除基金账户" });
        if (!accepted) return;
        try {
          if (!deleteFundProject(project.id)) {
            return showFundMessage("fundSettingsMsg", "账户存在其他关联记录或不在本机离线模式，无法安全删除。", true);
          }
        } catch (error) {
          return showFundMessage("fundSettingsMsg", "本机保存失败，基金账户未删除。", true);
        }
        fundUi.selectedId = null;
        fundUi.lastRunDate = "";
        renderAccountSelects();
        render();
        setFundView("home");
      } finally {
        fundUi.deleteBusy = false;
      }
      return;
    }
    if (action === "toggle") {
      const project = fundProjectById(fundUi.selectedId);
      if (!project || project.status !== "open") return;
      project.scheduleStatus = project.scheduleStatus === "active" ? "paused" : "active";
      if (project.scheduleStatus === "active") project.resumeFromDate = todayStr();
      try { fundPersistState(); }
      catch (error) { return showFundMessage("fundDetailMsg", "本机保存失败，定投状态未改变，请重试。", true); }
      fundUi.lastRunDate = "";
      processDueInvestmentPlans(true);
      renderFundDetail();
    }
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".fund-picker-field")) closeFundPickers();
    if (!event.target.closest(".fund-day-field")) {
      monthMenu.hidden = true;
      document.getElementById("fundMonthDayBtn").setAttribute("aria-expanded", "false");
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") processDueInvestmentPlans();
  });
  window.addEventListener("focus", () => processDueInvestmentPlans());
  window.setInterval(() => processDueInvestmentPlans(), 60000);
}
