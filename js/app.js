// 应用启动模块：在页面结构、状态和功能函数准备完成后绑定事件并初始化数据。
// 该文件必须在所有功能模块之后加载。

if (typeof renderUiIcons === "function") renderUiIcons();

// 使用浏览器历史承接 Android 的系统返回/边缘返回；专项页面的系统返回直接回首页。
if (window.history && typeof window.history.replaceState === "function") {
  window.history.replaceState({ tab: "home" }, "", "#home");
  window.addEventListener("popstate", event => {
    if (typeof compactCalendar !== "undefined" && compactCalendar) {
      closeCompactCalendar();
      const activeTab = uiState.activeTab || "home";
      window.history.pushState({ tab: activeTab }, "", `#${activeTab}`);
      return;
    }
    if (typeof categoryItemIconEditState !== "undefined" && categoryItemIconEditState &&
      typeof closeCategoryItemIconEditor === "function") {
      closeCategoryItemIconEditor();
      const activeTab = uiState.activeTab || "home";
      window.history.pushState({ tab: activeTab }, "", `#${activeTab}`);
      return;
    }
    const tab = event.state && event.state.tab ? event.state.tab : "home";
    switchTab(tab, { fromHistory: true });
  });
}

// 原生 Android 返回键会调用这个函数；在专项页面直接回首页，首页才交回系统退出。
window.handleNativeBack = function handleNativeBack() {
  if (typeof compactCalendar !== "undefined" && compactCalendar) {
    closeCompactCalendar();
    return true;
  }
  if (typeof categoryItemIconEditState !== "undefined" && categoryItemIconEditState &&
    typeof closeCategoryItemIconEditor === "function") {
    closeCategoryItemIconEditor();
    return true;
  }
  const categoryDialog = document.getElementById("categoryPickerDialog");
  if (categoryDialog && !categoryDialog.hidden) {
    closeCategoryPicker();
    return true;
  }
  if (uiState.activeTab === "investment" && typeof fundUi !== "undefined" && fundUi.view !== "home") {
    fundBack();
    return true;
  }
  if (uiState.activeTab === "categorySystem") {
    switchTab("record", { replaceHistory: true });
    return true;
  }
  if (uiState.activeTab === "fixedIncome") {
    switchTab("record", { replaceHistory: true });
    return true;
  }
  if (uiState && uiState.activeTab && uiState.activeTab !== "home") {
    switchTab("home", { replaceHistory: true });
    return true;
  }
  return false;
};

async function openRecordPage() {
  // 新建时从干净的“支出”表单开始；编辑记录时保留编辑草稿。
  const draft = uiState.editingRecordId === null && typeof readRecordDraft === "function" ? readRecordDraft() : null;
  const bookId = dataState.currentBookId;
  if (uiState.editingRecordId === null && typeof resetForm === "function") resetForm();
  switchTab("record");
  if (draft) {
    const shouldRestore = await appConfirm("发现上次未保存的记账内容，要恢复吗？");
    // 等待用户选择时可能已经切换账本、页面或进入编辑状态，此时不能写回旧草稿。
    if (uiState.activeTab !== "record" || dataState.currentBookId !== bookId || uiState.editingRecordId !== null) return;
    if (shouldRestore) restoreRecordDraft(draft);
    else clearRecordDraft();
  }
  const amount = document.getElementById("amount");
  if (amount) setTimeout(() => {
    amount.focus({ preventScroll: true });
  }, 0);
}

