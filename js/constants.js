// 应用配置与内置选项：集中保存不会随一次操作改变的值。
// 运行时状态由 state.js 和入口脚本分阶段维护。

const STORAGE_KEY = "jizhangben_records";
const ACCOUNTS_KEY = "jizhangben_accounts";
const TYPES = ["支出", "收入", "转账", "余额", "借贷", "代付", "报销", "退款", "押金"];
const CATEGORIES = ["餐饮", "交通", "购物", "娱乐", "居住", "医疗", "教育", "其他"];
// 旧版内置类别模板仅用于迁移识别与图标兼容；新账目类别由用户分别创建。
const CATEGORY_GROUPS = [
  { key: "food", name: "食品酒水", icon: "dining", color: "#E57C58", background: "#FFF0EA", items: ["餐饮", "买菜", "早餐", "午餐", "晚餐", "水果", "零食", "饮料"] },
  { key: "fun", name: "休闲娱乐", icon: "entertainment", color: "#9A6AD6", background: "#F3EDFC", items: ["娱乐", "游戏", "电影", "聚会", "旅游", "运动"] },
  { key: "study", name: "学习进修", icon: "education", color: "#4D91C7", background: "#EAF4FB", items: ["教育", "学习", "书籍", "课程", "考试", "培训"] },
  { key: "transport", name: "交通通讯", icon: "transport", color: "#3C9A94", background: "#E8F7F5", items: ["交通", "公交", "地铁", "打车", "火车", "飞机", "通讯"] },
  { key: "clothing", name: "衣服服饰", icon: "shopping", color: "#D56B94", background: "#FCECF3", items: ["购物", "衣服", "鞋包", "美容", "配饰", "理发"] },
  { key: "love", name: "恋爱基金", icon: "love", color: "#E46B7E", background: "#FDECEF", items: ["恋爱", "约会", "礼物", "纪念日", "红包"] },
  { key: "medical", name: "医疗保险", icon: "health", color: "#D36D65", background: "#FCEDEB", items: ["医疗", "看病", "药品", "保险", "体检"] },
  { key: "dorm", name: "宿舍公摊", icon: "dorm", color: "#C18A45", background: "#FCF4E7", items: ["居住", "房租", "水电", "宿舍", "公摊", "物业"] },
  { key: "other", name: "其他杂项", icon: "other", color: "#6E8790", background: "#EEF3F4", items: ["其他", "日用", "宠物", "人情", "家居", "杂项"] }
];
const CUSTOM_TYPES_KEY = "jizhangben_custom_types";
const CUSTOM_CATEGORIES_KEY = "jizhangben_custom_categories";
const CUSTOM_CATEGORY_ICONS_KEY = "jizhangben_custom_category_icons";
const CATEGORY_SYSTEM_KEY = "jizhangben_category_system";
// 手机离线写入的保护标记，不属于用户备份内容。
const PENDING_SYNC_KEY = "jizhangben_pending_sync";
// 最近一次服务端快照所属账号，仅用于切换账号时的本机缓存保护。
const LOCAL_SNAPSHOT_OWNER_KEY = "jizhangben_snapshot_owner";
const BOOKS_KEY = "jizhangben_books";
const CURRENT_BOOK_KEY = "jizhangben_current_book";
const BUDGETS_KEY_PREFIX = "jizhangben_budgets_";
const INVESTMENT_PLANS_KEY_PREFIX = "jizhangben_investment_plans_";
const FUND_PROJECTS_KEY_PREFIX = "jizhangben_fund_projects_";
const FIXED_INCOME_KEY_PREFIX = "jizhangben_fixed_income_";
const STORAGE_SCHEMA_KEY = "jizhangben_schema_version";
const STORAGE_SCHEMA_VERSION = 2;
const DATA_VERSION = 3;

// 每个账本的账目 / 账户单独存一把钥匙，保证各账本互不干扰。
function recordsKey(id) {
  return "jizhangben_records_" + id;
}

function accountsKey(id) {
  return "jizhangben_accounts_" + id;
}

function budgetKey(id) {
  return BUDGETS_KEY_PREFIX + id;
}

function investmentPlansKey(id) {
  return INVESTMENT_PLANS_KEY_PREFIX + id;
}

function fundProjectsKey(id) {
  return FUND_PROJECTS_KEY_PREFIX + id;
}

function fixedIncomeKey(id) {
  return FIXED_INCOME_KEY_PREFIX + id;
}

// 这些类型会影响账户余额（需要选账户）。
const FLOW_TYPES = ["支出", "收入", "转账", "余额", "借贷", "代付", "报销", "退款", "押金"];

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
// 扇形图按类别区分颜色；收支方向仍由中文标签和期间合计表达。
const REPORT_PIE_COLORS = [
  "#3D947D", "#D29558", "#6987C0", "#B87596", "#91A554",
  "#9378B9", "#55A2AE", "#C66D64", "#BCA454", "#607793",
  "#86B69A", "#A87849", "#9CB5DB", "#985C7B", "#B4C17E",
  "#B9A5D3", "#347C89", "#DDA08B", "#897C45", "#939E9D"
];

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
