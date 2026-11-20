/* 仅独立 PWA 预览加载。管理数据先原子提交，再清输入、刷新页面。 */
(function () {
  'use strict';
  let active = false, importing = false;
  const errorText = error => error && /[\u3400-\u9fff]/.test(error.message || '')
    ? error.message : '保存失败，原数据和填写内容已保留，请重试。';
  async function run(change, success, failure = text => appNotice(text)) {
    if (active || PwaLedger.status.busy) { failure('正在处理，请稍候'); return false; }
    active = true;
    let committed = false;
    try {
      const result = await PwaLedger.commitChange(change);
      committed = true;
      if (success) success(result);
      return true;
    } catch (error) {
      failure(committed ? '数据已保存，但页面刷新未完成，请重新打开应用；请勿重复提交。' : errorText(error));
      return committed;
    }
    finally {
      active = false;
      setTimeout(() => { if (window.PwaFunds) PwaFunds.flushDue(); }, 0);
    }
  }
  function ensureAccounts() {
    const raw = appStorage.get(accountsKey(dataState.currentBookId));
    if (raw === null) saveAccounts();
    else if (JSON.parse(raw).length === 0) dataState.accounts = [];
  }
  function loadCurrent() {
    load(); loadAccounts(); ensureAccounts(); loadInvestmentPlans(); loadFundProjects();
    loadFixedIncomePlan(); loadBudgetData();
  }
  function refreshCurrent() {
    fundUi.selectedId = null; fundUi.editId = null; fundUi.view = 'home';
    refreshReloadedData();
    if (window.PwaFunds) PwaFunds.requestDue(true);
  }
  function refreshCategories() {
    if (uiState.selectedCategory && !allCategories().includes(uiState.selectedCategory) && uiState.editingRecordId === null) uiState.selectedCategory = null;
    renderCategoryChips(); fillCategoryFilter(); renderBudgetPage(); renderCategorySystem();
  }
  const bookFailure = text => showBookMsg(text, true);
  window.PwaManagement = Object.freeze({
    get busy() { return active || importing; },
    write(updates) {
      return run(() => appStorage.setMany(updates));
    },
    categoryCommit(change) {
      return run(() => { change(); saveCategorySystem(); }, refreshCategories,
        text => { renderCategorySystem(); appNotice(text); });
    },
    categoryIcon(name, iconKey) {
      return run(() => { dataState.customCategoryIcons[name] = iconKey; saveCustomCategoryIcons(); });
    },
    async createCategoryItem(key, name, iconKey, button) {
      if (button) button.disabled = true;
      try {
        return await run(() => {
          const group = categorySystemGroups().find(item => item.key === key);
          if (!group || categorySystemItemNames().includes(name)) throw Error('类别已变化，请重新选择');
          const icon = iconKey || group.icon || 'other';
          if (!categoryIconMarkupByKey(icon)) throw Error('这个图标暂时无法使用，请重新选择');
          group.items.push(name);
          dataState.categorySystem.hidden = dataState.categorySystem.hidden.filter(item => item !== name);
          if (!CATEGORY_GROUPS.some(item => item.items.includes(name)) && !dataState.customCategories.includes(name)) dataState.customCategories.push(name);
          dataState.customCategoryIcons[name] = icon;
          saveCategorySystem(); saveCustomCategories(); saveCustomCategoryIcons();
        }, () => {
          if (!uiState.selectedCategory) uiState.selectedCategory = name;
          refreshCategories();
        });
      } finally { if (button) button.disabled = false; }
    },
    async switchBook(id) {
      const selected = dataState.books.find(book => String(book.id) === String(id));
      if (!selected) return false;
      return run(() => {
        dataState.currentBookId = selected.id;
        appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(selected.id)); loadCurrent();
      }, refreshCurrent, text => { renderBookSelect(); bookFailure(text); appNotice(text); });
    },
    async saveBook({ name, category, editingId, dup }) {
      setBookSaveBusy(true);
      try {
        return await run(() => {
          if (editingId !== null) {
            const book = dataState.books.find(item => String(item.id) === String(editingId));
            if (!book) throw Error('账本已变化，请重新选择');
            Object.assign(book, { name, category });
          } else dataState.books.push({ id: nextId(dataState.books), name, category });
          saveBooks();
        }, () => {
          resetBookForm(); showBookMsg((editingId === null ? '已添加账本' : '已保存修改') + (dup ? '（已有同名账本，请留意区分）' : ''), dup);
          renderBookSelect(); renderBookList(); renderOverview();
        }, bookFailure);
      } finally { setBookSaveBusy(false); }
    },
    async deleteBook(id, fingerprint) {
      setBookDeleteBusy(true);
      try {
        return await run(() => {
          const book = dataState.books.find(item => String(item.id) === String(id));
          if (!book || dataState.books.length <= 1 || JSON.stringify(bookFingerprint(book)) !== JSON.stringify(fingerprint)) throw Error('账本已变化，无法删除');
          dataState.books = dataState.books.filter(item => String(item.id) !== String(id));
          [recordsKey, accountsKey, budgetKey, investmentPlansKey, fundProjectsKey, fixedIncomeKey].forEach(key => appStorage.remove(key(id)));
          saveBooks();
          if (String(dataState.currentBookId) === String(id)) {
            dataState.currentBookId = dataState.books[0].id;
            appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId)); loadCurrent();
            return true;
          }
          return false;
        }, switched => {
          resetBookForm();
          if (switched) refreshCurrent(); else { renderBookSelect(); renderBookList(); render(); }
          showBookMsg('已删除账本');
        }, bookFailure);
      } finally { setBookDeleteBusy(false); }
    },
    budget(action, row) {
      const month = budgetUiState.month, book = dataState.currentBookId;
      const input = document.getElementById('budgetTotalInput');
      const name = row ? row.dataset.budgetCategory : document.getElementById('budgetCategorySelect').value;
      const raw = action === 'total' ? input.value.trim() : action === 'add'
        ? document.getElementById('budgetCategoryInput').value : row?.querySelector('[data-budget-category-input]')?.value;
      const cents = toCents(raw || '0');
      if (action === 'add' && !name) { showBudgetMsg('请先选择一个类别', true); return Promise.resolve(false); }
      if (['total', 'add', 'update'].includes(action) && !(action === 'total' && raw === '') && (!Number.isSafeInteger(cents) || cents <= 0)) {
        showBudgetMsg('请输入大于 0 的预算额度', true); return Promise.resolve(false);
      }
      return run(() => {
        if (String(book) !== String(dataState.currentBookId)) throw Error('账本已切换，请重新打开预算');
        const period = budgetPeriod(month);
        if (action === 'total') period.totalCents = raw === '' ? null : cents;
        else if (action === 'clear') period.totalCents = null;
        else if (action === 'remove') delete period.categories[name];
        else period.categories[name] = cents;
        saveBudgetData();
      }, () => {
        if (action === 'add') { document.getElementById('budgetCategorySelect').value = ''; document.getElementById('budgetCategoryInput').value = ''; }
        renderBudgetPage(); showBudgetMsg(action === 'remove' || action === 'clear' ? '预算已清除' : '预算已保存');
      }, text => showBudgetMsg(text, true));
    },
    addCustom(kind, name) {
      const isType = kind === 'type', side = uiState.customTypeSideDraft, icon = uiState.customCategoryIconDraft || 'other';
      return run(() => {
        if ((isType ? allTypes() : allCategories()).includes(name)) throw Error('这个选项已经存在');
        if (isType) { dataState.customTypes.push({ name, side }); saveCustomTypes(); }
        else {
          dataState.customCategories.push(name); dataState.customCategoryIcons[name] = icon;
          saveCustomCategories(); saveCustomCategoryIcons(); syncCategorySystemWithCustomCategories();
        }
      }, () => {
        if (isType) selectRecordType(name); else uiState.selectedCategory = name;
        document.getElementById(isType ? 'typeCustomBox' : 'categoryCustomBox').innerHTML = '';
        renderTypeChips(); renderCategoryChips(); if (isType) updateFormFields(); else fillCategoryFilter();
      });
    },
    removeCustom(kind, name) {
      const isType = kind === 'type';
      return run(() => {
        if (isType) { dataState.customTypes = dataState.customTypes.filter(item => (typeof item === 'string' ? item : item.name) !== name); saveCustomTypes(); }
        else {
          dataState.customCategories = dataState.customCategories.filter(item => item !== name);
          delete dataState.customCategoryIcons[name];
          dataState.categorySystem.groups.forEach(group => { group.items = group.items.filter(item => item !== name); });
          if (!dataState.categorySystem.hidden.includes(name)) dataState.categorySystem.hidden.push(name);
          saveCategorySystem(); saveCustomCategories(); saveCustomCategoryIcons();
        }
      }, () => {
        if (isType) { if (uiState.selectedType === name) uiState.selectedType = null; delete dataState.backendTypeIds[name]; }
        else {
          if (uiState.selectedCategory === name) uiState.selectedCategory = null;
          if (filterState.category === name) { filterState.category = ''; document.getElementById('filterCategorySel').value = ''; }
          delete dataState.backendCategoryIds[name];
        }
        document.getElementById('typeCustomBox').innerHTML = ''; document.getElementById('categoryCustomBox').innerHTML = '';
        renderTypeChips(); renderCategoryChips(); if (isType) updateFormFields(); else fillCategoryFilter(); refreshDetail();
      });
    },
    async importBackup(file) {
      if (window.PwaBackup) return window.PwaBackup.previewImport(file);
      if (!file || importing || active || PwaLedger.status.busy) return false;
      importing = true;
      let imported;
      try { imported = extractBackupStorage(await readBackupFile(file)); }
      catch (_) { importing = false; showBackupMsg('备份文件无效或无法读取，当前账本未更改，请重新选择。', true); return false; }
      try {
        if (!await appConfirm('导入会替换当前所有账本和账目，确定继续吗？')) return false;
        return await run(() => {
          replaceBackupStorage(imported); loadLocalLedgerState(); ensureAccounts();
          if (uiState.startupNotice) throw Error('备份升级未完成，当前账本未更改');
        }, () => { refreshCurrent(); showBackupMsg('已恢复备份'); }, text => showBackupMsg(text, true));
      } finally { importing = false; }
    },
    restoreBackup(imported, expectedRevision) {
      return run(() => {
        if (PwaLedger.status.revision !== expectedRevision) throw Error('预览后账本已有更改，请重新选择备份核对后再恢复。');
        replaceBackupStorage(imported); loadLocalLedgerState(); ensureAccounts();
        if (uiState.startupNotice) throw Error('备份升级未完成，当前账本未更改');
      }, () => { refreshCurrent(); showBackupMsg('已恢复备份'); }, text => {
        showBackupMsg(text, true); if (window.PwaBackup) PwaBackup.report(text, true);
      });
    },
    importCsv(options) {
      return run(() => {
        const result = applyExternalImportRows(options);
        loadCurrent(); loadCustomCategories(); loadCategorySystem();
        return result;
      }, result => {
        refreshCurrent(); clearExternalImportPreview();
        showBackupMsg('已导入 ' + result.allRecords.length + ' 行，并新建 ' + options.groups.size + ' 个独立账本。');
      }, text => showBackupMsg(text, true));
    }
  });
})();