document.getElementById("saveBtn").onclick = handleSave;
document.getElementById("cancelBtn").onclick = cancelEdit;
document.getElementById("detailToggle").onclick = () => {
  uiState.detailExpanded = !uiState.detailExpanded;
  renderList();
};
if (typeof bindRecordDraftEvents === "function") bindRecordDraftEvents();
document.getElementById("emptyRecordBtn").onclick = openRecordPage;
document.getElementById("filterToggle").onclick = () => {
  uiState.detailFiltersExpanded = !uiState.detailFiltersExpanded;
  renderDetailFilters();
};
document.getElementById("filterAccountPickerBtn").onclick = () => toggleCompactPicker("filterAccountPickerBtn", "filterAccountPickerMenu");
document.getElementById("bookPickerBtn").onclick = () => toggleCompactPicker("bookPickerBtn", "bookPickerMenu");
document.getElementById("fixedIncomeDayPickerBtn").onclick = () => toggleCompactPicker("fixedIncomeDayPickerBtn", "fixedIncomeDayPickerMenu");
document.getElementById("detailPeriodModePickerBtn").onclick = () => toggleCompactPicker("detailPeriodModePickerBtn", "detailPeriodModePickerMenu");
document.getElementById("filterCategoryPickerBtn").onclick = () => toggleCompactPicker("filterCategoryPickerBtn", "filterCategoryPickerMenu");
document.getElementById("reimbursementLinkPickerBtn").onclick = () => toggleCompactPicker("reimbursementLinkPickerBtn", "reimbursementLinkPickerMenu");
document.getElementById("refundLinkPickerBtn").onclick = () => toggleCompactPicker("refundLinkPickerBtn", "refundLinkPickerMenu");
document.getElementById("loanLinkPickerBtn").onclick = () => toggleCompactPicker("loanLinkPickerBtn", "loanLinkPickerMenu");
document.getElementById("payLinkPickerBtn").onclick = () => toggleCompactPicker("payLinkPickerBtn", "payLinkPickerMenu");
document.getElementById("depositLinkPickerBtn").onclick = () => toggleCompactPicker("depositLinkPickerBtn", "depositLinkPickerMenu");
document.getElementById("filterResetBtn").onclick = () => {
  resetFilterState();
  uiState.detailPeriod = "month";
  ["fromDate", "toDate", "filterAccountSel", "filterCategorySel", "searchInput"].forEach(fieldId => {
    const field = document.getElementById(fieldId);
    if (field) field.value = "";
  });
  refreshDetail();
};
document.getElementById("detailPeriodCards").onclick = event => {
  const card = event.target.closest("[data-detail-period]");
  if (!card) return;
  uiState.detailPeriod = card.dataset.detailPeriod;
  filterState.periodMode = "period";
  filterState.fromDate = "";
  filterState.toDate = "";
  filterState.account = "";
  filterState.category = "";
  filterState.searchKey = "";
  uiState.detailExpanded = true;
  switchTab("detail");
};
document.getElementById("homeAllRecordsBtn").onclick = () => openHomeRecords();
document.getElementById("homeRecentList").onclick = event => {
  const add = event.target.closest("[data-home-record]");
  if (add) { openRecordPage(); return; }
  const row = event.target.closest("[data-home-date]");
  if (row) openHomeRecords(row.dataset.homeDate);
};
document.querySelectorAll(".bottom-nav .tab").forEach(b => {
  b.onclick = () => b.dataset.tab === "record" ? openRecordPage() : switchTab(b.dataset.tab);
});
document.querySelectorAll("[data-tab]:not(.tab)").forEach(b => {
  b.onclick = () => b.dataset.tab === "record" ? openRecordPage() : switchTab(b.dataset.tab);
});
document.getElementById("recordBackBtn").onclick = () => switchTab("home", { replaceHistory: true });
document.getElementById("fixedIncomeBackBtn").onclick = () => switchTab("record", { replaceHistory: true });
document.querySelectorAll(".page-back-home").forEach(b => {
  b.onclick = () => switchTab("home", { replaceHistory: true });
});
document.getElementById("categoryPickerCloseBtn").onclick = closeCategoryPicker;
document.getElementById("categoryPickerManageBtn").onclick = () => {
  closeCategoryPicker();
  openCategorySystem();
};
document.getElementById("categoryPickerDialog").onclick = event => {
  if (event.target.id === "categoryPickerDialog") closeCategoryPicker();
};
document.addEventListener("keydown", event => {
  if (event.defaultPrevented) return;
  if (event.key === "Escape") {
    closeCompactPickers();
    if (typeof categoryItemIconEditState !== "undefined" && categoryItemIconEditState &&
      typeof closeCategoryItemIconEditor === "function") {
      event.preventDefault();
      closeCategoryItemIconEditor();
      return;
    }
    const dialog = document.getElementById("categoryPickerDialog");
    if (dialog && !dialog.hidden) {
      event.preventDefault();
      closeCategoryPicker();
    }
  }
});
document.addEventListener("click", event => {
  if (!event.target.closest(".compact-picker")) closeCompactPickers();
});
document.getElementById("date").value = todayStr();
document.getElementById("amount").oninput = updateDepositSettlementHint;
document.getElementById("accountSel").onchange = () => {
  if (uiState.selectedType === "余额" && uiState.balanceTargetAccountId === null) {
    const account = dataState.accounts.find(item => String(item.id) === String(document.getElementById("accountSel").value));
    const principal = document.getElementById("balancePrincipal");
    if (account && principal && principal.value === "") principal.value = initialOf(account).toFixed(2);
  }
  updateFormFields();
};
document.getElementById("toAccountSel").onchange = () => updateFormFields();
document.getElementById("depositLinkSel").onchange = updateDepositSettlementHint;
document.getElementById("fromDate").onchange = () => {
  filterState.periodMode = "range";
  filterState.fromDate = document.getElementById("fromDate").value;
  uiState.detailPeriod = "all";
  refreshDetail();
};
document.getElementById("toDate").onchange = () => {
  filterState.periodMode = "range";
  filterState.toDate = document.getElementById("toDate").value;
  uiState.detailPeriod = "all";
  refreshDetail();
};
document.getElementById("detailPeriodMode").onchange = event => {
  applyDetailPeriodMode(event.target.value);
  const monthField = document.getElementById("detailMonthField");
  const yearField = document.getElementById("detailYearField");
  if (monthField) monthField.hidden = event.target.value !== "month";
  if (yearField) yearField.hidden = event.target.value !== "year";
  refreshDetail();
};
document.getElementById("detailMonthInput").onchange = event => {
  filterState.month = event.target.value;
  applyDetailPeriodMode("month");
  refreshDetail();
};
document.getElementById("detailYearInput").onchange = event => {
  filterState.year = event.target.value;
  applyDetailPeriodMode("year");
  refreshDetail();
};
document.getElementById("filterAccountSel").onchange = () => {
  filterState.account = document.getElementById("filterAccountSel").value;
  refreshDetail();
};
document.getElementById("filterCategorySel").onchange = () => {
  filterState.category = document.getElementById("filterCategorySel").value;
  refreshDetail();
};
document.getElementById("searchInput").oninput = () => {
  filterState.searchKey = document.getElementById("searchInput").value;
  refreshDetail();
};

