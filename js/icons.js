// 统一的线性图标：只使用项目自有 SVG，文字仍是主要识别线索。

const UI_ICON_MARKUP = {
  record: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6 3.5h9l3 3V20.5H6z"></path><path d="M9 3.5v5h6v-5M9 13h6M9 16.5h4"></path></svg>',
  account: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="M3 9h18M7 14h4"></path></svg>',
  detail: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6 4h12v16H6z"></path><path d="M9 8h6M9 12h6M9 16h4"></path></svg>',
  overview: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 19.5V12M10 19.5V8M16 19.5V4.5M22 19.5H2"></path></svg>',
  investment: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M15.5 8.5c-.7-.8-1.8-1.2-3.2-1.2-1.7 0-2.8.8-2.8 2s1 1.8 2.8 2.2c1.8.4 2.8 1.1 2.8 2.3s-1.1 2.1-2.9 2.1c-1.4 0-2.6-.5-3.4-1.4M12.2 5.7v12.6"></path></svg>',
  book: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"></path><path d="M4 5.5v16M8 7h8M8 11h8"></path></svg>',
  export: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 16.5V20h14v-3.5M12 4v11M8 8l4-4 4 4"></path></svg>',
  import: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 16.5V20h14v-3.5M12 15V4M8 11l4 4 4-4"></path></svg>',
  migrate: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 8h13M15 5l3 3-3 3M19 16H6M9 13l-3 3 3 3"></path></svg>',
  edit: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m5 16-.8 3.8L8 19l10.5-10.5a2.1 2.1 0 0 0-3-3z"></path><path d="m14 6 3 3"></path></svg>',
  delete: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 7h14M10 4h4l1 3H9zM7 7l1 13h8l1-13M10 10v7M14 10v7"></path></svg>'
};

const CATEGORY_ICON_MARKUP = {
  餐饮: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 11h16M6 11v1.5a6 6 0 0 0 12 0V11M8 7h8a2 2 0 0 1 2 2v2H6V9a2 2 0 0 1 2-2z"></path><path d="M12 4v3"></path></svg>',
  交通: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m5 16 1.5-7h11L19 16v3H5z"></path><path d="M7 16h10M8 19v1M16 19v1M8 12h8"></path><circle cx="8" cy="16" r="1"></circle><circle cx="16" cy="16" r="1"></circle></svg>',
  购物: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 8h14l-1 12H6z"></path><path d="M9 9V6a3 3 0 0 1 6 0v3"></path></svg>',
  娱乐: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.9z"></path></svg>',
  居住: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m4 11 8-7 8 7v9H4z"></path><path d="M9 20v-5h6v5M12 4v3"></path></svg>',
  医疗: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="8.5"></circle><path d="M12 8v8M8 12h8"></path></svg>',
  教育: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m3 9 9-4 9 4-9 4z"></path><path d="M6 11v5c3 2 9 2 12 0v-5M21 9v6"></path></svg>',
  其他: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="6" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="18" cy="12" r="1.5"></circle></svg>'
};

