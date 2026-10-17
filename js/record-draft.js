// 仅保留未提交的新记账表单；独立于账目存储和备份，不会自动写成流水。
const RECORD_DRAFT_KEY = "record-form-draft-v1";
const RECORD_DRAFT_FIELDS = [
  "amount", "note", "date", "accountSel", "toAccountSel", "balancePrincipal",
  "balanceAccountName", "transferParty", "depositTarget", "depositLinkSel",
  "depositFinal", "loanParty", "loanLinkSel", "payParty", "payLinkSel",
  "reimbursementParty", "reimbursementLinkSel", "refundLinkSel"
];
let recordDraftRestoring = false;

function clearRecordDraft() {
  try { window.localStorage.removeItem(RECORD_DRAFT_KEY); } catch (_) { /* 存储不可用时保留页面内容 */ }
}

function readRecordDraft() {
  try {
    const draft = JSON.parse(window.localStorage.getItem(RECORD_DRAFT_KEY) || "null");
    if (!draft || draft.version !== 1 || String(draft.bookId) !== String(dataState.currentBookId) ||
        !Number.isFinite(draft.updatedAt) || Date.now() - draft.updatedAt > 7 * 86400000 ||
        !draft.fields || typeof draft.fields !== "object" || Array.isArray(draft.fields)) return null;
    return draft;
  } catch (_) { return null; }
}

function saveRecordDraft() {
  if (recordDraftRestoring || uiState.activeTab !== "record" || uiState.editingRecordId !== null ||
      dataState.currentBookId === null) return;
  const fields = {};
  RECORD_DRAFT_FIELDS.forEach(id => {
    const field = document.getElementById(id);
    if (field) fields[id] = field.type === "checkbox" ? field.checked : field.value;
  });
  const expression = typeof recordKeyboardExpression === "string" && recordKeyboardTargetId === "amount"
    ? recordKeyboardExpression : String(fields.amount || "");
  const meaningful = expression || fields.note || uiState.selectedType !== "支出" ||
    uiState.selectedCategory !== defaultRecordCategory("支出") ||
    String(fields.accountSel || "") !== String(defaultRecordAccountId()) ||
    (fields.date && fields.date !== todayStr());
  if (!meaningful) { clearRecordDraft(); return; }
  const draft = {
    version: 1,
    bookId: dataState.currentBookId,
    updatedAt: Date.now(),
    type: uiState.selectedType,
    category: uiState.selectedCategory,
    depositDir: uiState.selectedDepositDir,
    loanMode: uiState.selectedLoanMode,
    payMode: uiState.selectedPayMode,
    transferMode: uiState.selectedTransferMode,
    expression,
    fields
  };
  try { window.localStorage.setItem(RECORD_DRAFT_KEY, JSON.stringify(draft)); }
  catch (_) { /* 页面本身仍保留正在输入的内容 */ }
}

function restoreRecordDraft(draft) {
  recordDraftRestoring = true;
  try {
    uiState.selectedType = typeof draft.type === "string" ? draft.type : "支出";
    uiState.selectedCategory = typeof draft.category === "string" && allCategories().includes(draft.category)
      ? draft.category : null;
    uiState.selectedDepositDir = draft.depositDir || null;
    uiState.selectedLoanMode = draft.loanMode || null;
    uiState.selectedPayMode = draft.payMode || null;
    uiState.selectedTransferMode = draft.transferMode || null;
    renderTypeChips();
    renderCategoryChips();
    updateFormFields();
    RECORD_DRAFT_FIELDS.forEach(id => {
      const field = document.getElementById(id);
      const value = draft.fields[id];
      if (!field || value === undefined) return;
      if (field.type === "checkbox") field.checked = value === true;
      else field.value = String(value);
    });
    if (typeof setRecordKeyboardExpression === "function") {
      setRecordKeyboardExpression(String(draft.expression || draft.fields.amount || ""));
    }
    if (typeof syncAccountPickerValue === "function") {
      syncAccountPickerValue("accountSel");
      syncAccountPickerValue("toAccountSel");
    }
  } finally {
    recordDraftRestoring = false;
  }
}

function bindRecordDraftEvents() {
  ["input", "change"].forEach(name => {
    document.addEventListener(name, event => {
      if (!event.target || typeof event.target.closest !== "function" ||
          !event.target.closest("#panelRecord, #categoryPickerDialog, #recordKeyboard")) return;
      // 输入与选择已经更新了字段值，立即保存，避免后台暂停或重载丢掉最后一次输入。
      saveRecordDraft();
    });
  });
  document.addEventListener("click", event => {
    if (!event.target || typeof event.target.closest !== "function" ||
        !event.target.closest("#panelRecord, #categoryPickerDialog, #recordKeyboard")) return;
    // 类型等按钮的状态修改完成后再保存；不会把草稿提交成流水。
    window.setTimeout(saveRecordDraft, 0);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveRecordDraft();
  });
  if (typeof window.addEventListener === "function") {
    window.addEventListener("pagehide", saveRecordDraft);
  }
}
