/* 仅在独立存储接入预览加载；读走已提交快照，写必须进入显式事务。 */
(function () {
  'use strict';
  let database = null, committed = {}, revision = null, pending = null;
  let ready = false, busy = false, conflict = false, corePromise = null, stopped = null;
  let initializingCore = false, idleHandler = null;
  let programUpdating = false;
  const originalStorage = { ...appStorage };
  const app = document.querySelector('.app');
  const navigation = document.querySelector('.bottom-nav');
  const gate = document.createElement('section');
  gate.id = 'pwaStorageGate'; gate.setAttribute('role', 'status');
  const gateText = document.createElement('p'); gate.appendChild(gateText);
  document.body.appendChild(gate);

  function message(error) {
    return error && typeof error.code === 'string' ? error.message : '账本未能保存，原数据和填写内容已保留，请重试。';
  }
  function setBusy(value) {
    busy = value;
    if (app) app.inert = value;
    if (navigation) navigation.inert = value;
    if (value) { gateText.textContent = '正在保存，请稍候…'; gate.hidden = false; }
    else if (stopped) stop(stopped);
    else gate.hidden = true;
  }
  function stop(error) {
    stopped = error;
    ready = false;
    if (app) app.inert = true;
    if (navigation) navigation.inert = true;
    gate.setAttribute('role', 'alert');
    gateText.textContent = error && typeof error.code === 'string' ? error.message : '账本准备失败，已停止写入。请保留网站数据和原备份后重新打开。';
    gate.hidden = false;
  }
  function view() {
    if (!ready) throw Error('账本数据库尚未准备完成');
    const result = { ...committed };
    if (pending) for (const [key, value] of Object.entries(pending)) {
      if (value === null) delete result[key]; else result[key] = value;
    }
    return result;
  }
  function stage(changes) {
    if (!ready || !pending) throw Error('此保存入口尚未接入网页事务，未写入任何账本内容');
    if (Object.keys(changes).some(key => !key.startsWith('jizhangben_'))) throw Error('设备偏好不能混入账本事务');
    Object.assign(pending, changes);
  }
  function validate(entries) {
    for (const [key, raw] of Object.entries(entries)) {
      if (!key.startsWith('jizhangben_') || typeof raw !== 'string') throw Error('账本内容无效');
      const value = JSON.parse(raw);
      if (key === PENDING_SYNC_KEY) {
        if (!value || value.version !== 1 || typeof value.updatedAt !== 'string' || typeof value.reason !== 'string') throw Error('历史同步状态无效');
      } else if (key === LOCAL_SNAPSHOT_OWNER_KEY) {
        if (typeof value !== 'string' && typeof value !== 'number') throw Error('历史所有者标识无效');
      } else if (!validateBackupValue(key, value)) throw Error('账本包含不能识别或损坏的内容');
    }
    return true;
  }
  appStorage.get = function (key) {
    key = String(key);
    if (!key.startsWith('jizhangben_')) return originalStorage.get(key);
    const values = view(); return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
  };
  appStorage.entries = function (prefix = '') {
    return Object.fromEntries(Object.entries(view()).filter(([key]) => key.startsWith(prefix)));
  };
  appStorage.set = (key, value) => stage({ [String(key)]: String(value) });
  appStorage.remove = key => stage({ [String(key)]: null });
  appStorage.setMany = entries => stage(Object.fromEntries(Object.entries(entries).map(([key, value]) => [key, String(value)])));
  appStorage.removeMany = keys => stage(Object.fromEntries(keys.map(key => [key, null])));
  appStorage.replaceLedgerEntries = entries => {
    stage(Object.fromEntries(Object.keys(view()).map(key => [key, null])));
    appStorage.setMany(entries); return true;
  };

  async function transaction(change) {
    if (busy) throw Error('正在处理，请稍候');
    if (!ready) throw Error('账本存储未准备完成，未保存本次内容');
    if (conflict) throw Object.assign(Error('其他窗口已更新账本，请保留输入后重新打开；本次未保存。'), { code: 'conflict' });
    const previous = JSON.parse(JSON.stringify(dataState));
    const previousFundUi = JSON.parse(JSON.stringify(fundUi));
    setBusy(true);
    try {
      const latest = await database.read();
      if (latest.revision !== revision) throw Object.assign(Error('其他窗口已更新账本，请保留输入后重新打开；本次未保存。'), { code: 'conflict' });
      pending = {};
      const result = change();
      if (result && typeof result.then === 'function') throw Error('事务变更必须同步计算，不能夹入异步界面操作');
      const next = view(); validate(next);
      const changes = Object.fromEntries(Object.entries(pending).filter(([key, value]) =>
        value === null ? Object.prototype.hasOwnProperty.call(committed, key) : committed[key] !== value));
      if (Object.keys(changes).length) {
        const saved = await database.commit(revision, changes);
        // 提交完成前，绝不把待写内容提升为已提交快照。
        committed = next; revision = saved.revision;
        window.dispatchEvent(new CustomEvent('pwa-ledger-saved', { detail: { revision } }));
      }
      return result;
    } catch (error) {
      Object.assign(dataState, previous);
      Object.keys(fundUi).forEach(key => { if (!Object.prototype.hasOwnProperty.call(previousFundUi, key)) delete fundUi[key]; });
      Object.assign(fundUi, previousFundUi);
      if (error && error.code === 'conflict') conflict = true;
      throw error;
    } finally {
      pending = null; setBusy(false);
      if (idleHandler && ready && !conflict && !initializingCore) queueMicrotask(idleHandler);
    }
  }

  async function initializeCore(original) {
    initializingCore = true;
    try {
      if (!window.PwaFunds || !window.PwaManagement || !window.PwaBackup || window.JIZHANGBEN_PWA_RESOURCE_ERROR) throw Error('存储模块未加载完整，请重新打开；账本未更改。');
      await transaction(() => {
        original();
        if (uiState.startupNotice) throw Error('数据升级未完成');
        const accountsRaw = appStorage.get(accountsKey(dataState.currentBookId));
        if (accountsRaw === null) saveAccounts();
        else if (Array.isArray(JSON.parse(accountsRaw)) && JSON.parse(accountsRaw).length === 0) {
          // 明确保存的空账户列表表示用户已删除账户，不能再次展示预置账户。
          dataState.accounts = [];
          renderAccountSelects(); render();
        }
      });
      if (window.PwaFunds) await window.PwaFunds.flushDue(true);
      document.documentElement.classList.remove('pwa-storage-loading');
      return true;
    } catch (error) { stop(error); return false; }
    finally {
      initializingCore = false;
      if (ready && !stopped) window.dispatchEvent(new CustomEvent('pwa-ledger-ready'));
      if (idleHandler && ready && !conflict) queueMicrotask(idleHandler);
    }
  }
  function pendingFeature() {
    appNotice('此功能正在接入网页存储，本预览暂未开放。原安卓应用可继续使用。');
    return false;
  }
  // 仅限制这一独立接入预览；避免尚未改造的业务先改内存再走同步保存。
  const originalSwitchTab = switchTab;
  window.switchTab = function (tab, options) {
    if (busy) return false;
    const result = originalSwitchTab(tab, options);
    if (window.PwaFunds) queueMicrotask(() => window.PwaFunds.flushDue());
    return result;
  };
  for (const name of ['confirmMigrationImport', 'applyAccountPrincipal']) {
    window[name] = pendingFeature;
  }
  window.addEventListener('beforeunload', event => { if (busy && !programUpdating) { event.preventDefault(); event.returnValue = ''; } });
  for (const type of ['click', 'keydown', 'submit']) document.addEventListener(type, event => {
    if (busy && !gate.contains(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);

  window.PwaLedger = Object.freeze({
    get status() { return { ready, busy, conflict, revision, initializingCore }; },
    commitChange: transaction,
    beginProgramUpdate() {
      if (busy || !ready || conflict || initializingCore) return false;
      programUpdating = true; setBusy(true); gateText.textContent = '正在切换程序版本，请稍候…'; return true;
    },
    endProgramUpdate() {
      if (!programUpdating) return;
      programUpdating = false; setBusy(false); if (idleHandler) queueMicrotask(idleHandler);
    },
    async backupSnapshot() {
      if (!ready || busy) throw Error('账本尚未准备完成或正在保存，请稍后再导出。');
      const snapshot = await database.read();
      validate(snapshot.entries);
      return snapshot;
    },
    setIdleHandler(callback) { idleHandler = callback; },
    async start(initializeSecurity) {
      gateText.textContent = '正在准备本机账本，请稍候…';
      try {
        database = await LedgerDatabase.open({ onClose: error => stop(error) });
        const snapshot = await database.migrateLegacy(window.localStorage, validate);
        validate(snapshot.entries);
        committed = { ...snapshot.entries }; revision = snapshot.revision; ready = true;
        const originalCore = startApplicationCore;
        window.startApplicationCore = () => (corePromise = initializeCore(originalCore));
        initializeSecurity();
        if (corePromise) await corePromise;
        if (!ready) return;
        document.documentElement.classList.remove('pwa-storage-loading');
        gate.hidden = true;
        window.PwaLedgerPersistence = await LedgerDatabase.persistenceStatus();
      } catch (error) { if (database) database.close(); stop(error); }
    },
    async saveRecord(record, balance) {
      if (busy) { showMsg('正在保存，请稍候', 'busy'); return false; }
      const editingId = uiState.editingRecordId;
      setRecordSaveBusy(true);
      try {
        await transaction(() => {
          if (editingId !== null) {
            const current = dataState.records.find(item => String(item.id) === String(editingId));
            if (!current || current.fundProjectId) throw Error('找不到可编辑的记录');
            applyRecordDraft(current, record);
          } else dataState.records.push({ ...record });
          if (record.type === '余额' && balance.accountId) {
            const account = dataState.accounts.find(item => String(item.id) === String(balance.accountId));
            if (!account || account.fundOnly) throw Error('账户不可修改');
            account.name = balance.name;
            if (balance.principal !== null) { account.initialCents = toCents(balance.principal); account.initial = account.initialCents / 100; }
            saveAccounts();
          }
          save();
        });
        resetFormAfterSave(record);
        showMsg(editingId === null ? '已记一笔' : '已保存修改', 'local');
        render();
        if (window.PwaFunds) await window.PwaFunds.flushDue(true);
        continueRecordingAfterSave();
        return true;
      } catch (error) {
        showMsg(message(error), 'conflict');
        if (ready && uiState.activeTab === 'record') showRecordKeyboard();
        return false;
      }
      finally { setRecordSaveBusy(false); }
    },
    async saveAccount({ name, kind, initialCents, editingId }) {
      if (busy) { showAccMsg('正在处理，请稍候'); return false; }
      setAccountSaveBusy(true);
      try {
        await transaction(() => {
          if (editingId !== null) {
            const account = dataState.accounts.find(item => String(item.id) === String(editingId));
            if (!account || account.fundOnly) throw Error('账户不可修改');
            Object.assign(account, { name, kind, initialCents, initial: initialCents / 100 });
          } else dataState.accounts.push({ id: nextId(dataState.accounts), name, kind, initialCents, initial: initialCents / 100 });
          saveAccounts();
        });
        resetAccountForm(); showAccMsg(editingId === null ? '已添加账户' : '已保存修改'); render(); return true;
      } catch (error) { showAccMsg(message(error)); return false; }
      finally { setAccountSaveBusy(false); }
    },
    async deleteRecord(id, fingerprint) {
      if (busy) return false;
      uiState.recordDeleteInFlight = true;
      try {
        await transaction(() => {
          const current = dataState.records.find(item => String(item.id) === String(id));
          if (!current || current.fundProjectId || !localRecordMatchesFingerprint(current, fingerprint)) throw Error('记录已变化');
          dataState.records = dataState.records.filter(item => String(item.id) !== String(id)); save();
        });
        showMsg('已删除', 'local'); render(); return true;
      } catch (error) { showMsg(message(error), 'conflict'); return false; }
      finally { uiState.recordDeleteInFlight = false; }
    },
    async deleteAccount(id, fingerprint) {
      if (busy) return false;
      setAccountDeleteBusy(true);
      try {
        await transaction(() => {
          const current = dataState.accounts.find(item => String(item.id) === String(id));
          if (!current || current.fundOnly || JSON.stringify(accountFingerprint(current)) !== JSON.stringify(fingerprint)) throw Error('账户已变化');
          dataState.accounts = dataState.accounts.filter(item => String(item.id) !== String(id)); saveAccounts();
        });
        resetAccountForm(); showAccMsg('已删除账户'); render(); return true;
      } catch (error) { showAccMsg(message(error)); return false; }
      finally { setAccountDeleteBusy(false); }
    }
  });
})();
