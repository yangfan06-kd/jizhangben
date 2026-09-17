// 应用启动模块：在页面结构、状态和功能函数准备完成后绑定事件并初始化数据。
// 该文件必须在所有功能模块之后加载。

document.getElementById("saveBtn").onclick = handleSave;
document.getElementById("cancelBtn").onclick = cancelEdit;
document.getElementById("detailToggle").onclick = () => {
  uiState.detailExpanded = !uiState.detailExpanded;
  renderList();
};
document.querySelectorAll(".tab").forEach(b => {
  b.onclick = () => switchTab(b.dataset.tab);
});
document.getElementById("date").value = todayStr();
document.getElementById("amount").oninput = updateDepositSettlementHint;
document.getElementById("depositLinkSel").onchange = updateDepositSettlementHint;
document.getElementById("fromDate").onchange = () => {
  filterState.fromDate = document.getElementById("fromDate").value;
  refreshDetail();
};
document.getElementById("toDate").onchange = () => {
  filterState.toDate = document.getElementById("toDate").value;
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

document.getElementById("bookSel").onchange = () => {
  switchBook(document.getElementById("bookSel").value);
};
document.getElementById("bookManageBtn").onclick = () => toggleBookPanel(true);
document.getElementById("bookBackBtn").onclick = () => toggleBookPanel(false);
document.getElementById("bookSaveBtn").onclick = handleBookSave;
document.getElementById("bookCancelBtn").onclick = resetBookForm;
document.getElementById("authOpenBtn").onclick = () => openAuthPanel("login");
document.getElementById("authLogoutBtn").onclick = logoutAuth;
document.getElementById("authCloseBtn").onclick = closeAuthPanel;
document.getElementById("authLoginTab").onclick = () => setAuthMode("login");
document.getElementById("authRegisterTab").onclick = () => setAuthMode("register");
document.getElementById("authForm").onsubmit = event => {
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

function initializeLocalLedger() {
  // 直接打开文件时使用原有 localStorage 流程，保留离线兼容能力。
  loadBooks();
  load();
  loadAccounts();
  loadCustomTypes();
  loadCustomCategories();
  renderBookSelect();
  renderBookList();
  renderTypeChips();
  renderCategoryChips();
  renderAccountSelects();
  fillCategoryFilter();
  updateFormFields();
  render();
}

// HTTP 页面先进入登录入口，不读取或显示浏览器里的本地账本；登录成功后再读取服务端数据。
if (backendApi.baseUrl()) {
  renderAuthStatus();
  hydrateAuthSession();
} else {
  initializeLocalLedger();
  renderAuthStatus();
}
