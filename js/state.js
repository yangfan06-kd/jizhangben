// 运行时状态：按职责集中管理，数据边界会逐步迁移到这里。
// 状态对象只保存数据，不直接操作 DOM；页面模块通过它读写筛选、界面和业务数据。

const filterState = {
  fromDate: "",
  toDate: "",
  account: "",
  category: "",
  searchKey: ""
};

const uiState = {
  activeTab: "record",
  editingRecordId: null,
  editingAccountId: null,
  editingBookId: null,
  selectedType: null,
  selectedCategory: null,
  selectedDepositDir: null,
  chartType: "bar",
  chartKind: "expense",
  detailExpanded: false,
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
  books: [],
  records: [],
  accounts: [],
  customTypes: [],
  customCategories: [],
  // 后端选项的名称到 UUID 映射，记录写入时使用；页面仍继续用名称显示。
  backendCategoryIds: {},
  backendTypeIds: {},
  // 后端读取成功后置为 true；写入能力按资源逐步开启，避免半迁移状态覆盖数据。
  backendBooksLoaded: false,
  backendOptionsLoaded: false,
  backendRecordsLoaded: false,
  backendOverview: null
};

function resetFilterState() {
  filterState.fromDate = "";
  filterState.toDate = "";
  filterState.account = "";
  filterState.category = "";
  filterState.searchKey = "";
}