// 自定义类别可选的本地图标目录。图标编号会写入本地备份，图形本身始终来自项目内 SVG。
const CATEGORY_ICON_LIBRARY = {
  dining: CATEGORY_ICON_MARKUP.餐饮,
  transport: CATEGORY_ICON_MARKUP.交通,
  shopping: CATEGORY_ICON_MARKUP.购物,
  entertainment: CATEGORY_ICON_MARKUP.娱乐,
  home: CATEGORY_ICON_MARKUP.居住,
  health: CATEGORY_ICON_MARKUP.医疗,
  education: CATEGORY_ICON_MARKUP.教育,
  sport: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="5" r="2"></circle><path d="m10 9 2-1 2 1M12 8v6M8 12l4 2 4-2M10 21l2-7 2 7M8 21l2-7M16 21l-2-7"></path></svg>',
  travel: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="2"></rect><path d="M9 7V5h6v2M4 12h16M10 12v2h4v-2"></path></svg>',
  pet: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M8.5 12.5c-2.5 0-4.5 1.8-4.5 4 0 1.6 1.1 2.5 2.5 2.5 1.2 0 2-.8 3.5-.8s2.3.8 3.5.8c1.4 0 2.5-.9 2.5-2.5 0-2.2-2-4-4.5-4z"></path><circle cx="7" cy="8" r="1.5"></circle><circle cx="11" cy="6.5" r="1.5"></circle><circle cx="17" cy="8" r="1.5"></circle></svg>',
  digital: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="6" y="3" width="12" height="18" rx="2"></rect><path d="M9 6h6M10 18h4"></path></svg>',
  gift: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 10h16v10H4zM3 7h18v3H3zM12 7v13"></path><path d="M12 7H8.5C6 7 6 3.5 8.5 3.5S12 7 12 7zM12 7h3.5c2.5 0 2.5-3.5 0-3.5S12 7 12 7z"></path></svg>',
  love: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 20.5S4 15.8 4 9.6A4.1 4.1 0 0 1 12 7a4.1 4.1 0 0 1 8 2.6c0 6.2-8 10.9-8 10.9z"></path></svg>',
  insurance: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m12 3 7 3v5c0 4.5-2.8 8-7 10-4.2-2-7-5.5-7-10V6z"></path><path d="M12 8v6M9 11h6"></path></svg>',
  dorm: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 20V6l8-3 8 3v14M4 20h16M8 20v-5h8v5M8 9h2M14 9h2M8 12h2M14 12h2"></path></svg>',
  groceries: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 9h16l-1.5 11h-13z"></path><path d="M8 9V6a4 4 0 0 1 8 0v3M7 13h10M9 16h6"></path></svg>',
  breakfast: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="11" r="5"></circle><path d="M12 3v2M4.9 4.9l1.4 1.4M3 12h2M19 12h2M17.7 6.3l1.4-1.4M7 19h10"></path></svg>',
  meal: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 8h16v11H4zM4 12h16M8 5v3M12 4v4M16 5v3"></path></svg>',
  dinner: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 15h16M6 15a6 6 0 0 1 12 0M12 4v3M8 6l1 2M16 6l-1 2"></path><path d="M5 19h14"></path></svg>',
  fruit: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 8c-4-3-8 .3-7 5.5.7 3.8 3.1 6.5 7 6.5s6.3-2.7 7-6.5C20 8.3 16 5 12 8z"></path><path d="M12 8c0-2 1.2-3.5 3.5-4M13 5c1.5-.2 2.6.2 3.5 1"></path></svg>',
  snack: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><circle cx="9" cy="9" r="1"></circle><circle cx="15" cy="10" r="1"></circle><circle cx="11" cy="15" r="1"></circle><circle cx="16" cy="15" r="1"></circle></svg>',
  drink: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6 8h12l-1 11H7z"></path><path d="M9 5c0-2 3-2 3 0s3 2 3 0M12 3v2"></path></svg>',
  game: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 9h10a4 4 0 0 1 3.8 5.2l-1 3.2a2 2 0 0 1-3.4.7L14 16H10l-2.4 2.1a2 2 0 0 1-3.4-.7l-1-3.2A4 4 0 0 1 7 9z"></path><path d="M7 12v4M5 14h4M16 13h.1M18 15h.1"></path></svg>',
  movie: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="m5 9 14 6M5 15l14-6M8 5l2 4M14 15l2 4"></path></svg>',
  party: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="16" cy="6" r="2"></circle><path d="m8 11 2 9M16 8l-2 12M4 20h15"></path></svg>',
  book: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 5a3 3 0 0 1 3-2h13v17H7a3 3 0 0 0-3 3z"></path><path d="M4 5v18M8 7h8M8 11h7"></path></svg>',
  course: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="4" y="5" width="16" height="13" rx="2"></rect><path d="m9 21 3-3 3 3M8 9h8M8 13h5"></path></svg>',
  exam: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M6 3h12v18H6z"></path><path d="M9 7h6M9 11h6M9 15l2 2 4-4"></path></svg>',
  training: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="6" r="2.5"></circle><path d="M7 20a5 5 0 0 1 10 0M12 9v6M8 12h8"></path></svg>',
  bus: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="5" y="4" width="14" height="16" rx="2"></rect><path d="M5 12h14M8 8h2M14 8h2M8 17h.1M16 17h.1M8 20v1M16 20v1"></path></svg>',
  subway: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="6" y="3" width="12" height="16" rx="4"></rect><path d="M6 12h12M9 7h2M13 7h2M9 16h.1M15 16h.1M9 19l-2 2M15 19l2 2"></path></svg>',
  taxi: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m5 16 2-8h10l2 8v3H5z"></path><path d="M8 8V6h8v2M7 13h10M8 17h.1M16 17h.1"></path></svg>',
  rail: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="5" y="4" width="14" height="14" rx="3"></rect><path d="M5 11h14M9 8h2M13 8h2M8 21l3-3M16 21l-3-3M9 15h.1M15 15h.1"></path></svg>',
  plane: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m3 12 18-6-5 7 2 6-6-4-5 2 2-5z"></path><path d="M10 11 7 6"></path></svg>',
  phone: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"></rect><path d="M10 6h4M11 18h2"></path></svg>',
  clothes: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m9 5 3 2 3-2 5 3-2 5-3-2v10H9V11l-3 2-2-5z"></path></svg>',
  shoes: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 15c3 0 5 1 7 3h8a2 2 0 0 1 0 4H5a3 3 0 0 1-3-3c0-2 1-4 2-4z"></path><path d="m8 13 3 3M12 12l3 3"></path></svg>',
  beauty: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M9 3h6v5H9zM10 8h4v13h-4z"></path><path d="M9 5h6"></path></svg>',
  accessory: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="12" cy="12" r="6"></circle><circle cx="12" cy="12" r="2"></circle><path d="M8 7 5 4M16 7l3-3"></path></svg>',
  haircut: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="7" cy="17" r="3"></circle><circle cx="17" cy="7" r="3"></circle><path d="m9 15 10-10M9 19 19 9"></path></svg>',
  date: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"></rect><path d="M8 3v4M16 3v4M4 9h16M12 17s-3-1.8-3-3.5a1.8 1.8 0 0 1 3-1.1 1.8 1.8 0 0 1 3 1.1C15 15.2 12 17 12 17z"></path></svg>',
  anniversary: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M12 20s-7-4.2-7-9a3.8 3.8 0 0 1 7-2.1A3.8 3.8 0 0 1 19 11c0 4.8-7 9-7 9z"></path><path d="M4 4h2M18 4h2M12 3v2"></path></svg>',
  redpacket: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2"></rect><path d="M4 10h16M12 6v14M9 4h6M12 13v3M10.5 14.5h3"></path></svg>',
  medicine: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m7 18 9-9a3.5 3.5 0 0 1 5 5l-9 9a3.5 3.5 0 0 1-5-5z"></path><path d="m9 16 5 5M11 12h4M13 10v4"></path></svg>',
  checkup: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M7 4h10v17H7z"></path><path d="M9 4V2h6v2M10 10h4M12 8v4M10 15h4"></path></svg>',
  rent: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m4 11 8-7 8 7v9H4zM9 20v-5h6v5"></path><circle cx="18" cy="6" r="2"></circle><path d="M18 5v2M17 6h2"></path></svg>',
  utilities: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M13 2 5 13h6l-1 9 8-11h-6z"></path></svg>',
  shared: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><circle cx="8" cy="8" r="3"></circle><circle cx="16" cy="8" r="3"></circle><circle cx="12" cy="16" r="3"></circle><path d="M10 10l2 3 2-3"></path></svg>',
  property: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 20V4h16v16M8 8h2M14 8h2M8 12h2M14 12h2M8 16h2M14 16h2"></path></svg>',
  daily: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 7h16v13H4z"></path><path d="m4 7 3-3h10l3 3M8 11h8M8 15h5"></path></svg>',
  misc: '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="m5 7 7-4 7 4v10l-7 4-7-4z"></path><path d="M5 7l7 4 7-4M12 11v10"></path></svg>',
  other: CATEGORY_ICON_MARKUP.其他
};

