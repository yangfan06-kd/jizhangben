// 外部账本导入：先支持通用 CSV，保留来源和原始行号，方便后续适配女生记账、随手记。
// 外部文件只在本机解析，不上传到服务端；写入前先预览，默认新建一个账本。

const EXTERNAL_IMPORT_ALIASES = {
  date: ["日期", "记账日期", "交易日期", "发生日期", "时间", "交易时间", "记账时间", "date", "time"],
  type: ["类型", "收支", "收入/支出", "收支类型", "交易类型", "方向", "类别类型", "type", "transactiontype"],
  category: ["分类", "类别", "一级分类", "二级分类", "收支分类", "category"],
  amount: ["金额", "金额元", "收支金额", "交易金额", "数额", "amount", "money"],
  income: ["收入", "收入金额", "收入元", "income"],
  expense: ["支出", "支出金额", "支出元", "expense", "outcome"],
  account: ["账户", "账户名称", "支付账户", "资金账户", "付款账户", "account"],
  toAccount: ["转入账户", "目标账户", "对方账户", "收款账户", "toaccount", "destinationaccount"],
  note: ["备注", "说明", "摘要", "商家", "商品", "用途", "note", "remark", "description"]
};

let externalImportState = {
  source: "其他 CSV",
  fileName: "",
  rows: [],
  issues: [],
  columns: null,
  autoBookName: "",
  bookBalances: {}
};

function normalizeImportHeader(value) {
  return String(value == null ? "" : value)
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[\s_（）()【】\[\]：:，,./\\-]/g, "");
}

function detectCsvDelimiter(text) {
  const firstLine = String(text || "").split(/\r?\n/, 1)[0] || "";
  const candidates = [",", "\t", ";"];
  return candidates.sort((a, b) => {
    const count = value => value === "\t"
      ? (firstLine.match(/\t/g) || []).length
      : (firstLine.match(new RegExp("\\" + value, "g")) || []).length;
    return count(b) - count(a);
  })[0];
}

// 兼容逗号、制表符和分号分隔；引号中的换行、分隔符和双引号都会保留。
function parseExternalCsv(text, delimiter = detectCsvDelimiter(text)) {
  const input = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  const rows = [];
  const rowNumbers = [];
  let row = [];
  let cell = "";
  let quoted = false;
  let lineNumber = 1;
  let rowStartLine = 1;

  const pushCell = () => {
    row.push(cell);
    cell = "";
  };
  const pushRow = () => {
    pushCell();
    if (row.some(value => String(value).trim() !== "")) {
      rows.push(row);
      rowNumbers.push(rowStartLine);
    }
    row = [];
  };

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
        if (ch === "\r") {
          if (input[i + 1] === "\n") {
            cell += "\n";
            i += 1;
          }
          lineNumber += 1;
        } else if (ch === "\n") {
          lineNumber += 1;
        }
      }
    } else if (ch === '"' && cell === "") {
      quoted = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === "\n") {
      pushRow();
      lineNumber += 1;
      rowStartLine = lineNumber;
    } else if (ch === "\r") {
      if (input[i + 1] === "\n") i += 1;
      pushRow();
      lineNumber += 1;
      rowStartLine = lineNumber;
    } else {
      cell += ch;
    }
  }
  if (quoted) throw new Error("csv_unclosed_quote");
  if (cell !== "" || row.length > 0) pushRow();
  if (rows.length < 2) throw new Error("csv_no_data");

  const rawHeaders = rows[0];
  const headers = rawHeaders.map((value, index) => {
    const label = String(value == null ? "" : value).trim();
    return label || ("第" + (index + 1) + "列");
  });
  const data = rows.slice(1).map((values, index) => ({
    values: headers.map((_, columnIndex) => String(values[columnIndex] == null ? "" : values[columnIndex]).trim()),
    sourceRow: rowNumbers[index + 1]
  })).filter(item => item.values.some(value => value !== ""));
  return { delimiter, headers, rows: data.map(item => item.values), rowNumbers: data.map(item => item.sourceRow) };
}

