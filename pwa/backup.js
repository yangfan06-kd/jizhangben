/* PWA 备份：准备快照、由用户选择文件操作；下载/分享不冒充保存完成。 */
(function () {
  'use strict';
  const PREF_KEY = 'ledger_pwa_backup_status_v1', WEEK = 7 * 86400000;
  let preparing = false, reading = false, acting = false, restoring = false;
  let prepared = null, preview = null, operation = 0, prefWarning = false;
  let lastExport = null;
  const section = document.getElementById('exportBtn').closest('.settings-section');
  section.querySelector('.backup-desc').textContent = '账目保存在本机。请另存备份到“文件”或其他设备；清理网站数据、删除网页应用或换机可能影响记录。备份含原始账目，请妥善保管；不包含密码和未保存的记账内容。';
  document.getElementById('migrationPreviewBtn').hidden = true;
  const area = document.createElement('div'); area.className = 'pwa-backup';
  area.innerHTML = `
    <p id="pwaBackupHistory" class="pwa-backup-history"></p>
    <p id="pwaBackupActionStatus" role="status" aria-live="polite"></p>
    <section id="pwaBackupExport" class="pwa-backup-panel" hidden aria-labelledby="pwaBackupExportTitle">
      <h4 id="pwaBackupExportTitle">选择备份保存方式</h4>
      <p id="pwaBackupExportInfo"></p>
      <p>备份包含准备时已保存的内容。此后新增账目，请重新准备备份。</p>
      <div class="pwa-backup-actions">
        <button id="pwaBackupSaveFile" class="btn-primary" type="button">保存文件</button>
        <button id="pwaBackupShare" class="btn-ghost" type="button">分享备份</button>
        <button id="pwaBackupDownload" class="btn-ghost" type="button">下载备份</button>
        <button id="pwaBackupExportClose" class="btn-ghost" type="button">收起</button>
      </div>
      <p>苹果手机可在系统分享中选择“存储到文件”；若没有此项，请下载后到“文件”核对。这里不会自动保存到云端。</p>
      <button id="pwaBackupConfirmFile" class="btn-ghost" type="button" hidden>我已在文件中确认备份</button>
    </section>
    <section id="pwaBackupImport" class="pwa-backup-panel" hidden aria-labelledby="pwaBackupImportTitle">
      <h4 id="pwaBackupImportTitle" tabindex="-1">恢复备份预览</h4>
      <p id="pwaBackupImportFile"></p>
      <div id="pwaBackupImportSummary"></div>
      <div id="pwaBackupImportBooks"></div>
      <p>恢复会替换本机当前所有账本，不会与现有记录合并。建议先导出当前账本，再核对这份文件。</p>
      <div class="pwa-backup-actions">
        <button id="pwaBackupRestore" class="btn-primary" type="button">恢复这份备份</button>
        <button id="pwaBackupImportCancel" class="btn-ghost" type="button">取消预览</button>
      </div>
    </section>`;
  section.querySelector('.external-import-entry').before(area);
  const reminder = document.createElement('aside'); reminder.id = 'pwaBackupReminder'; reminder.hidden = true;
  reminder.setAttribute('aria-label', '备份提醒');
  reminder.innerHTML = '<p>账目只保存在本机，建议另存一份备份。</p><div class="pwa-backup-actions"><button type="button" id="pwaBackupGo" class="btn-ghost">去备份</button><button type="button" id="pwaBackupSnooze" class="btn-ghost">一周后提醒</button></div>';
  document.getElementById('panelHome').append(reminder);
  const el = id => document.getElementById(id);
  let prefs = {};
  try { const value = JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); if (value && typeof value === 'object' && !Array.isArray(value)) prefs = value; } catch (_) { prefWarning = true; }
  function storePrefs() {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); return true; }
    catch (_) { prefWarning = true; return false; }
  }
  function report(text, warn = false) {
    const node = el('pwaBackupActionStatus'); node.textContent = text; node.classList.toggle('warn', warn);
  }
  function history() {
    const last = prefs.lastAction;
    const date = value => new Date(value).toLocaleString('zh-CN', { hour12: false });
    const labels = { requested: '已发起下载，尚未确认保存', shared: '已交给系统分享，尚未确认保存', verified: '已写入并核对文件', confirmed: '由你确认文件已保存', cancelled: '已取消文件操作', failed: '文件操作未完成' };
    const text = last && labels[last.state] && Number.isFinite(last.at) ? '最近备份操作：' + date(last.at) + '，' + labels[last.state] + '。' : '尚无已确认的文件备份。';
    el('pwaBackupHistory').textContent = text + (prefs.confirmedAt ? ' 最近确认：' + date(prefs.confirmedAt) + '。' : '') + (prefWarning ? ' 本机无法完整读取或记录备份时间，请自行核对文件。' : '');
  }
  function recordAction(state, method, snapshot, confirmed = false) {
    prefs.lastAction = { state, method, at: Date.now() };
    if (confirmed) { prefs.confirmedAt = Date.now(); prefs.confirmedRevision = snapshot.revision; }
    storePrefs(); history(); updateReminder();
  }
  function updateReminder() {
    if (!window.PwaLedger?.status.ready || PwaLedger.status.initializingCore || !dataState.currentBookId) return;
    const hasRecords = Object.entries(appStorage.entries('jizhangben_')).some(([key, raw]) =>
      (key === STORAGE_KEY || key.startsWith('jizhangben_records_')) && JSON.parse(raw).length > 0);
    const changed = prefs.confirmedRevision !== PwaLedger.status.revision;
    reminder.hidden = !hasRecords || !changed || (Number(prefs.snoozedUntil) > Date.now()) ||
      (Number(prefs.confirmedAt) > 0 && Date.now() - prefs.confirmedAt < WEEK);
  }
  function summary(storage) {
    const read = (key, fallback) => Object.hasOwn(storage, key) ? JSON.parse(storage[key]) : fallback;
    const books = read(BOOKS_KEY, [{ id: 1, name: '我的账本', category: '个人' }]);
    const rows = books.map((book, index) => {
      const records = read(recordsKey(book.id), index === 0 ? read(STORAGE_KEY, []) : []);
      const accounts = read(accountsKey(book.id), index === 0 ? read(ACCOUNTS_KEY, []) : []);
      const dates = records.map(record => record.date).filter(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
      return { name: book.name, records: records.length, accounts: accounts.length, from: dates[0] || '', to: dates[dates.length - 1] || '' };
    });
    const system = read(CATEGORY_SYSTEM_KEY, { groups: [], hidden: [] });
    return { books: rows, records: rows.reduce((sum, row) => sum + row.records, 0), accounts: rows.reduce((sum, row) => sum + row.accounts, 0),
      groups: system.groups.length, items: system.groups.reduce((sum, group) => sum + group.items.length, 0), hidden: system.hidden.length,
      icons: Object.keys(read(CUSTOM_CATEGORY_ICONS_KEY, {})).length };
  }
  function buttons() {
    const busy = preparing || reading || acting || restoring;
    area.setAttribute('aria-busy', String(busy));
    for (const id of ['exportBtn','importBtn','pwaBackupSaveFile','pwaBackupShare','pwaBackupDownload','pwaBackupExportClose','pwaBackupConfirmFile','pwaBackupRestore','pwaBackupImportCancel']) el(id).disabled = busy;
  }
  function settled() { buttons(); setTimeout(() => { if (window.PwaFunds) PwaFunds.flushDue(); }, 0); }
  async function prepareExport() {
    if (preparing || reading || acting || restoring || PwaLedger.status.busy) return false;
    preparing = true; prepared = null; lastExport = null; buttons(); el('pwaBackupConfirmFile').hidden = true;
    report('正在准备已保存的账本，请稍候…');
    try {
      const snapshot = await PwaLedger.backupSnapshot();
      prepared = { ...createLedgerBackup(snapshot.entries), revision: snapshot.revision };
      extractBackupStorage(prepared.data);
      const counts = summary(prepared.data.storage);
      el('pwaBackupExportInfo').textContent = prepared.fileName + ' · ' + counts.books.length + ' 个账本、' + counts.records + ' 笔流水。准备时间：' + new Date().toLocaleString('zh-CN', { hour12: false });
      el('pwaBackupSaveFile').hidden = typeof window.showSaveFilePicker !== 'function';
      const file = new File([prepared.content], prepared.fileName, { type: 'application/json' });
      let shareable = false;
      try { shareable = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] }); } catch (_) {}
      el('pwaBackupShare').hidden = !shareable;
      el('pwaBackupExport').hidden = false;
      report('备份已准备，请选择保存方式。尚未生成已确认的文件备份。'); return true;
    } catch (_) { el('pwaBackupExport').hidden = true; report('无法准备完整备份，未发起文件操作。请保留网站数据，稍后重试。', true); return false; }
    finally { preparing = false; settled(); }
  }
  async function exportFile(method) {
    if (!prepared || preparing || reading || acting || restoring || PwaLedger.status.busy) return false;
    acting = true; buttons(); lastExport = null; el('pwaBackupConfirmFile').hidden = true;
    const snapshot = prepared;
    let stream = null, written = false;
    try {
      if (method === 'save') {
        if (typeof window.showSaveFilePicker !== 'function') throw Error('unsupported');
        // 不在系统弹窗前等待异步读取，以保留这次按钮点击的用户激活。
        const handle = await window.showSaveFilePicker({ suggestedName: snapshot.fileName, types: [{ description: '记账本备份', accept: { 'application/json': ['.json'] } }] });
        stream = await handle.createWritable(); await stream.write(snapshot.content); await stream.close(); written = true;
        if (await (await handle.getFile()).text() !== snapshot.content) throw Error('verify_failed');
        recordAction('verified', method, snapshot, true); report('已写入并核对备份文件。请保留这份文件，定期另存新备份。');
      } else if (method === 'share') {
        const file = new File([snapshot.content], snapshot.fileName, { type: 'application/json' });
        if (!navigator.canShare?.({ files: [file] }) || typeof navigator.share !== 'function') throw Error('unsupported');
        await navigator.share({ files: [file], title: '记账本备份' });
        recordAction('shared', method, snapshot); lastExport = snapshot;
        el('pwaBackupConfirmFile').hidden = false;
        report('已交给系统分享，尚未确认保存。请选择“存储到文件”，并在“文件”中核对后再确认。');
      } else {
        const url = URL.createObjectURL(new Blob([snapshot.content], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = snapshot.fileName;
        try { document.body.appendChild(link); link.click(); }
        finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
        recordAction('requested', 'download', snapshot); lastExport = snapshot;
        el('pwaBackupConfirmFile').hidden = false;
        report('已发起下载，尚未确认保存。请到“文件”或下载列表中核对备份后再确认。');
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      return true;
    } catch (error) {
      if (stream && !written) { try { await stream.abort(); } catch (_) {} }
      const cancelled = error?.name === 'AbortError';
      recordAction(cancelled ? 'cancelled' : 'failed', method, snapshot);
      report(cancelled ? '已取消文件操作，尚未确认保存；当前账本未更改。' : written
        ? '文件写入已结束，但内容核对未通过。请保留原备份并重新另存；当前账本未更改。'
        : '备份文件操作未完成，请重试或选择其他保存方式；当前账本未更改。', !cancelled);
      return false;
    } finally { acting = false; settled(); }
  }
  async function previewImport(file) {
    if (!file || acting || restoring || preparing || PwaLedger.status.busy) return false;
    const token = ++operation; reading = true; preview = null; el('pwaBackupImport').hidden = true; buttons();
    report('正在读取并校验备份，当前账本尚未更改…');
    try {
      const imported = extractBackupStorage(await readBackupFile(file));
      const current = await PwaLedger.backupSnapshot();
      if (token !== operation) return false;
      preview = { imported, revision: current.revision, fileName: file.name };
      const info = summary(imported), currentInfo = summary(createLedgerBackup(current.entries).data.storage);
      el('pwaBackupImportFile').textContent = file.name;
      el('pwaBackupImportSummary').textContent = '文件内：' + info.books.length + ' 个账本、' + info.accounts + ' 个已保存账户、' + info.records + ' 笔流水；' + info.groups + ' 个大类、' + info.items + ' 个小类、' + info.icons + ' 个自定义图标、' + info.hidden + ' 个隐藏项。当前本机：' + currentInfo.books.length + ' 个账本、' + currentInfo.records + ' 笔流水。';
      const list = el('pwaBackupImportBooks'); list.replaceChildren();
      info.books.forEach(book => {
        const item = document.createElement('p');
        item.textContent = book.name + ' · ' + book.records + ' 笔流水、' + book.accounts + ' 个账户' + (book.from ? ' · ' + book.from + ' 至 ' + book.to : '');
        list.appendChild(item);
      });
      el('pwaBackupImport').hidden = false;
      el('pwaBackupImportTitle').focus({ preventScroll: true });
      el('pwaBackupImport').scrollIntoView({ block: 'nearest' });
      report('备份校验完成，请核对预览后再决定是否恢复。当前账本未更改。'); return true;
    } catch (_) {
      if (token === operation) { report('备份文件无效或无法读取，当前账本未更改，请重新选择。', true); showBackupMsg('备份文件无效或无法读取，当前账本未更改，请重新选择。', true); }
      return false;
    } finally { if (token === operation) { reading = false; settled(); } }
  }
  async function restorePreview() {
    if (!preview || reading || preparing || acting || restoring || PwaLedger.status.busy) return false;
    restoring = true; buttons();
    try {
      if (!await appConfirm('确认用预览中的备份替换本机所有账本吗？当前账本不会与备份合并，请先确认已保留需要的文件。')) return false;
      report('正在恢复备份，请稍候…');
      const done = await PwaManagement.restoreBackup(preview.imported, preview.revision);
      if (done) {
        preview = null; el('pwaBackupImport').hidden = true; prepared = null; el('pwaBackupExport').hidden = true; lastExport = null;
        if (!el('pwaBackupActionStatus').classList.contains('warn')) report('已恢复备份。请核对账本与类别；以后新增记录仍需另存备份。');
      }
      return done;
    } finally { restoring = false; settled(); updateReminder(); }
  }
  function cancelPreview() {
    if (restoring) return false;
    operation++; reading = false; preview = null; el('pwaBackupImport').hidden = true; settled();
    report('已取消恢复预览，当前账本未更改。'); return true;
  }
  el('pwaBackupSaveFile').onclick = () => exportFile('save');
  el('pwaBackupShare').onclick = () => exportFile('share');
  el('pwaBackupDownload').onclick = () => exportFile('download');
  el('pwaBackupExportClose').onclick = () => { prepared = null; lastExport = null; el('pwaBackupExport').hidden = true; };
  el('pwaBackupConfirmFile').onclick = () => {
    if (!lastExport || acting) return;
    recordAction('confirmed', 'user', lastExport, true); lastExport = null; el('pwaBackupConfirmFile').hidden = true;
    report('已记录你的文件保存确认。请保留文件，并定期用新的备份替换旧备份。');
  };
  el('pwaBackupRestore').onclick = restorePreview;
  el('pwaBackupImportCancel').onclick = cancelPreview;
  el('pwaBackupGo').onclick = () => { switchTab('book'); el('exportBtn').focus(); };
  el('pwaBackupSnooze').onclick = () => { prefs.snoozedUntil = Date.now() + WEEK; storePrefs(); history(); updateReminder(); };
  window.addEventListener('pwa-ledger-ready', () => { history(); updateReminder(); });
  window.addEventListener('pwa-ledger-saved', () => { setTimeout(updateReminder, 0); });
  history();
  window.PwaBackup = Object.freeze({ get busy() { return preparing || reading || acting || restoring; },
    prepareExport, exportFile, previewImport, restorePreview, cancelPreview, report, summary, updateReminder });
})();
