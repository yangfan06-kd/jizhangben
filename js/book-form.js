// 账本管理模块：负责账本切换、列表渲染、新增、编辑、删除和管理面板显示。
// 账本清单保存在 state.js 的 dataState.books 中；页面刷新和其他表单由入口脚本协调。

let bookMsgTimer = null;

function showBookMsg(text, isWarn) {
  const m = document.getElementById("bookMsg");
  m.textContent = text;
  m.classList.toggle("warn", !!isWarn);
  clearTimeout(bookMsgTimer);
  bookMsgTimer = setTimeout(() => { m.textContent = ""; }, isWarn ? 5000 : 3000);
}

function setBookSaveBusy(busy) {
  uiState.bookSaveInFlight = !!busy;
  const saveBtn = document.getElementById("bookSaveBtn");
  const cancelBtn = document.getElementById("bookCancelBtn");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy) saveBtn.textContent = "保存中…";
    else saveBtn.textContent = uiState.editingBookId === null ? "添加账本" : "保存修改";
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function setBookDeleteBusy(busy) {
  uiState.bookDeleteInFlight = !!busy;
  const saveBtn = document.getElementById("bookSaveBtn");
  const cancelBtn = document.getElementById("bookCancelBtn");
  if (saveBtn) {
    saveBtn.disabled = !!busy;
    if (busy) saveBtn.textContent = "删除中…";
    else saveBtn.textContent = uiState.editingBookId === null ? "添加账本" : "保存修改";
  }
  if (cancelBtn) cancelBtn.disabled = !!busy;
}

function bookFingerprint(book) {
  return book ? { name: book.name, category: book.category || "未分类" } : null;
}

function findLocalBookByFingerprint(fingerprint) {
  if (!fingerprint) return null;
  const matches = dataState.books.filter(book => (
    book.name === fingerprint.name && (book.category || "未分类") === fingerprint.category
  ));
  return matches.length === 1 ? matches[0] : null;
}

function applyLocalBookDelete(id) {
  dataState.books = dataState.books.filter(x => String(x.id) !== String(id));
  appStorage.remove(recordsKey(id));
  appStorage.remove(accountsKey(id));
  saveBooks();
  if (String(dataState.currentBookId) === String(id) && dataState.books.length > 0) {
    dataState.currentBookId = dataState.books[0].id;
    appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
    load();
    loadAccounts();
    resetForm();
    resetAccountForm();
    resetFilterState();
    ["fromDate", "toDate", "filterAccountSel", "filterCategorySel", "searchInput"].forEach(fieldId => {
      const field = document.getElementById(fieldId);
      if (field) field.value = "";
    });
  }
}

// 顶部下拉：按分类分组列出所有账本
function renderBookSelect() {
  const sel = document.getElementById("bookSel");
  sel.innerHTML = "";
  const cats = [];
  dataState.books.forEach(b => { if (!cats.includes(b.category)) cats.push(b.category); });
  cats.forEach(cat => {
    const group = dataState.books.filter(b => b.category === cat);
    const og = document.createElement("optgroup");
    og.label = cat;
    group.forEach(b => {
      const op = document.createElement("option");
      op.value = String(b.id);
      op.textContent = b.name;
      og.appendChild(op);
    });
    sel.appendChild(og);
  });
  sel.value = String(dataState.currentBookId);
}

// 切换到另一个账本：记住选择，重新读这个账本的账目和账户
function switchBook(id) {
  const selectedBook = dataState.books.find(b => String(b.id) === String(id));
  if (!selectedBook) return;
  dataState.currentBookId = selectedBook.id;
  appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
  load();
  loadAccounts();
  // 清掉编辑中的状态和筛选，避免串到别的账本
  resetForm();
  resetAccountForm();
  resetFilterState();
  document.getElementById("fromDate").value = "";
  document.getElementById("toDate").value = "";
  document.getElementById("filterAccountSel").value = "";
  document.getElementById("filterCategorySel").value = "";
  document.getElementById("searchInput").value = "";
  renderBookSelect();
  renderAccountSelects();
  fillCategoryFilter();
  render();
  if (dataState.backendBooksLoaded) {
    const localAccounts = dataState.accounts;
    const localRecords = dataState.records;
    Promise.all([hydrateAccountsFromBackend(), hydrateRecordsFromBackend()]).then(results => {
      if (!results.every(Boolean)) {
        dataState.accounts = localAccounts;
        dataState.records = localRecords;
        dataState.backendRecordsLoaded = false;
        render();
        return;
      }
      renderAccountSelects();
      render();
    }).catch(() => {
      dataState.accounts = localAccounts;
      dataState.records = localRecords;
      dataState.backendRecordsLoaded = false;
      render();
    });
  }
}