function externalColumnIndex(headers, field) {
  const normalized = headers.map(normalizeImportHeader);
  const aliases = (EXTERNAL_IMPORT_ALIASES[field] || []).map(normalizeImportHeader);
  let index = normalized.findIndex(value => aliases.includes(value));
  if (index >= 0) return index;
  return normalized.findIndex(value => aliases.some(alias => {
    if (alias.length < 2 || !value.includes(alias)) return false;
    if (field === "income" && value.includes("支出")) return false;
    if (field === "expense" && value.includes("收入")) return false;
    return true;
  }));
}

function mapExternalColumns(headers) {
  const columns = {};
  Object.keys(EXTERNAL_IMPORT_ALIASES).forEach(field => {
    columns[field] = externalColumnIndex(headers, field);
  });
  return columns;
}

function externalCell(values, index) {
  return index >= 0 && index < values.length ? String(values[index] == null ? "" : values[index]).trim() : "";
}

function groupExternalImportRows(rows) {
  const groups = new Map();
  (Array.isArray(rows) ? rows : []).forEach(row => {
    const name = String(row.bookName || "").trim();
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  });
  return groups;
}

function normalizeExternalDate(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const match = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/.exec(raw);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return year + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}

function parseExternalAmount(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return null;
  const parentheses = /^\(.*\)$/.test(raw);
  const cleaned = raw.replace(/[¥￥$€£,，\s]/g, "").replace(/^\+/, "");
  const number = Number(cleaned);
  if (!Number.isFinite(number)) return null;
  return parentheses ? -Math.abs(number) : number;
}

function normalizeExternalType(rawType, incomeValue, expenseValue) {
  const type = String(rawType == null ? "" : rawType).trim().toLowerCase();
  if (type.includes("支出") || type.includes("消费") || type.includes("付款") || type.includes("花费") || type === "支") return "支出";
  if (type.includes("收入") || type.includes("工资") || type.includes("收款") || type.includes("入账") || type === "收") return "收入";
  if (type.includes("转账") || type.includes("转入") || type.includes("转出")) return "转账";
  const income = parseExternalAmount(incomeValue);
  const expense = parseExternalAmount(expenseValue);
  if (income !== null && income !== 0 && (expense === null || expense === 0)) return "收入";
  if (expense !== null && expense !== 0 && (income === null || income === 0)) return "支出";
  return null;
}

