// 运行时状态：按职责集中管理，数据边界会逐步迁移到这里。
// 状态对象只保存数据，不直接操作 DOM；页面模块通过它读写筛选、界面和业务数据。

function stateCurrentMonth() {
  const date = new Date();
  return date.getFullYear() + "-" + String(date.getMonth() + 1).padStart(2, "0");
}

const filterState = {
  fromDate: "",
  toDate: "",
  account: "",
  category: "",
  searchKey: "",
  periodMode: "period",
  month: stateCurrentMonth(),
  year: String(new Date().getFullYear())
};

// 报表时期独立于流水筛选；只保存在内存中，不迁移或写入账本数据。
const reportState = {
  periodMode: "month",
  month: stateCurrentMonth(),
  year: String(new Date().getFullYear()),
  fromDate: stateCurrentMonth() + "-01",
  toDate: stateCurrentMonth() + "-" + String(new Date().getDate()).padStart(2, "0")
};

const uiState = {
  activeTab: "home",
  editingRecordId: null,
  editingAccountId: null,
  editingBookId: null,
  selectedType: null,
  selectedCategory: null,
  selectedDepositDir: null,
  selectedLoanMode: null,
  selectedPayMode: null,
  selectedTransferMode: null,
  balanceTargetAccountId: null,
  balanceTargetRecordId: null,
  chartType: "bar",
  chartKind: "expense",
  chartExpanded: false,
  detailExpanded: false,
  detailVisibleCount: 100,
  // 流水浏览状态只留在内存，不能写入用户的账本或设置。
  detailBrowsePosition: null,
  detailPeriod: "month",
  detailFiltersExpanded: false,
  typesExpanded: false,
  categoriesExpanded: false,
  customTypeSideDraft: "neutral",
  startupNotice: "",
  recordSaveInFlight: false,
  recordDeleteInFlight: false,
  recordSaveStatus: "idle",
  bookSaveInFlight: false,
  bookDeleteInFlight: false,
  accountSaveInFlight: false,
  accountDeleteInFlight: false
};

const dataState = {
  currentBookId: null,
  authUser: null,
  authStatus: "guest",
  authHydrated: false,
  offlineMode: false,
  books: [],
  records: [],
  accounts: [],
  customTypes: [],
  customCategories: [],
  customCategoryIcons: {},
  categorySystem: null,
  // 后端选项的名称到 UUID 映射，记录写入时使用；页面仍继续用名称显示。
  backendCategoryIds: {},
  backendTypeIds: {},
  // 后端读取成功后置为 true；写入能力按资源逐步开启，避免半迁移状态覆盖数据。
  backendBooksLoaded: false,
  backendOptionsLoaded: false,
  backendRecordsLoaded: false,
  backendOverview: null,
  budgetData: null,
  investmentPlans: [],
  fundProjects: [],
  fixedIncomePlan: null
};

function resetFilterState() {
  uiState.detailVisibleCount = 100;
  uiState.detailBrowsePosition = null;
  filterState.fromDate = "";
  filterState.toDate = "";
  filterState.account = "";
  filterState.category = "";
  filterState.searchKey = "";
  filterState.periodMode = "period";
  filterState.month = stateCurrentMonth();
  filterState.year = String(new Date().getFullYear());
}
