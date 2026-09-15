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

// 先读账本清单，定好当前是哪个账本，再读该账本的数据
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

// 本地页面先立即可用，再后台尝试读取服务端账本和账户。
startBackendReadHydration();