function normalizeExternalRows(parsed) {
  if (!parsed || !Array.isArray(parsed.headers) || !Array.isArray(parsed.rows)) throw new Error("csv_no_data");
  const columns = mapExternalColumns(parsed.headers);
  if (columns.date < 0 || (columns.amount < 0 && columns.income < 0 && columns.expense < 0)) {
    throw new Error("csv_columns_missing");
  }

  const rows = [];
  const issues = [];
  const bookBalances = {};
  let activeBookName = "";
  parsed.rows.forEach((values, index) => {
    const sourceRow = Array.isArray(parsed.rowNumbers) ? parsed.rowNumbers[index] : index + 2;
    const dateCell = externalCell(values, columns.date);
    const bookTitle = /^账本\s*[：:]\s*(.*)$/.exec(dateCell);
    if (bookTitle) {
      activeBookName = bookTitle[1].trim();
      return;
    }
    if (dateCell === "余额") {
      const balance = parseExternalAmount(externalCell(values, columns.amount) || externalCell(values, columns.type));
      if (balance !== null && activeBookName) bookBalances[activeBookName] = toCents(Math.abs(balance));
      return;
    }
    const date = normalizeExternalDate(externalCell(values, columns.date));
    if (!date) {
      issues.push({ row: sourceRow, message: "日期无法识别" });
      return;
    }
    const incomeValue = externalCell(values, columns.income);
    const expenseValue = externalCell(values, columns.expense);
    const rawAmount = externalCell(values, columns.amount) || incomeValue || expenseValue;
    const parsedAmount = parseExternalAmount(rawAmount);
    const type = normalizeExternalType(externalCell(values, columns.type), incomeValue, expenseValue) || (parsedAmount !== null && parsedAmount < 0 ? "支出" : null);
    if (!type) {
      issues.push({ row: sourceRow, message: "收支类型无法识别" });
      return;
    }
    let amount = parsedAmount;
    if (columns.income >= 0 || columns.expense >= 0) {
      const income = parseExternalAmount(incomeValue);
      const expense = parseExternalAmount(expenseValue);
      amount = type === "收入" ? income : type === "支出" ? expense : amount;
    }
    if (amount === null || !Number.isFinite(amount)) {
      issues.push({ row: sourceRow, message: "金额无法识别" });
      return;
    }
    const category = externalCell(values, columns.category) || "其他";
    const account = externalCell(values, columns.account);
    const toAccount = externalCell(values, columns.toAccount);
    if (type === "转账" && (!account || !toAccount)) {
      issues.push({ row: sourceRow, message: "转账缺少转出账户或转入账户，暂不导入" });
      return;
    }
    rows.push({
      sourceRow,
      date,
      type,
      amountCents: Math.abs(toCents(Math.abs(amount))),
      category,
      account,
      toAccount,
      note: externalCell(values, columns.note),
      bookName: activeBookName
    });
  });
  return { columns, rows, issues, bookBalances };
}

function externalImportBookName(source, fileName, text = "") {
  if (source === "女生记账") {
    const titles = [...String(text || "").matchAll(/(?:^|\r?\n)\s*账本\s*[：:]\s*([^,，\r\n]+)/g)]
      .map(match => match[1].trim()).filter(Boolean);
    if (titles.length > 1) return `${source}导入`;
    if (titles.length === 1) return `${source}导入-${titles[0]}`.slice(0, 40);
  }
  const base = String(fileName || "").replace(/\.[^.]+$/, "").trim().slice(0, 28) || "账本";
  return source === "其他 CSV" ? "导入-" + base : source + "导入-" + base;
}

function readExternalImportText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const bytes = new Uint8Array(event.target.result);
        let text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        if (text.includes("�") && typeof TextDecoder !== "undefined") text = new TextDecoder("gb18030").decode(bytes);
        resolve(text);
      } catch (error) { reject(error); }
    };
    reader.onerror = () => reject(new Error("file_read_failed"));
    reader.readAsArrayBuffer(file);
  });
}

