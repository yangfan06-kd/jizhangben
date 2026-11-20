/* 基金及退休金的 PWA 提交边界；共享计算函数不等待异步，不提前更新界面。 */
(function () {
  'use strict';
  let requested = false, forced = false, running = null;
  const notice = document.createElement('p');
  notice.id = 'pwaPeriodicNotice'; notice.hidden = true; notice.setAttribute('role', 'alert');
  document.querySelector('.app').prepend(notice);
  const errorText = error => error && /[\u3400-\u9fff]/.test(error.message || '') ? error.message : '保存未完成，原数据和填写内容已保留，请重试。';
  function persistCollected(force = false) {
    const funds = collectDueFundChanges(force);
    const pension = collectDueFixedIncomeChanges();
    if (funds.recordChanged || funds.projectChanged) fundPersistState();
    if (pension.changed) {
      if (pension.recordsChanged) save();
      saveFixedIncomePlan();
    }
    return { funds: funds.recordChanged || funds.projectChanged, pension: pension.added,
      changed: funds.recordChanged || funds.projectChanged || pension.changed };
  }
  function refreshDue(result) {
    if (!result.changed) return;
    fillCategoryFilter(); render();
    if (uiState.activeTab === 'investment' && fundUi.view === 'detail') renderFundDetail();
    if (result.pension) fixedIncomeSay('已按原定日期补记 ' + result.pension + ' 笔退休金收入。');
  }
  function requestDue(force = false) {
    requested = true; forced = forced || force;
    return flushDue();
  }
  function flushDue(allowStartup = false) {
    if (running) return running;
    const state = PwaLedger.status;
    if (!requested || !state.ready || state.busy || state.conflict || (state.initializingCore && !allowStartup) ||
        window.PwaManagement?.busy ||
        window.PwaBackup?.busy ||
        !dataState.currentBookId || (typeof deviceAppUnlocked !== 'undefined' && !deviceAppUnlocked)) return Promise.resolve(0);
    if (!allowStartup && (['record', 'account', 'fixedIncome', 'book', 'budget', 'categorySystem'].includes(uiState.activeTab) ||
        (uiState.activeTab === 'investment' && ['form', 'redeem', 'adjust', 'transaction'].includes(fundUi.view)) ||
        (document.activeElement?.matches('input,textarea,select') &&
          document.activeElement.getClientRects().length > 0))) return Promise.resolve(0);
    const force = forced; requested = false; forced = false;
    running = (async () => {
      try {
        const result = await PwaLedger.commitChange(() => persistCollected(force));
        notice.hidden = true; fundUi.storageError = '';
        refreshDue(result);
        return result.pension;
      } catch (error) {
        fundUi.storageError = '自动补记未完成，原流水、金额及处理日期已保留；请重新打开或稍后重试。';
        notice.textContent = fundUi.storageError + ' ' + errorText(error); notice.hidden = false;
        fixedIncomeSay(fundUi.storageError, true);
        renderInvestmentPlans();
        return 0;
      } finally {
        running = null;
        if (requested) queueMicrotask(() => flushDue());
      }
    })();
    return running;
  }
  async function commit(change) {
    const bookId = dataState.currentBookId;
    return PwaLedger.commitChange(() => {
      if (String(bookId) !== String(dataState.currentBookId)) throw Error('账本已切换，请重新打开此页面。');
      return change();
    });
  }
  function collectFunds() {
    collectDueFundChanges(true);
  }
  async function fundAction(messageId, change, success) {
    try {
      const result = await commit(change);
      fundUi.storageError = '';
      success(result);
      return true;
    } catch (error) { showFundMessage(messageId, errorText(error), true); return false; }
  }
  const selectedProject = () => fundUi.selectedId;
  PwaLedger.setIdleHandler(() => { if (requested) flushDue(); });
  document.addEventListener('focusout', () => setTimeout(() => { if (requested) flushDue(); }, 0));
  window.PwaFunds = Object.freeze({
    requestDue, flushDue, commit,
    create(project) {
      const draft = JSON.parse(JSON.stringify(project));
      return fundAction('fundCreateMsg', () => {
        if (dataState.accounts.some(account => String(account.id) === String(draft.fundAccountId)) ||
            fundProjectById(draft.id)) throw Error('基金编号已变化，请重新打开建立页面。');
        addFundProjectToState(draft); collectFunds(); fundPersistState(true);
        return draft.id;
      }, id => { renderAccountSelects(); render(); openFundDetail(id); });
    },
    edit(values) {
      const id = fundUi.editId, mode = fundUi.mode;
      return fundAction('fundCreateMsg', () => {
        let project = fundProjectById(id);
        if (!project || project.status !== 'open' || project.mode !== mode) throw Error('基金状态已变化，请重新打开详情。');
        if (mode === 'recurring') collectFunds();
        project = fundProjectById(id);
        const account = dataState.accounts.find(item => String(item.id) === String(project.fundAccountId) && item.fundOnly && String(item.fundProjectId) === String(id));
        if (!account) throw Error('基金专属账户缺失，不能保存。');
        applyFundEditValues(project, account, values);
        if (mode === 'one-time') collectFunds();
        fundPersistState(true);
        return id;
      }, savedId => { fundUi.editId = null; renderAccountSelects(); render(); openFundDetail(savedId); });
    },
    adjust() {
      const id = selectedProject();
      const values = { amountText: document.getElementById('fundAdjustAmount').value.trim(),
        amountCents: toCents(document.getElementById('fundAdjustAmount').value),
        dateText: document.getElementById('fundAdjustDate').value, accountId: document.getElementById('fundAdjustAccount').value };
      return fundAction('fundAdjustMsg', () => {
        collectFunds(); applyFundAdjustment(id, values); fundPersistState();
      }, () => { render(); setFundView('detail'); });
    },
    redeem() {
      const id = selectedProject();
      const values = { amountCents: toCents(document.getElementById('fundRedeemAmount').value),
        amountEntered: document.getElementById('fundRedeemAmount').value.trim() !== '',
        dateText: document.getElementById('fundRedeemDate').value, targetId: document.getElementById('fundRedeemAccount').value,
        full: document.querySelector('input[name="fundRedeemKind"]:checked')?.value === 'full' };
      return fundAction('fundRedeemMsg', () => {
        collectFunds(); applyFundRedemption(id, values); fundPersistState();
      }, () => { render(); setFundView('detail'); });
    },
    toggle(id) {
      return fundAction('fundDetailMsg', () => {
        const project = fundProjectById(id);
        if (!project || project.status !== 'open') throw Error('基金状态已变化。');
        project.scheduleStatus = project.scheduleStatus === 'active' ? 'paused' : 'active';
        if (project.scheduleStatus === 'active') project.resumeFromDate = todayStr();
        collectFunds(); fundPersistState();
      }, () => { render(); renderFundDetail(); });
    },
    remove(id) {
      return fundAction('fundSettingsMsg', () => {
        if (!deleteFundProject(id)) throw Error('账户仍有其他关联记录，无法安全删除。');
      }, () => { fundUi.selectedId = null; fundUi.lastRunDate = ''; renderAccountSelects(); render(); setFundView('home'); });
    },
    async savePension(plan) {
      const draft = JSON.parse(JSON.stringify(plan));
      try {
        await commit(() => {
          dataState.fixedIncomePlan = draft; saveFixedIncomePlan();
          if (draft.active) {
            const result = collectDueFixedIncomeChanges();
            if (result.recordsChanged) save();
            if (result.changed) saveFixedIncomePlan();
          }
        });
        renderFixedIncomeSettings(); fillCategoryFilter(); render();
        fixedIncomeSay(draft.active ? '已保存。到期月份会在应用打开时补记，历史记录不会改写。' : '已暂停退休金固收，历史记录保留。');
        return true;
      } catch (error) { fixedIncomeSay(errorText(error), true); return false; }
    },
    async clearPension() {
      try {
        await commit(() => { dataState.fixedIncomePlan = null; saveFixedIncomePlan(); });
        renderFixedIncomeSettings(); fixedIncomeSay('设置已清除，历史流水保留。'); return true;
      } catch (error) { fixedIncomeSay(errorText(error), true); return false; }
    }
  });
})();