const CATEGORY_ICON_ALIASES = {
  买菜: "groceries", 早餐: "breakfast", 午餐: "meal", 晚餐: "dinner", 水果: "fruit", 零食: "snack", 饮料: "drink",
  游戏: "game", 电影: "movie", 聚会: "party", 旅游: "travel", 运动: "sport",
  学习: "education", 书籍: "book", 课程: "course", 考试: "exam", 培训: "training",
  公交: "bus", 地铁: "subway", 打车: "taxi", 火车: "rail", 飞机: "plane", 通讯: "phone",
  衣服: "clothes", 鞋包: "shoes", 美容: "beauty", 配饰: "accessory", 理发: "haircut",
  恋爱: "love", 约会: "date", 礼物: "gift", 纪念日: "anniversary", 红包: "redpacket",
  看病: "health", 药品: "medicine", 保险: "insurance", 体检: "checkup",
  房租: "rent", 水电: "utilities", 宿舍: "dorm", 公摊: "shared", 物业: "property",
  日用: "daily", 宠物: "pet", 人情: "gift", 家居: "home", 杂项: "misc"
};

const CATEGORY_ICON_OPTIONS = [
  { key: "dining", name: "餐饮" },
  { key: "transport", name: "交通" },
  { key: "shopping", name: "购物" },
  { key: "entertainment", name: "娱乐" },
  { key: "home", name: "居住" },
  { key: "health", name: "医疗" },
  { key: "education", name: "教育" },
  { key: "sport", name: "运动" },
  { key: "travel", name: "旅行" },
  { key: "pet", name: "宠物" },
  { key: "digital", name: "数码" },
  { key: "gift", name: "礼物" },
  { key: "love", name: "恋爱" },
  { key: "insurance", name: "保险" },
  { key: "dorm", name: "宿舍" },
  { key: "other", name: "其他" }
];

function renderUiIcons(root = document) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll("[data-icon]").forEach(node => {
    const markup = UI_ICON_MARKUP[node.dataset.icon];
    if (!markup) return;
    node.innerHTML = markup;
  });
}

function categoryIconMarkup(category, fallbackKey) {
  const name = String(category || "");
  const iconKey = dataState.customCategoryIcons && dataState.customCategoryIcons[name];
  return CATEGORY_ICON_LIBRARY[iconKey] || CATEGORY_ICON_MARKUP[name] || CATEGORY_ICON_LIBRARY[CATEGORY_ICON_ALIASES[name]] || CATEGORY_ICON_LIBRARY[String(fallbackKey || "")] || "";
}

function categoryIconMarkupByKey(iconKey) {
  return CATEGORY_ICON_LIBRARY[String(iconKey || "")] || "";
}
