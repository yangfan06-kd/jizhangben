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

function handleBookSave() {
  const name = document.getElementById("bookName").value.trim();
  const category = document.getElementById("bookCategory").value.trim() || "未分类";
  if (!name) { showBookMsg("请填写账本名称"); return; }
  // 重名提醒（不禁止）：同名账本在顶部下拉里会分不清
  const dup = dataState.books.find(x => x.name === name && String(x.id) !== String(uiState.editingBookId));
  const wasEdit = uiState.editingBookId !== null;
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

function deleteBook(id) {
  const b = dataState.books.find(x => String(x.id) === String(id));
  if (!b) return;
  if (dataState.books.length <= 1) { showBookMsg("至少要保留一个账本"); return; }
  if (!confirm("确定删除账本「" + b.name + "」吗？\n这个账本下的所有账目和账户都会被清空。")) return;
  dataState.books = dataState.books.filter(x => String(x.id) !== String(id));
  appStorage.remove(recordsKey(id));
  appStorage.remove(accountsKey(id));
  saveBooks();
  // 如果删的是当前账本，自动切到第一个
  if (String(dataState.currentBookId) === String(id)) {
    dataState.currentBookId = dataState.books[0].id;
    appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(dataState.currentBookId));
    load();
    loadAccounts();
    resetForm();
    resetAccountForm();
    resetFilterState();
    document.getElementById("fromDate").value = "";
    document.getElementById("toDate").value = "";
    document.getElementById("filterAccountSel").value = "";
    document.getElementById("filterCategorySel").value = "";
    document.getElementById("searchInput").value = "";
  }
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
  window.scrollTo({ top: 0, behavior: "smooth" });
}