document.getElementById("accSaveBtn").onclick = handleAccountSave;
document.getElementById("accCancelBtn").onclick = resetAccountForm;
if (typeof bindFixedIncomeEvents === "function") bindFixedIncomeEvents();
if (typeof bindReportPeriodEvents === "function") bindReportPeriodEvents();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && dataState.currentBookId !== null &&
      (typeof deviceAppUnlocked === "undefined" || deviceAppUnlocked)) {
    processDueInvestmentPlans();
    processDueFixedIncome();
  }
});

document.getElementById("bookSel").onchange = () => {
  switchBook(document.getElementById("bookSel").value);
};
document.getElementById("bookManageBtn").onclick = () => switchTab("book");
document.getElementById("bookBackBtn").onclick = () => switchTab("home", { replaceHistory: true });
document.getElementById("bookSaveBtn").onclick = handleBookSave;
document.getElementById("bookCancelBtn").onclick = resetBookForm;
bindBudgetEvents();
document.getElementById("authOpenBtn").onclick = () => openAuthPanel("login");
document.getElementById("syncBtn").onclick = syncBackendData;
document.getElementById("authLogoutBtn").onclick = logoutAuth;
document.getElementById("authCloseBtn").onclick = closeAuthPanel;
document.getElementById("authLoginTab").onclick = () => setAuthMode("login");
document.getElementById("authRegisterTab").onclick = () => setAuthMode("register");
document.getElementById("authPanel").onsubmit = event => {
  event.preventDefault();
  submitAuth();
};
document.getElementById("exportBtn").onclick = exportBackup;
document.getElementById("importBtn").onclick = () => {
  document.getElementById("importFile").click();
};
document.getElementById("importFile").onchange = (e) => {
  const f = e.target.files[0];
  if (f) importBackup(f);
  e.target.value = "";  // 清掉，方便下次再选同一个文件
};
document.getElementById("externalImportBtn").onclick = () => {
  document.getElementById("externalImportFile").click();
};
document.getElementById("externalImportFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (f) await previewExternalImportFile(f);
  e.target.value = "";
};
document.getElementById("externalImportSource").onchange = () => {
  const input = document.getElementById("externalImportBookName");
  if (!externalImportState.fileName) return;
  input.value = externalImportBookName(document.getElementById("externalImportSource").value, externalImportState.fileName);
};
document.getElementById("externalImportConfirmBtn").onclick = commitExternalImport;
document.getElementById("externalImportCancelBtn").onclick = clearExternalImportPreview;
document.getElementById("migrationPreviewBtn").onclick = () => {
  document.getElementById("migrationFile").click();
};
document.getElementById("migrationFile").onchange = async (e) => {
  const f = e.target.files[0];
  await previewMigrationFile(f);
  e.target.value = "";
};
document.getElementById("migrationConfirmBtn").onclick = confirmMigrationImport;
document.getElementById("migrationCancelBtn").onclick = clearMigrationPreview;

function loadLocalLedgerState() {
  loadBooks();
  load();
  loadAccounts();
  loadInvestmentPlans();
  loadFundProjects();
  loadFixedIncomePlan();
  loadBudgetData();
  loadCustomTypes();
  loadCustomCategories();
  loadCustomCategoryIcons();
  loadCategorySystem();
}

function initializeLocalLedger() {
  // 直接打开文件或网络暂时不可用时使用 localStorage 流程。
  loadLocalLedgerState();
  renderBookSelect();
  renderBookList();
  renderTypeChips();
  renderCategoryChips();
  renderAccountSelects();
  fillCategoryFilter();
  processDueInvestmentPlans();
  processDueFixedIncome();
  renderFixedIncomeSettings();
  if (typeof renderDeviceLockSettings === "function") renderDeviceLockSettings();
  updateFormFields();
  render();
}

function startApplicationCore() {
  // HTTP 页面先进入登录入口，不读取或显示浏览器里的本地账本；登录成功后再读取服务端数据。
  bindNetworkStatusEvents();
  bindCompactCalendar();
  bindInvestmentPlanEvents();
  bindCategorySystemEvents();
  if (backendApi.baseUrl()) {
    // 先准备本机快照，网络不可达时可以立即切换到离线模式；认证成功后再用服务端快照替换。
    loadLocalLedgerState();
    renderAuthStatus();
    hydrateAuthSession();
  } else {
    initializeLocalLedger();
    renderAuthStatus();
  }
}

if (typeof initializeDeviceSecurity === "function") initializeDeviceSecurity();
else startApplicationCore();
