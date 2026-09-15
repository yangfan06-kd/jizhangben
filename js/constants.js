// 应用配置与内置选项：集中保存不会随一次操作改变的值。
// 运行时状态由 state.js 和入口脚本分阶段维护。

const STORAGE_KEY = "jizhangben_records";
const ACCOUNTS_KEY = "jizhangben_accounts";
const TYPES = ["支出", "收入", "转账", "余额", "借贷", "代付", "报销", "退款", "押金"];
const CATEGORIES = ["餐饮", "交通", "购物", "娱乐", "居住", "医疗", "教育", "其他"];
const CUSTOM_TYPES_KEY = "jizhangben_custom_types";
const CUSTOM_CATEGORIES_KEY = "jizhangben_custom_categories";
const BOOKS_KEY = "jizhangben_books";
const CURRENT_BOOK_KEY = "jizhangben_current_book";
const STORAGE_SCHEMA_KEY = "jizhangben_schema_version";
const STORAGE_SCHEMA_VERSION = 2;
const DATA_VERSION = 2;

// 每个账本的账目 / 账户单独存一把钥匙，保证各账本互不干扰。
function recordsKey(id) {
  return "jizhangben_records_" + id;
}

function accountsKey(id) {
  return "jizhangben_accounts_" + id;
}

// 这些类型会影响账户余额（需要选账户）。
const FLOW_TYPES = ["支出", "收入", "转账", "代付", "报销", "退款", "押金"];

// 押金的 4 个方向：side 表示收支口径，flow 表示资金进出。
const DEPOSIT_DIRS = [
  { key: "收", label: "主动收", side: "neutral", flow: "in" },
  { key: "退", label: "我退给别人", side: "neutral", flow: "out" },
  { key: "付", label: "主动付给别人", side: "neutral", flow: "out" },
  { key: "退回", label: "别人退回", side: "neutral", flow: "in" }
];

// 统计图配色：普通图表与综合图分别使用不同颜色组。
const CHART_COLORS = ["#C03A3A", "#147D5A", "#3A6EA5", "#E0A63A", "#8A5CC0", "#2FA3A3", "#D15A8A", "#6B7280"];
const INCOME_COLORS = ["#C03A3A", "#D96C5A", "#E08A6E", "#E8A88A", "#A83333", "#8A2A2A"];
const EXPENSE_COLORS = ["#147D5A", "#3FA37E", "#6BC4A3", "#2E8B6E", "#1E6B4E", "#0E4D38"];

const COLLAPSE_COUNT = 5;

const DEFAULT_ACCOUNTS = [
  { id: 1, name: "现金", kind: "资金", initial: 0 },
  { id: 2, name: "银行卡", kind: "资金", initial: 0 },
  { id: 3, name: "支付宝", kind: "资金", initial: 0 },
  { id: 4, name: "微信", kind: "资金", initial: 0 },
  { id: 5, name: "信用卡", kind: "负债", initial: 0 },
  { id: 6, name: "花呗", kind: "负债", initial: 0 },
  { id: 7, name: "京东白条", kind: "负债", initial: 0 }
];
