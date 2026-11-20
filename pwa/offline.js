/* 离线状态与显式更新。仅程序资源缓存，不改写账本结构或记录。 */
(function () {
  'use strict';
  const VERSION = window.JIZHANGBEN_PWA_BUILD_ID;
  let registration = null, ready = false, phase = 'preparing', applying = false, activeVersion = null;
  const panel = document.createElement('details'); panel.className = 'pwa-offline';
  panel.innerHTML = `
    <summary id="pwaOfflineStatus">
      <strong id="pwaUpdateTitle">应用与更新</strong>
      <span id="pwaOfflineState" class="pwa-update-state">正在准备离线资源…</span>
      <span class="pwa-update-arrow" aria-hidden="true">›</span>
    </summary>
    <p id="pwaOfflineMessage">首次使用需要联网下载完整程序，账目仍保存在本机。</p>
    <div class="pwa-backup-actions">
      <button type="button" class="btn-ghost" id="pwaOfflineCheck">检查离线与更新</button>
      <button type="button" class="btn-primary" id="pwaOfflineApply" hidden>保留草稿并更新</button>
    </div>`;
  const updateSection = document.createElement('section');
  updateSection.className = 'pwa-update-section';
  updateSection.setAttribute('aria-labelledby', 'pwaUpdateTitle');
  updateSection.append(panel);
  document.querySelector('#panelBook .page-head').after(updateSection);
  const status = document.getElementById('pwaOfflineState'), message = document.getElementById('pwaOfflineMessage');
  const updateButton = document.getElementById('pwaOfflineApply');
  const settingsButton = document.getElementById('bookManageBtn');
  function showUpdateAvailable(available) {
    updateButton.hidden = !available;
    settingsButton.toggleAttribute('data-pwa-update', available);
    if (available) settingsButton.setAttribute('aria-label', '设置，有新版可更新');
    else settingsButton.removeAttribute('aria-label');
  }
  function text(summary, detail) { status.textContent = summary; if (detail) message.textContent = detail; }
  function rpc(worker, data) {
    return new Promise((resolve, reject) => {
      if (!worker) { reject(Error('离线程序尚未就绪')); return; }
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(Error('离线程序未响应，请联网重试')); }, 12000);
      channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
      worker.postMessage(data, [channel.port2]);
    });
  }
  async function refresh() {
    if (!registration) return;
    try {
      const worker = navigator.serviceWorker.controller || registration.active;
      const result = await rpc(worker, { type: 'STATUS', version: VERSION });
      ready = result.ready === true; activeVersion = result.version;
      const waiting = !!registration.waiting || !!activeVersion && activeVersion !== VERSION;
      showUpdateAvailable(waiting);
      if (waiting) {
        phase = 'update'; text('新版已准备', ready ? '当前版本仍可离线使用。更新会重新打开程序；新记账草稿会先核对保存，其他编辑请先完成。' : '当前版本离线资源不完整。请先完成编辑，再联网切换已准备的新版本。');
      } else if (ready) {
        phase = 'ready'; text(navigator.onLine ? '可离线使用' : '当前离线，可继续记账', '程序离线缓存与账目分开保存。网站数据被清理仍可能丢失账目，请另存备份。');
      } else { phase = 'incomplete'; text('离线资源未完整准备', '请联网后点击检查重试；不要清理网站数据或账本。'); }
      return ready;
    } catch (_) { ready = false; phase = 'incomplete'; showUpdateAvailable(false); text('暂时无法确认离线状态', '请联网后点击检查重试，当前账本不受此检查影响。'); return false; }
  }
  function watch(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' || worker.state === 'activated') refresh();
      if (worker.state === 'redundant') {
        phase = 'failed'; text(ready ? '当前版本可用，新版准备未完成' : '离线准备未完成', '资源可能下载中断或校验失败。请联网重试；当前账本未更改。');
      }
    });
  }
  async function check() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) { phase = 'unsupported'; text('当前环境无法准备离线使用', '请使用支持的浏览器与固定的安全网址。账本仍需另存备份。'); return false; }
    document.getElementById('pwaOfflineCheck').disabled = true;
    try {
      if (!registration || (!registration.active && !registration.waiting && !registration.installing)) {
        registration = await navigator.serviceWorker.register(new URL('service-worker.js', document.baseURI), { scope: './', updateViaCache: 'none' });
        registration.addEventListener('updatefound', () => watch(registration.installing));
        watch(registration.installing);
      } else if (navigator.onLine) await registration.update();
      if (registration.active || navigator.serviceWorker.controller) {
        if (!await refresh() && navigator.onLine) {
          await rpc(navigator.serviceWorker.controller || registration.active, { type: 'REPAIR', version: VERSION });
          return await refresh();
        }
        return ready;
      }
      phase = 'preparing'; text('正在准备离线资源…', '资源全部下载并核对后，才会显示可离线使用。请暂时保持联网。'); return false;
    } catch (_) { phase = 'failed'; text('离线准备未完成', '请联网后重试。当前浏览器可能暂不支持离线缓存；不要清理账本数据。'); return false; }
    finally { document.getElementById('pwaOfflineCheck').disabled = false; }
  }
  const value = id => document.getElementById(id)?.value || '';
  function preserveDraft() {
    if (uiState.editingRecordId !== null || uiState.editingAccountId !== null || uiState.editingBookId !== null || categoryItemIconEditState || pendingConfirm || pendingNotice) throw Error('请先保存或取消当前编辑，再更新程序。');
    if (!['home', 'record', 'book'].includes(uiState.activeTab)) throw Error('请先完成当前页面操作，再到设置更新程序。');
    if (value('bookName').trim() || value('accName').trim() || value('accInitial').trim() || value('categoryGroupName').trim() || value('customInput').trim() ||
      [...document.querySelectorAll('.category-system-sub-input')].some(input => input.value.trim()) ||
      document.querySelector('.category-system-rename-editor') ||
      ['form','redeem','adjust','transaction'].includes(fundUi.view) || externalImportState.rows.length) throw Error('其他页面还有未完成的编辑或导入，请先保存或取消。');
    const period = dataState.budgetData?.periods?.[budgetUiState.month];
    if ((value('budgetTotalInput').trim() ? toCents(value('budgetTotalInput')) : null) !== (period?.totalCents ?? null) ||
      value('budgetCategoryInput').trim() || [...document.querySelectorAll('[data-budget-category]')].some(row =>
        toCents(row.querySelector('input')?.value || '') !== period?.categories?.[row.dataset.budgetCategory])) throw Error('预算还有未保存的额度，请先保存或取消。');
    const pension = dataState.fixedIncomePlan;
    const pensionChanged = pension ? toCents(value('fixedIncomeAmount')) !== pension.amountCents || value('fixedIncomeAccount') !== String(pension.accountId) ||
      value('fixedIncomeDay') !== String(pension.day) || value('fixedIncomeStartMonth') !== pension.startMonth || document.getElementById('fixedIncomeEnabled').checked !== pension.active
      : value('fixedIncomeAmount').trim() || value('fixedIncomeAccount') || document.getElementById('fixedIncomeEnabled').checked;
    if (pensionChanged || document.querySelector('.device-lock-settings[open]')) throw Error('退休金或密码设置尚未完成，请先保存或取消。');
    const fields = {};
    RECORD_DRAFT_FIELDS.forEach(id => { const field = document.getElementById(id); if (field) fields[id] = field.type === 'checkbox' ? field.checked : field.value; });
    const expression = typeof recordKeyboardExpression === 'string' && recordKeyboardTargetId === 'amount' ? recordKeyboardExpression : String(fields.amount || '');
    if (!recordDraftHasAmount({ expression, fields })) {
      if (String(fields.note || '').trim()) throw Error('当前备注尚未保存，请先完成或清空这笔记账。');
      return;
    }
    const draft = { version: 1, bookId: dataState.currentBookId, updatedAt: Date.now(), type: uiState.selectedType, category: uiState.selectedCategory,
      depositDir: uiState.selectedDepositDir, loanMode: uiState.selectedLoanMode, payMode: uiState.selectedPayMode, transferMode: uiState.selectedTransferMode, expression, fields };
    const raw = JSON.stringify(draft);
    try { localStorage.setItem(RECORD_DRAFT_KEY, raw); if (localStorage.getItem(RECORD_DRAFT_KEY) !== raw) throw Error('draft'); }
    catch (_) { throw Error('未能核对保存当前草稿，已取消更新；输入仍保留在页面。'); }
  }
  async function applyUpdate() {
    if (applying || !registration) return false;
    if (PwaLedger.status.busy || PwaManagement.busy || PwaBackup.busy) { message.textContent = '正在保存或处理文件，请完成后再更新。'; return false; }
    try { preserveDraft(); } catch (error) { message.textContent = error.message; return false; }
    if (!PwaLedger.beginProgramUpdate()) { message.textContent = '账本状态尚未就绪，请稍后再更新。'; return false; }
    applying = true;
    try {
      if (registration.waiting) {
        const result = await rpc(registration.waiting, { type: 'ACTIVATE' });
        if (!result.ok) throw Error(result.reason || '暂时无法切换，请联网重试。');
        // controllerchange 负责在这次明确的用户操作后重开页面。
        setTimeout(() => { if (applying) location.reload(); }, 500);
      } else if (activeVersion && activeVersion !== VERSION) location.reload();
      else throw Error('尚无准备完成的新版本，请先检查更新。');
      return true;
    } catch (error) { applying = false; PwaLedger.endProgramUpdate(); message.textContent = error.message; return false; }
  }
  document.getElementById('pwaOfflineCheck').onclick = check;
  updateButton.onclick = applyUpdate;
  window.addEventListener('pwa-ledger-ready', () => { check().then(() => {
    if (registration && ready) rpc(navigator.serviceWorker.controller || registration.active, { type: 'CLEANUP', version: VERSION }).catch(() => {});
  }); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (applying) location.reload(); else refresh();
  });
  window.addEventListener('online', check); window.addEventListener('offline', refresh);
  window.PwaOffline = Object.freeze({ check, applyUpdate, refresh, get state() { return { ready, phase, version: VERSION, activeVersion, waiting: !!registration?.waiting, applying }; } });
})();
