// 通用工具模块：金额、日期、旧数据兼容、ID 和类型口径判断。
// 这些函数不负责页面渲染，供存储、计算、表单和视图模块复用。

// 金额统一按“分”计算，避免 JavaScript 小数累加产生精度误差。
// amountCents 是新增字段；没有它的旧数据仍然可以正常读取。
function toCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function amountOf(r) {
  if (r && Number.isFinite(Number(r.amountCents))) return Number(r.amountCents) / 100;
  return toCents(r && r.amount) / 100;
}

function normalizeRecord(r) {
  if (!r || typeof r !== "object") return null;
  const cents = toCents(r.amountCents != null ? Number(r.amountCents) / 100 : r.amount);
  return Object.assign({}, r, { amount: cents / 100, amountCents: cents });
}

function normalizeRecords(list) {
  return Array.isArray(list) ? list.map(normalizeRecord).filter(Boolean) : [];
}

function initialOf(a) {
  if (a && Number.isFinite(Number(a.initialCents))) return Number(a.initialCents) / 100;
  return toCents(a && a.initial) / 100;
}

function normalizeAccount(a) {
  if (!a || typeof a !== "object") return null;
  const cents = toCents(a.initialCents != null ? Number(a.initialCents) / 100 : a.initial);
  return Object.assign({}, a, { initial: cents / 100, initialCents: cents });
}

function normalizeAccounts(list) {
  return Array.isArray(list) ? list.map(normalizeAccount).filter(Boolean) : [];
}

function nextId(items) {
  let id = Date.now();
  while (items.some(item => String(item.id) === String(id))) id += 1;
  return id;
}

// 记账类型沿用内置加自定义；类别由用户分收支建立并保存。
function allTypes() {
  return TYPES.concat(dataState.customTypes.map(t => (typeof t === "string" ? t : t.name)));
}

function allCategories(side = "") {
  const groups = dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
  return groups.filter(group => !side || group.side === side)
    .flatMap(group => Array.isArray(group.items) ? group.items : [])
    .filter((name, index, list) => list.indexOf(name) === index);
}

// 查一个自定义类型的信息（兼容旧的纯字符串）
function customTypeInfo(name) {
  const t = dataState.customTypes.find(x => (typeof x === "string" ? x : x.name) === name);
  if (!t) return null;
  return (typeof t === "string") ? { name: t, side: "neutral" } : t;
}

// 一个类型名属于收入侧 / 支出侧 / 中性
function typeSide(name) {
  if (name === "收入") return "income";
  if (name === "支出") return "expense";
  const ct = customTypeInfo(name);
  return ct ? ct.side : "neutral";
}

// 这个类型要不要选账户（影响余额的都要）
function needsAccount(type) {
  if (type === "代付" && typeof uiState !== "undefined" && uiState.selectedPayMode === "转为支出") return false;
  if (FLOW_TYPES.includes(type)) return true;
  const ct = customTypeInfo(type);
  return !!(ct && (ct.side === "income" || ct.side === "expense"));
}

// 今天的日期，格式 YYYY-MM-DD（比如 2026-08-20）
function todayStr() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}

// 判断某笔账是不是“本月”的
function isThisMonth(dateStr) {
  const now = new Date();
  const d = parseLocalDate(dateStr);
  if (!d) return false;
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

// YYYY-MM-DD 必须按本地日期解析，避免 UTC 时区导致月初/月末被算错月份。
function parseLocalDate(dateStr) {
  if (typeof dateStr !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3])) ? d : null;
}

// 把 2026-08-20 显示成 2026年8月20日
function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-");
  return y + "年" + Number(m) + "月" + Number(d) + "日";
}

// 转义特殊字符，防止备注里的 < > 等破坏页面（好习惯）
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

// 把内部错误代码和英文网络异常转换成普通用户能理解的中文。
// 后端已经返回中文业务说明时保留原文，避免丢失具体原因。
function userFacingError(error, fallback = "操作失败，请稍后重试") {
  const rawMessage = error && error.message != null ? String(error.message) : "";
  if (/[㐀-鿿]/.test(rawMessage)) return rawMessage;

  const code = error && error.code ? String(error.code) : rawMessage;
  const messages = {
    backend_disabled: "当前处于离线模式，暂不能进行联网操作",
    backend_request_failed: "服务暂时不可用，请稍后重试",
    invalid_json_response: "服务返回的数据无法读取，请稍后重试",
    authentication_required: "登录状态已失效，请重新登录",
    book_not_found: "当前账本不存在，请重新选择账本",
    account_not_found: "当前账户不存在，请重新选择账户",
    record_not_found: "这笔账已经不存在，请刷新后重试",
    deposit_link_not_found: "找不到对应的原押金，请重新选择",
    backup_invalid: "备份文件格式无效，请重新选择",
    record_response_invalid: "保存结果无法确认，请刷新后检查流水",
    auth_response_invalid: "登录结果无法确认，请稍后重试",
    custom_option_response_invalid: "自定义选项保存结果无法确认，请稍后重试",
    options_response_invalid: "记账选项暂时无法读取，请稍后重试"
  };
  if (messages[code]) return messages[code];
  if (/failed to fetch|networkerror|network request|fetch failed/i.test(rawMessage)) {
    return "网络暂时不可用，请检查连接后重试";
  }
  return fallback;
}