function renderBookList() {
  const box = document.getElementById("bookList");
  box.innerHTML = "";
  if (dataState.books.length === 0) {
    box.innerHTML = '<div class="empty small">还没有账本，先建一个吧</div>';
    return;
  }
  dataState.books.forEach(b => {
    const row = document.createElement("div");
    row.className = "acc-row";
    row.innerHTML = `
      <div class="acc-main">
        <div>
          <span class="acc-name">${esc(b.name)}</span>
          <span class="acc-kind">${esc(b.category)}</span>
          ${String(b.id) === String(dataState.currentBookId) ? '<span class="acc-kind">当前</span>' : ''}
        </div>
      </div>
      <div class="row-actions">
        <button class="mini-btn" data-id="${b.id}" data-act="use">用</button>
        <button class="mini-btn" data-id="${b.id}" data-act="edit">改</button>
        <button class="mini-btn danger" data-id="${b.id}" data-act="del">删</button>
      </div>
    `;
    box.appendChild(row);
  });
  box.querySelectorAll(".mini-btn").forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.id;
      if (btn.dataset.act === "use") { switchBook(id); toggleBookPanel(false); }
      else if (btn.dataset.act === "edit") startEditBook(id);
      else deleteBook(id);
    };
  });
}

function resetBookForm() {
  uiState.editingBookId = null;
  document.getElementById("bookName").value = "";
  document.getElementById("bookCategory").value = "";
  document.getElementById("bookSaveBtn").textContent = "添加账本";
  document.getElementById("bookCancelBtn").style.display = "none";
  document.getElementById("bookMsg").textContent = "";
}

async function handleBookSave() {
  if (uiState.bookSaveInFlight || uiState.bookDeleteInFlight) {
    showBookMsg("正在处理，请稍候", true);
    return;
  }
  const name = document.getElementById("bookName").value.trim();
  const category = document.getElementById("bookCategory").value.trim() || "未分类";
  if (!name) { showBookMsg("请填写账本名称"); return; }
  // 重名提醒（不禁止）：同名账本在顶部下拉里会分不清
  const dup = dataState.books.find(x => x.name === name && String(x.id) !== String(uiState.editingBookId));
  const wasEdit = uiState.editingBookId !== null;
  const originalBook = wasEdit
    ? dataState.books.find(x => String(x.id) === String(uiState.editingBookId))
    : null;
  const originalFingerprint = bookFingerprint(originalBook);
  let backendFallback = false;

  if (wasEdit && !originalBook) {
    showBookMsg("找不到正在编辑的账本，请重新选择", true);
    return;
  }

  if (wasEdit && backendWritesEnabled() && originalBook && typeof originalBook.id === "string") {
    setBookSaveBusy(true);
    try {
      const saved = await backendApi.updateBook(originalBook.id, { name, group_name: category });
      if (!saved || !saved.id) throw new Error("book_response_invalid");
      const index = dataState.books.findIndex(x => String(x.id) === String(originalBook.id));
      if (index >= 0) dataState.books[index] = mapBackendBook(saved);
      await refreshBackendOverviewAfterWrite();
      const backendDup = Array.isArray(saved.warnings) && saved.warnings.some(w => w.code === "duplicate_book_name");
      resetBookForm();
      showBookMsg(backendDup ? "已保存到账本服务端（注意：已有同名账本，请留意区分）" : "已保存到账本服务端", backendDup);
      renderBookSelect();
      renderBookList();
      renderOverview();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showBookMsg(error.message || "服务端拒绝了账本修改", true);
      } else {
        restoreLocalStateFromStorage();
        const localBook = findLocalBookByFingerprint(originalFingerprint);
        if (!localBook) {
          showBookMsg("服务端不可用，本地未找到原账本，修改未保存", true);
        } else {
          localBook.name = name;
          localBook.category = category;
          saveBooks();
          resetBookForm();
          showBookMsg("服务端不可用，已在本地保存修改", true);
          renderBookSelect();
          renderBookList();
          renderOverview();
        }
      }
    } finally {
      setBookSaveBusy(false);
    }
    return;
  }

  // 新账本和账本修改都优先写入后端；当前编辑对象缺少服务端 ID 时继续本地流程。
  if (!wasEdit && backendWritesEnabled()) {
    setBookSaveBusy(true);
    try {
      const saved = await backendApi.createBook({ name, group_name: category });
      if (!saved || !saved.id) throw new Error("book_response_invalid");
      const mapped = mapBackendBook(saved);
      const activateCreatedBook = !dataState.currentBookId;
      dataState.books.push(mapped);
      if (activateCreatedBook) {
        dataState.currentBookId = mapped.id;
        appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
        const [accountsLoaded, recordsLoaded] = await Promise.all([
          hydrateAccountsFromBackend(),
          hydrateRecordsFromBackend()
        ]);
        if (!accountsLoaded || !recordsLoaded) {
          dataState.accounts = [];
          dataState.records = [];
          dataState.backendRecordsLoaded = false;
        }
      }
      await refreshBackendOverviewAfterWrite();
      resetBookForm();
      const backendDup = Array.isArray(saved.warnings) && saved.warnings.some(w => w.code === "duplicate_book_name");
      showBookMsg(backendDup ? "已添加到账本服务端（注意：已有同名账本，请留意区分）" : "已添加到账本服务端", backendDup);
      renderBookSelect();
      renderBookList();
      render();
      return;
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showBookMsg(error.message || "服务端拒绝创建账本", true);
        return;
      }
      restoreLocalStateFromStorage();
      backendFallback = true;
    } finally {
      setBookSaveBusy(false);
    }
  }

  if (wasEdit) {
    const b = dataState.books.find(x => String(x.id) === String(uiState.editingBookId));
    b.name = name;
    b.category = category;
  } else {
    dataState.books.push({ id: nextId(dataState.books), name: name, category: category });
  }
  saveBooks();
  resetBookForm();
  // 先重置再提示，否则 resetBookForm 会把提示清掉
  if (wasEdit) {
    showBookMsg(dup ? "已保存修改（注意：还有同名账本，请留意区分）" : "已保存修改", dup);
  } else if (backendFallback) {
    showBookMsg(dup ? "服务端不可用，已保存到本地（另有同名账本）" : "服务端不可用，已保存到本地", true);
  } else {
    showBookMsg(dup ? "已添加账本（注意：已有同名账本，请留意区分）" : "已添加账本", dup);
  }
  renderBookSelect();
  renderBookList();
  renderOverview();
}