function renderExternalImportPreview() {
  const panel = document.getElementById("externalImportPanel");
  const summary = document.getElementById("externalImportSummary");
  const issuesBox = document.getElementById("externalImportIssues");
  const confirm = document.getElementById("externalImportConfirmBtn");
  if (!panel || !summary || !issuesBox || !confirm) return;
  const total = externalImportState.rows.length + externalImportState.issues.length;
  const categories = [...new Set(externalImportState.rows.map(row => row.category))];
  const accounts = [...new Set(externalImportState.rows.flatMap(row => [row.account, row.toAccount]).filter(Boolean))];
  const accountNote = accounts.length ? `识别到 ${accounts.length} 个账户。` : "源文件没有账户信息，导入后会统一记入“未注明账户”，避免误认为是现金。";
  const groups = groupExternalImportRows(externalImportState.rows);
  const balances = externalImportState.bookBalances || {};
  const ledgerSummary = groups.size > 1
    ? `<div class="external-import-meta">检测到 ${groups.size} 个来源账本，导入时会分别保留：</div><ul class="external-import-ledgers">${[...groups.entries()].map(([name, rows]) => {
      const incomeCents = rows.filter(row => row.type === "收入").reduce((sum, row) => sum + row.amountCents, 0);
      const expenseCents = rows.filter(row => row.type === "支出").reduce((sum, row) => sum + row.amountCents, 0);
      const balanceCents = balances[name];
      const balanceNote = Number.isFinite(balanceCents) ? ` · 期末余额${balanceCents === incomeCents - expenseCents ? "核对相符" : "与收支差额不同"}` : "";
      return `<li>${esc(name || "未命名账本")}：${rows.length} 笔，收入 ${formatPreviewMoney(incomeCents)}，支出 ${formatPreviewMoney(expenseCents)}${balanceNote}</li>`;
    }).join("")}</ul>`
    : "";
  summary.innerHTML = `
    <div class="external-import-counts">文件：${esc(externalImportState.fileName)} · 共 ${total} 行，可导入 ${externalImportState.rows.length} 行</div>
    <div class="external-import-meta">识别到 ${categories.length} 个类别。${accountNote}导入后会新建账本，不覆盖现有账目。</div>
    ${ledgerSummary}
  `;
  if (externalImportState.issues.length) {
    issuesBox.innerHTML = `<div class="external-import-issue-title">需要确认的行（${externalImportState.issues.length} 条将跳过）</div>` +
      externalImportState.issues.slice(0, 8).map(issue => `<div class="external-import-issue">第 ${issue.row} 行：${esc(issue.message)}</div>`).join("") +
      (externalImportState.issues.length > 8 ? `<div class="external-import-issue">还有 ${externalImportState.issues.length - 8} 条问题未展开</div>` : "");
  } else {
    issuesBox.innerHTML = `<div class="external-import-ok">没有发现需要跳过的行。</div>`;
  }
  confirm.disabled = externalImportState.rows.length === 0;
  panel.hidden = false;
}

function clearExternalImportPreview() {
  externalImportState = { source: "其他 CSV", fileName: "", rows: [], issues: [], columns: null, autoBookName: "", bookBalances: {} };
  const panel = document.getElementById("externalImportPanel");
  const summary = document.getElementById("externalImportSummary");
  const issues = document.getElementById("externalImportIssues");
  const confirm = document.getElementById("externalImportConfirmBtn");
  if (panel) panel.hidden = true;
  if (summary) summary.innerHTML = "";
  if (issues) issues.innerHTML = "";
  if (confirm) confirm.disabled = true;
}

async function previewExternalImportFile(file) {
  clearExternalImportPreview();
  if (!file) return;
  if (!/\.csv$/i.test(file.name || "")) {
    showBackupMsg("本批先支持 CSV 文件；Excel 文件适配会根据真实导出样本补充。", true);
    return;
  }
  try {
    const text = await readExternalImportText(file);
    const parsed = parseExternalCsv(text);
    const converted = normalizeExternalRows(parsed);
    const source = document.getElementById("externalImportSource")?.value || "其他 CSV";
    externalImportState.fileName = file.name;
    externalImportState.rows = converted.rows;
    externalImportState.issues = converted.issues;
    externalImportState.columns = converted.columns;
    externalImportState.bookBalances = converted.bookBalances;
    externalImportState.autoBookName = externalImportBookName(source, file.name, text);
    const bookName = document.getElementById("externalImportBookName");
    if (bookName && !bookName.value.trim()) bookName.value = externalImportState.autoBookName;
    renderExternalImportPreview();
    showBackupMsg("已完成导入预览，请核对后再写入新账本。");
  } catch (error) {
    const message = error && error.message === "csv_columns_missing"
      ? "找不到日期或金额列，请先导出包含日期和金额的完整表格。"
      : error && error.message === "csv_no_data"
        ? "CSV 文件没有可读取的表头和账目。"
        : "CSV 文件读取失败，请确认文件没有损坏。";
    showBackupMsg(message, true);
  }
}