function startEditBook(id) {
  const b = dataState.books.find(x => String(x.id) === String(id));
  if (!b) return;
  uiState.editingBookId = id;
  document.getElementById("bookName").value = b.name;
  document.getElementById("bookCategory").value = b.category;
  document.getElementById("bookSaveBtn").textContent = "保存修改";
  document.getElementById("bookCancelBtn").style.display = "block";
  document.getElementById("bookMsg").textContent = "";
}

async function deleteBook(id) {
  if (uiState.bookSaveInFlight) {
    showBookMsg("正在保存，请稍候", true);
    return;
  }
  if (uiState.bookDeleteInFlight) {
    showBookMsg("正在删除，请稍候", true);
    return;
  }
  const b = dataState.books.find(x => String(x.id) === String(id));
  if (!b) return;
  if (dataState.books.length <= 1) { showBookMsg("至少要保留一个账本"); return; }
  if (!confirm("确定删除账本「" + b.name + "」吗？\n这个账本下的所有账目和账户都会被清空。")) return;
  const fingerprint = bookFingerprint(b);
  if (backendWritesEnabled() && typeof b.id === "string") {
    setBookDeleteBusy(true);
    try {
      await backendApi.deleteBook(b.id);
      dataState.books = dataState.books.filter(x => String(x.id) !== String(id));
      let detailsRefreshed = true;
      if (String(dataState.currentBookId) === String(id) && dataState.books.length > 0) {
        dataState.currentBookId = dataState.books[0].id;
        appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
        const results = await Promise.all([hydrateAccountsFromBackend(), hydrateRecordsFromBackend()]);
        detailsRefreshed = results.every(Boolean);
        if (!detailsRefreshed) {
          dataState.accounts = [];
          dataState.records = [];
          dataState.backendRecordsLoaded = false;
        }
      }
      await refreshBackendOverviewAfterWrite();
      resetBookForm();
      showBookMsg(detailsRefreshed ? "已删除账本（已同步服务端）" : "已删除账本（服务端已删除，明细刷新稍后重试）");
      renderBookSelect();
      renderBookList();
      render();
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        showBookMsg(error.message || "服务端拒绝删除账本", true);
      } else {
        restoreLocalStateFromStorage();
        const localBook = findLocalBookByFingerprint(fingerprint);
        if (!localBook || dataState.books.length <= 1) {
          showBookMsg("服务端不可用，本地无法安全删除这本账", true);
        } else {
          applyLocalBookDelete(localBook.id);
          resetBookForm();
          showBookMsg("服务端不可用，已在本地删除账本", true);
          renderBookSelect();
          renderBookList();
          render();
        }
      }
    } finally {
      setBookDeleteBusy(false);
    }
    return;
  }

  applyLocalBookDelete(id);
  resetBookForm();
  renderBookSelect();
  renderBookList();
  render();
}

// 打开 / 关闭账本管理面板（打开时盖住四个主要面板）
function toggleBookPanel(show) {
  document.getElementById("panelBook").style.display = show ? "block" : "none";
  document.getElementById("panelRecord").style.display = show ? "none" : (uiState.activeTab === "record" ? "block" : "none");
  document.getElementById("panelAccount").style.display = show ? "none" : (uiState.activeTab === "account" ? "block" : "none");
  document.getElementById("panelDetail").style.display = show ? "none" : (uiState.activeTab === "detail" ? "block" : "none");
  document.getElementById("panelOverview").style.display = show ? "none" : (uiState.activeTab === "overview" ? "block" : "none");
  if (show) {
    document.querySelectorAll(".tab").forEach(b => b.classList.remove("active"));
    renderBookList();
  }
}