function importedAccountDefinition(name, accounts) {
  const clean = String(name || "未注明账户").trim() || "未注明账户";
  const existing = accounts.find(account => account.name === clean);
  if (existing) return existing;
  const known = DEFAULT_ACCOUNTS.find(account => account.name === clean);
  const created = {
    id: nextId(accounts),
    name: clean,
    kind: known ? known.kind : "资金",
    initial: 0,
    initialCents: 0
  };
  accounts.push(created);
  return created;
}

async function commitExternalImport() {
  if (!externalImportState.rows.length) return;
  const source = document.getElementById("externalImportSource")?.value || "其他 CSV";
  const bookNameInput = document.getElementById("externalImportBookName");
  const requestedName = bookNameInput?.value.trim() || externalImportBookName(source, externalImportState.fileName);
  const issues = externalImportState.issues.length;
  const groups = groupExternalImportRows(externalImportState.rows);
  const bookNames = [...groups.keys()].map(name => name
    ? (groups.size > 1 ? `${requestedName}-${name}` : requestedName).slice(0, 40)
    : requestedName.slice(0, 40));
  const destination = bookNames.length === 1 ? `新账本“${bookNames[0]}”` : `分别新建 ${bookNames.length} 个账本（${bookNames.join("、")}）`;
  if (issues && !(await appConfirm(`有 ${issues} 行数据无法导入，确认后会跳过；其余 ${externalImportState.rows.length} 行将${destination}，不会覆盖现有账目。确定继续吗？`))) return;
  if (!issues && !(await appConfirm(`将 ${externalImportState.rows.length} 行导入${destination}，不会覆盖现有账目。确定继续吗？`))) return;

  const allRecords = [];
  let firstBookId = null;
  const missingAccountName = externalImportState.columns?.account < 0 ? "未注明账户" : "现金";
  [...groups.entries()].forEach(([sourceBookName, rows], groupIndex) => {
    const accounts = [];
    const accountFor = name => importedAccountDefinition(name || missingAccountName, accounts);
    const records = [];
    rows.forEach(row => {
      const account = accountFor(row.account || missingAccountName);
      const record = {
        id: nextId(records),
        type: row.type,
        amount: row.amountCents / 100,
        amountCents: row.amountCents,
        category: row.category || "其他",
        account: account.id,
        date: row.date,
        note: row.note || "",
        importSource: source,
        importSourceFile: externalImportState.fileName,
        importSourceRow: row.sourceRow
      };
      if (row.type === "转账") {
        record.toAccount = accountFor(row.toAccount).id;
        record.transferMode = "账户间转账";
      }
      records.push(record);
    });
    const requestedBookName = bookNames[groupIndex] || requestedName.slice(0, 40);
    const book = { id: nextId(dataState.books), name: requestedBookName, category: "导入账本" };
    if (firstBookId == null) firstBookId = book.id;
    dataState.books.push(book);
    appStorage.set(recordsKey(book.id), JSON.stringify(normalizeRecords(records)));
    appStorage.set(accountsKey(book.id), JSON.stringify(normalizeAccounts(accounts)));
    allRecords.push(...records);
  });
  saveBooks();
  const existingCategories = allCategories();
  const newCategories = [...new Set(allRecords.map(record => record.category))].filter(category => !existingCategories.includes(category));
  if (newCategories.length) {
    dataState.customCategories = dataState.customCategories.concat(newCategories);
    dataState.customCategories = [...new Set(dataState.customCategories)];
    saveCustomCategories();
  }
  dataState.currentBookId = firstBookId;
  appStorage.set(CURRENT_BOOK_KEY, JSON.stringify(firstBookId));
  load();
  loadAccounts();
  loadBudgetData();
  resetForm();
  resetAccountForm();
  resetFilterState();
  renderBookSelect();
  renderBookList();
  renderAccountSelects();
  fillCategoryFilter();
  render();
  clearExternalImportPreview();
  showBackupMsg(`已导入 ${allRecords.length} 行，并新建 ${groups.size} 个独立账本。`);
}
