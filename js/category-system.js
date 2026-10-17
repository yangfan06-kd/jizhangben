// 类别系统：大类/小类可整理和改名；支出改名同步旧流水，收入改名保留旧流水名称。

const CATEGORY_SYSTEM_COLORS = [
  { color: "#E57C58", background: "#FFF0EA" },
  { color: "#4D91C7", background: "#EAF4FB" },
  { color: "#3C9A94", background: "#E8F7F5" },
  { color: "#9A6AD6", background: "#F3EDFC" },
  { color: "#D56B94", background: "#FCECF3" },
  { color: "#C18A45", background: "#FCF4E7" }
];

let categorySystemExpandedKey = null;
let categorySystemSide = "expense";
let categoryGroupIconDraft = "other";
let categoryGroupColorDraft = 0;
let categorySubIconDraft = "other";
let categoryItemIconEditState = null;
let categorySystemScrollTop = 0;
let categorySystemHasScrollPosition = false;
let categorySystemScrollListenerBound = false;
const CATEGORY_SORT_HOLD_MS = 320;
const CATEGORY_SORT_MOVE_PX = 12;

function categorySystemGroups() {
  return dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
}

function categorySystemVisibleGroups() {
  return categorySystemGroups().filter(group => group.side === categorySystemSide);
}

function categorySystemItemNames() {
  return categorySystemGroups().flatMap(group => group.items);
}

function categorySystemCommit(change) {
  const previous = JSON.stringify(dataState.categorySystem);
  try {
    change();
    saveCategorySystem();
  } catch (error) {
    dataState.categorySystem = JSON.parse(previous);
    appNotice("类别保存失败，原设置已保留");
    return false;
  }
  if (uiState.selectedCategory && !allCategories().includes(uiState.selectedCategory) && uiState.editingRecordId === null) {
    uiState.selectedCategory = null;
  }
  if (typeof document !== "undefined") {
    if (typeof renderCategoryChips === "function") renderCategoryChips();
    if (typeof fillCategoryFilter === "function") fillCategoryFilter();
    if (typeof renderBudgetPage === "function") renderBudgetPage();
    renderCategorySystem();
  }
  return true;
}

function moveCategoryGroup(key, direction) {
  const groups = categorySystemGroups();
  const visible = categorySystemVisibleGroups();
  const index = visible.findIndex(group => group.key === key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= visible.length) return false;
  const firstIndex = groups.findIndex(group => group.key === visible[index].key);
  const secondIndex = groups.findIndex(group => group.key === visible[next].key);
  return categorySystemCommit(() => {
    [groups[firstIndex], groups[secondIndex]] = [groups[secondIndex], groups[firstIndex]];
  });
}

function moveCategoryItem(key, name, direction) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group) return false;
  const index = group.items.indexOf(name);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= group.items.length) return false;
  return categorySystemCommit(() => {
    [group.items[index], group.items[next]] = [group.items[next], group.items[index]];
  });
}

function reorderCategoryGroups(keys) {
  const groups = categorySystemGroups();
  const visible = categorySystemVisibleGroups();
  if (!Array.isArray(keys) || keys.length !== visible.length ||
    new Set(keys).size !== visible.length || keys.some(key => !visible.some(group => group.key === key))) return false;
  if (keys.every((key, index) => key === visible[index].key)) return true;
  const byKey = new Map(groups.map(group => [group.key, group]));
  const positions = groups.map((group, index) => group.side === categorySystemSide ? index : -1).filter(index => index >= 0);
  return categorySystemCommit(() => {
    const next = groups.slice();
    positions.forEach((position, index) => { next[position] = byKey.get(keys[index]); });
    dataState.categorySystem.groups = next;
  });
}

function reorderCategoryItems(key, names) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group || !Array.isArray(names) || names.length !== group.items.length ||
    new Set(names).size !== group.items.length || names.some(name => !group.items.includes(name))) return false;
  if (names.every((name, index) => name === group.items[index])) return true;
  return categorySystemCommit(() => { group.items = names.slice(); });
}

async function renameCategoryGroup(key, newNameValue) {
  const group = categorySystemGroups().find(item => item.key === key);
  const newName = categoryNameInput(newNameValue, "大类");
  if (!group || !newName) return false;
  const oldName = group.name;
  if (newName === oldName) return true;
  if (categorySystemGroups().some(item => item.name === newName) || categorySystemItemNames().includes(newName)) {
    appNotice("这个名称已经使用，请换一个名称");
    return false;
  }
  const renameHistory = group.side !== "income";
  const message = renameHistory
    ? "把大类「" + oldName + "」改为「" + newName + "」吗？原有小类和旧流水会一起显示新名称。"
    : "把收入大类「" + oldName + "」改为「" + newName + "」吗？以前的流水保持原名称。";
  if (!await appConfirm(message)) return false;

  // 通常流水只存小类名称，父级名称由类别系统实时提供；兼容曾直接用大类名记账的旧流水。
  const updates = new Map();
  if (renameHistory && !categorySystemItemNames().includes(oldName)) {
    try {
      Object.entries(appStorage.entries("jizhangben_records_")).forEach(([storageKey, raw]) => {
        const records = JSON.parse(raw);
        if (!Array.isArray(records)) throw new Error("records_invalid");
        let changed = false;
        records.forEach(record => {
          if (record && record.category === oldName && typeSide(record.type) === group.side) {
            record.category = newName;
            changed = true;
          }
        });
        if (changed) updates.set(storageKey, JSON.stringify(records));
      });
    } catch (error) {
      appNotice("发现无法读取的旧流水，已取消改名，原数据未更改");
      return false;
    }
  }
  const previousSystem = JSON.stringify(dataState.categorySystem);
  const nextSystem = JSON.parse(previousSystem);
  nextSystem.groups.find(item => item.key === key).name = newName;
  updates.set(CATEGORY_SYSTEM_KEY, JSON.stringify(nextSystem));
  const before = new Map(Array.from(updates.keys(), storageKey => [storageKey, appStorage.get(storageKey)]));
  try {
    updates.forEach((value, storageKey) => appStorage.set(storageKey, value));
  } catch (error) {
    before.forEach((value, storageKey) => {
      try { if (value === null) appStorage.remove(storageKey); else appStorage.set(storageKey, value); } catch (_) { /* 尽力回滚 */ }
    });
    appNotice("保存失败，已恢复改名前的数据；请检查手机剩余空间");
    return false;
  }
  dataState.categorySystem = nextSystem;
  load();
  if (typeof markLocalChangePending === "function" && typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange()) {
    markLocalChangePending("category_group_rename");
  }
  if (typeof renderCategoryChips === "function") renderCategoryChips();
  if (typeof fillCategoryFilter === "function") fillCategoryFilter();
  renderCategorySystem();
  if (typeof render === "function") render();
  return true;
}

function beginCategoryGroupRename(article, group) {
  const existing = article.querySelector(".category-system-rename-editor");
  if (existing) existing.remove();
  const editor = categorySystemElement("form", "category-system-rename-editor");
  editor.appendChild(categorySystemElement("label", "category-system-rename-label", "修改大类「" + group.name + "」的名称"));
  const input = categorySystemElement("input", "category-system-rename-input");
  input.type = "text";
  input.maxLength = 20;
  input.value = group.name;
  input.setAttribute("aria-label", "修改大类名称");
  const actions = categorySystemElement("div", "category-system-rename-actions");
  const save = categorySystemButton("保存名称", "category-system-rename-save", null);
  save.type = "submit";
  const cancel = categorySystemButton("取消", "category-system-rename-cancel", () => editor.remove());
  actions.append(save, cancel);
  editor.append(input, actions);
  editor.onsubmit = async event => {
    event.preventDefault();
    await renameCategoryGroup(group.key, input.value);
  };
  article.querySelector(".category-system-group-head").after(editor);
  input.focus({ preventScroll: true });
  input.select();
}

async function renameCategoryItem(key, oldName, newNameValue, iconKey = null) {
  const group = categorySystemGroups().find(item => item.key === key);
  const newName = categoryNameInput(newNameValue, "小类");
  if (!group || !group.items.includes(oldName) || !newName) return false;
  if (iconKey !== null && !categoryIconMarkupByKey(iconKey)) {
    appNotice("这个图标暂时无法使用，请重新选择");
    return false;
  }
  if (newName === oldName && iconKey === null) return true;
  if (newName !== oldName && (categorySystemItemNames().includes(newName) || dataState.categorySystem.hidden.includes(newName))) {
    appNotice("这个名称已经使用，请换一个名称");
    return false;
  }
  const renameHistory = group.side !== "income";
  if (newName !== oldName) {
    const message = renameHistory
      ? "把「" + oldName + "」改为「" + newName + "」吗？所有账本中的旧流水、预算和类别图标都会同步改名。"
      : "把收入小类「" + oldName + "」改为「" + newName + "」吗？以前的流水仍显示原名称，今后记账使用新名称。";
    if (!await appConfirm(message)) return false;
  }

  const updates = new Map();
  const recordsStorage = renameHistory ? appStorage.entries("jizhangben_records_") : {};
  const budgetsStorage = renameHistory ? appStorage.entries(BUDGETS_KEY_PREFIX) : {};
  try {
    Object.entries(recordsStorage).forEach(([storageKey, raw]) => {
      const records = JSON.parse(raw);
      if (!Array.isArray(records)) throw new Error("records_invalid");
      let changed = false;
      records.forEach(record => {
        if (record && record.category === oldName) { record.category = newName; changed = true; }
      });
      if (changed) updates.set(storageKey, JSON.stringify(records));
    });
    Object.entries(budgetsStorage).forEach(([storageKey, raw]) => {
      const budget = JSON.parse(raw);
      let changed = false;
      Object.values(budget && budget.periods || {}).forEach(period => {
        if (!period || !period.categories || !Object.prototype.hasOwnProperty.call(period.categories, oldName)) return;
        const prior = Number(period.categories[oldName]) || 0;
        delete period.categories[oldName];
        period.categories[newName] = (Number(period.categories[newName]) || 0) + prior;
        changed = true;
      });
      if (changed) updates.set(storageKey, JSON.stringify(budget));
    });
  } catch (error) {
    appNotice("发现无法读取的旧流水或预算，已取消改名，原数据未更改");
    return false;
  }

  const previousCategorySystem = JSON.stringify(dataState.categorySystem);
  const categorySystem = JSON.parse(previousCategorySystem);
  const targetGroup = categorySystem.groups.find(item => item.key === key);
  if (newName !== oldName) {
    targetGroup.items = targetGroup.items.map(item => item === oldName ? newName : item);
    if (!renameHistory && !categorySystem.hidden.includes(oldName)) categorySystem.hidden.push(oldName);
  }
  const previousCustomCategories = appStorage.get(CUSTOM_CATEGORIES_KEY);
  let customCategories = [];
  try { customCategories = previousCustomCategories ? JSON.parse(previousCustomCategories) : []; } catch (error) { customCategories = []; }
  customCategories = customCategories.map(item => item === oldName ? newName : item);
  const previousIcons = appStorage.get(CUSTOM_CATEGORY_ICONS_KEY);
  let icons = {};
  try { icons = previousIcons ? JSON.parse(previousIcons) : {}; } catch (error) { icons = {}; }
  if (Object.prototype.hasOwnProperty.call(icons, oldName)) {
    icons[newName] = icons[oldName];
    if (renameHistory && newName !== oldName) delete icons[oldName];
  }
  if (iconKey !== null) icons[newName] = iconKey;
  updates.set(CATEGORY_SYSTEM_KEY, JSON.stringify(categorySystem));
  if (previousCustomCategories !== null) updates.set(CUSTOM_CATEGORIES_KEY, JSON.stringify(customCategories));
  if (previousIcons !== null || iconKey !== null) updates.set(CUSTOM_CATEGORY_ICONS_KEY, JSON.stringify(icons));

  const before = new Map(Array.from(updates.keys(), storageKey => [storageKey, appStorage.get(storageKey)]));
  try {
    updates.forEach((value, storageKey) => appStorage.set(storageKey, value));
  } catch (error) {
    before.forEach((value, storageKey) => {
      try { if (value === null) appStorage.remove(storageKey); else appStorage.set(storageKey, value); } catch (_) { /* best-effort rollback */ }
    });
    dataState.categorySystem = JSON.parse(previousCategorySystem);
    appNotice("保存失败，已恢复改名前的数据；请检查手机剩余空间");
    return false;
  }

  dataState.categorySystem = categorySystem;
  dataState.customCategories = customCategories;
  dataState.customCategoryIcons = icons;
  if (dataState.backendCategoryIds && dataState.backendCategoryIds[oldName]) {
    dataState.backendCategoryIds[newName] = dataState.backendCategoryIds[oldName];
    delete dataState.backendCategoryIds[oldName];
  }
  if (filterState.category === oldName) filterState.category = newName;
  if (uiState.selectedCategory === oldName) uiState.selectedCategory = newName;
  if (typeof markLocalChangePending === "function" && typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange()) {
    markLocalChangePending("category_rename");
  }
  if (typeof load === "function") load();
  if (typeof loadBudgetData === "function") loadBudgetData();
  if (typeof renderCategoryChips === "function") renderCategoryChips();
  if (typeof fillCategoryFilter === "function") fillCategoryFilter();
  if (typeof renderBudgetPage === "function") renderBudgetPage();
  renderCategorySystem();
  if (typeof render === "function") render();
  return true;
}

// 长按整行才进入排序；普通上下滑动继续由浏览器处理。
function bindCategoryLongPressSort(surface, row, container, rowClass, label, commitOrder) {
  let timer = null;
  let active = false;
  let ghost = null;
  let frame = 0;
  let positionDirty = false;
  const shiftAnimations = new Map();
  let pointerId = null;
  let touchId = null;
  let suppressClick = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  const isGrid = rowClass === "category-system-item";
  const originalOrder = () => Array.from(container.children)
    .filter(child => child.classList.contains(rowClass))
    .map(child => child.dataset.sortId);
  let before = [];

  function placeRow(x, y) {
    const others = Array.from(container.children)
      .filter(child => child !== row && child.classList.contains(rowClass));
    const next = others.find(child => {
      const rect = child.getBoundingClientRect();
      if (!isGrid) return y < rect.top + rect.height / 2;
      if (y < rect.top) return true;
      return y <= rect.bottom && x < rect.left + rect.width / 2;
    });
    if (next ? row.nextElementSibling === next : row === container.lastElementChild) return;
    const oldRects = new Map(others.map(child => [child, child.getBoundingClientRect()]));
    shiftAnimations.forEach(animation => animation.cancel());
    shiftAnimations.clear();
    container.insertBefore(row, next || null);
    if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    others.forEach(child => {
      if (typeof child.animate !== "function") return;
      const oldRect = oldRects.get(child);
      const newRect = child.getBoundingClientRect();
      const dx = oldRect.left - newRect.left;
      const dy = oldRect.top - newRect.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      const animation = child.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
        { duration: 110, easing: "ease-out" }
      );
      shiftAnimations.set(child, animation);
      animation.onfinish = () => { if (shiftAnimations.get(child) === animation) shiftAnimations.delete(child); };
    });
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    const width = isGrid ? 64 : 220;
    const left = Math.round(Math.max(8, Math.min(window.innerWidth - width - 8, x - width / 2)));
    const top = Math.round(y - (isGrid ? 31 : 24));
    ghost.style.transform = `translate3d(${left}px, ${top}px, 0)`;
  }

  function autoScroll() {
    if (!active) return;
    const edge = 76;
    const distance = lastY < edge ? lastY - edge : lastY > window.innerHeight - edge ? lastY - (window.innerHeight - edge) : 0;
    if (distance) {
      window.scrollBy(0, Math.max(-14, Math.min(14, distance / 5)));
    }
    if (positionDirty || distance) {
      moveGhost(lastX, lastY);
      placeRow(lastX, lastY);
      positionDirty = false;
    }
    frame = window.requestAnimationFrame(autoScroll);
  }

  function startDrag() {
    timer = null;
    if (originalOrder().length < 2) return;
    active = true;
    suppressClick = true;
    before = originalOrder();
    row.classList.add("category-system-drag-source");
    ghost = document.createElement("div");
    ghost.className = "category-system-drag-ghost" + (isGrid ? " item" : "");
    const rowStyle = window.getComputedStyle(row);
    ghost.style.setProperty("--group-color", rowStyle.getPropertyValue("--group-color"));
    ghost.style.setProperty("--group-bg", rowStyle.getPropertyValue("--group-bg"));
    const icon = row.querySelector(".category-system-item-icon, .category-system-group-icon");
    if (icon) ghost.appendChild(icon.cloneNode(true));
    ghost.appendChild(document.createTextNode(label));
    document.body.appendChild(ghost);
    moveGhost(lastX, lastY);
    positionDirty = true;
    frame = window.requestAnimationFrame(autoScroll);
  }

  function finish(commit) {
    if (timer) window.clearTimeout(timer);
    timer = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", onTouchMove);
    window.removeEventListener("touchend", onTouchEnd);
    window.removeEventListener("touchcancel", onTouchCancel);
    pointerId = null;
    touchId = null;
    if (!active) {
      window.setTimeout(() => { suppressClick = false; }, 0);
      return;
    }
    active = false;
    window.cancelAnimationFrame(frame);
    if (commit && positionDirty) placeRow(lastX, lastY);
    shiftAnimations.forEach(animation => animation.cancel());
    shiftAnimations.clear();
    const after = originalOrder();
    row.classList.remove("category-system-drag-source");
    if (ghost) ghost.remove();
    ghost = null;
    if (!commit) renderCategorySystem();
    else if (after.some((id, index) => id !== before[index])) commitOrder(after);
    window.setTimeout(() => { suppressClick = false; }, 0);
  }

  function moveAt(x, y, event) {
    lastX = x;
    lastY = y;
    if (!active) {
      if (Math.abs(x - startX) > CATEGORY_SORT_MOVE_PX || Math.abs(y - startY) > CATEGORY_SORT_MOVE_PX) {
        window.clearTimeout(timer);
        timer = null;
        suppressClick = true;
      }
      return;
    }
    event.preventDefault();
    positionDirty = true;
  }

  surface.oncontextmenu = event => event.preventDefault();
  const onMove = event => {
    if (event.pointerId !== pointerId) return;
    moveAt(event.clientX, event.clientY, event);
  };
  const onUp = event => {
    if (event.pointerId !== pointerId) return;
    finish(true);
  };
  const onCancel = event => {
    if (event.pointerId !== pointerId) return;
    finish(false);
  };
  surface.onpointerdown = event => {
    if (event.pointerType === "touch" || event.button !== 0 || !event.isPrimary || pointerId !== null) return;
    if (event.target.closest(".category-system-remove, .category-system-group-rename-inline")) return;
    suppressClick = false;
    pointerId = event.pointerId;
    startX = lastX = event.clientX;
    startY = lastY = event.clientY;
    if (surface.setPointerCapture) surface.setPointerCapture(pointerId);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    timer = window.setTimeout(startDrag, CATEGORY_SORT_HOLD_MS);
  };

  function matchingTouch(list) {
    return Array.from(list).find(touch => touch.identifier === touchId);
  }
  const onTouchMove = event => {
    const touch = matchingTouch(event.touches);
    if (touch) moveAt(touch.clientX, touch.clientY, event);
  };
  const onTouchEnd = event => {
    if (matchingTouch(event.changedTouches)) finish(true);
  };
  const onTouchCancel = event => {
    if (matchingTouch(event.changedTouches)) finish(false);
  };
  surface.addEventListener("touchstart", event => {
    if (event.touches.length !== 1) { finish(false); return; }
    if (touchId !== null || pointerId !== null) return;
    if (event.target.closest(".category-system-remove, .category-system-group-rename-inline")) return;
    const touch = event.changedTouches[0];
    suppressClick = false;
    touchId = touch.identifier;
    startX = lastX = touch.clientX;
    startY = lastY = touch.clientY;
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    timer = window.setTimeout(startDrag, CATEGORY_SORT_HOLD_MS);
  }, { passive: true });
  return {
    consumeClick() {
      if (!suppressClick) return false;
      suppressClick = false;
      return true;
    }
  };
}

function categoryNameInput(value, kind) {
  const name = String(value || "").trim();
  if (!name) {
    appNotice("请填写" + kind + "名称");
    return "";
  }
  if (name.length > 20 || /[\u0000-\u001f]/.test(name)) {
    appNotice(kind + "名称最多 20 个字，不能包含换行");
    return "";
  }
  return name;
}

function setCategoryGroupFormOpen(open) {
  const form = document.getElementById("categoryGroupForm");
  const toggle = document.getElementById("categoryGroupCreateToggle");
  form.hidden = !open;
  toggle.setAttribute("aria-expanded", open ? "true" : "false");
  toggle.setAttribute("aria-label", (open ? "收起" : "展开") + "新增大类");
}

function createCategoryGroup(nameValue) {
  const name = categoryNameInput(nameValue, "大类");
  if (!name) return false;
  if (categorySystemGroups().some(group => group.name === name)) {
    appNotice("这个大类已经存在");
    return false;
  }
  const color = CATEGORY_SYSTEM_COLORS[categoryGroupColorDraft];
  const key = "custom-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
  const saved = categorySystemCommit(() => {
    dataState.categorySystem.groups.push({
      key, name, side: categorySystemSide, icon: categoryGroupIconDraft, color: color.color, background: color.background, items: []
    });
  });
  if (saved) {
    categorySystemExpandedKey = key;
    if (typeof document !== "undefined") {
      setCategoryGroupFormOpen(false);
      renderCategorySystem();
      document.getElementById("categoryGroupName").value = "";
    }
  }
  return saved;
}

async function createCategoryItem(key, nameValue, iconKey, button) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group) return false;
  const name = categoryNameInput(nameValue, "小类");
  if (!name) return false;
  if (categorySystemItemNames().includes(name)) {
    appNotice("这个小类已经存在；小类名称在整个类别系统中不能重复");
    return false;
  }
  if (button) button.disabled = true;
  const isBuiltIn = CATEGORY_GROUPS.some(item => item.items.includes(name));
  let backendItem = null;
  let backendFallback = false;
  try {
    if (!isBuiltIn && customOptionsBackendEnabled() && !backendOptionId(dataState.backendCategoryIds, name)) {
      backendItem = await backendApi.createCategory({ name });
      if (!backendItem || !backendItem.id) throw new Error("custom_option_response_invalid");
    }
  } catch (error) {
    if (error && error.code && error.code !== "backend_request_failed") {
      appNotice(userFacingError(error, "类别创建失败"));
      if (button) button.disabled = false;
      return false;
    }
    backendFallback = true;
  }
  const saved = categorySystemCommit(() => {
    group.items.push(name);
    dataState.categorySystem.hidden = dataState.categorySystem.hidden.filter(item => item !== name);
  });
  if (!saved) {
    if (button) button.disabled = false;
    return false;
  }
  if (!uiState.selectedCategory && group.side === categorySystemSide) {
    uiState.selectedCategory = name;
    if (typeof document !== "undefined" && typeof renderCategoryChips === "function") renderCategoryChips();
  }
  let metadataSaved = true;
  try {
    if (!isBuiltIn && !dataState.customCategories.includes(name)) {
      dataState.customCategories.push(name);
      saveCustomCategories();
    }
    dataState.customCategoryIcons[name] = iconKey || group.icon || "other";
    saveCustomCategoryIcons();
  } catch (error) {
    metadataSaved = false;
  }
  if (typeof document !== "undefined") renderCategorySystem();
  if (backendItem && backendItem.id) dataState.backendCategoryIds[name] = backendItem.id;
  if (backendFallback || (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange())) {
    if (typeof markLocalChangePending === "function") markLocalChangePending("category_write");
  }
  if (backendFallback) appNotice("已保存在本机；服务恢复后请核对同步结果");
  if (!metadataSaved) appNotice("小类已加入，但图标等附加信息保存失败，请检查存储空间并导出备份");
  return true;
}

async function removeCategoryItem(key, name) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group || !group.items.includes(name)) return false;
  const used = dataState.records.filter(record => record.category === name).length;
  const message = "移除小类「" + name + "」吗？" +
    (used ? "当前账本已有 " + used + " 笔使用它。" : "") +
    "\n历史流水不会删除，之后记账不再显示这个小类。";
  if (!await appConfirm(message)) return false;
  return categorySystemCommit(() => {
    group.items = group.items.filter(item => item !== name);
    if (!dataState.categorySystem.hidden.includes(name)) dataState.categorySystem.hidden.push(name);
  });
}

async function removeCategoryGroup(key) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group) return false;
  if (!await appConfirm("删除大类「" + group.name + "」及其中 " + group.items.length + " 个小类吗？\n历史流水不会删除；这些小类以后不再出现在记账选择中。")) return false;
  const saved = categorySystemCommit(() => {
    dataState.categorySystem.groups = categorySystemGroups().filter(item => item.key !== key);
    group.items.forEach(name => {
      if (!dataState.categorySystem.hidden.includes(name)) dataState.categorySystem.hidden.push(name);
    });
  });
  if (saved) {
    const remaining = categorySystemVisibleGroups();
    categorySystemExpandedKey = remaining[0] ? remaining[0].key : null;
    if (typeof document !== "undefined") renderCategorySystem();
  }
  return saved;
}

function categorySystemElement(tag, className, textValue) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (textValue !== undefined) element.textContent = textValue;
  return element;
}

function categorySystemButton(label, className, onClick, disabled = false) {
  const button = categorySystemElement("button", className, label);
  button.type = "button";
  button.disabled = disabled;
  button.onclick = onClick;
  return button;
}

function renderCategoryIconChoices(box, selectedKey, onSelect) {
  if (!box) return;
  const previousGrid = box.querySelector(".category-system-icon-grid");
  const scrollTop = previousGrid ? previousGrid.scrollTop : 0;
  const focusedKey = box.contains(document.activeElement) && document.activeElement.dataset.categoryIconKey;
  const selected = String(selectedKey || "");
  const isClassicKey = CATEGORY_ICON_OPTIONS.some(option => option.key === selected);
  const legacyTablerKey = !selected.startsWith("tabler:") && !isClassicKey &&
    Object.prototype.hasOwnProperty.call(TABLER_CATEGORY_ICON_MARKUP, "tabler:" + selected);
  const displaySelected = legacyTablerKey ? "tabler:" + selected : selected;
  box.innerHTML = "";
  const grid = categorySystemElement("div", "category-system-icon-grid category-system-icon-choice-grid");
  const appendOption = option => {
    const button = categorySystemButton("", "category-system-icon-choice" + (option.key === displaySelected ? " selected" : ""), () => onSelect(option.key));
    button.dataset.categoryIconKey = option.key;
    button.setAttribute("aria-label", option.name);
    button.setAttribute("aria-pressed", option.key === displaySelected ? "true" : "false");
    button.title = option.name;
    const icon = categorySystemElement("span", "category-system-icon-art");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = categoryIconMarkupByKey(option.key);
    button.appendChild(icon);
    button.appendChild(categorySystemElement("span", "category-system-icon-name", option.name));
    grid.appendChild(button);
  };
  const commonGroup = CATEGORY_ICON_TABLER_GROUPS.find(group => group.key === "common");
  grid.appendChild(categorySystemElement("span", "category-system-icon-group-title", "常用"));
  CATEGORY_ICON_OPTIONS.forEach(appendOption);
  (commonGroup && commonGroup.options || []).forEach(([key, name]) => appendOption({ key, name }));
  CATEGORY_ICON_TABLER_GROUPS.filter(group => group !== commonGroup).forEach(group => {
    grid.appendChild(categorySystemElement("span", "category-system-icon-group-title", group.name));
    group.options.forEach(([key, name]) => appendOption({ key, name }));
  });
  box.appendChild(grid);
  if (focusedKey) {
    const focusTarget = Array.from(grid.children).find(button => button.dataset.categoryIconKey === focusedKey);
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }
  grid.scrollTop = scrollTop;
}

function currentCategoryIconKey(name, group) {
  const selected = dataState.customCategoryIcons && dataState.customCategoryIcons[name];
  if (selected && categoryIconMarkupByKey(selected)) return selected;
  const alias = CATEGORY_ICON_ALIASES[name];
  if (alias && categoryIconMarkupByKey(alias)) return alias;
  const classic = CATEGORY_ICON_OPTIONS.find(option => option.name === name);
  if (classic) return classic.key;
  const tabler = CATEGORY_ICON_TABLER_OPTIONS.find(option => option.name === name);
  return tabler ? tabler.key : (group && categoryIconMarkupByKey(group.icon) ? group.icon : "other");
}

function openCategoryItemIconEditor(groupKey, name, returnFocusTarget) {
  const group = categorySystemGroups().find(item => item.key === groupKey);
  if (!group || !group.items.includes(name)) return false;
  categoryItemIconEditState = {
    groupKey,
    name,
    iconKey: currentCategoryIconKey(name, group),
    scrollTop: window.scrollY || 0,
    saving: false,
    pageWasInert: document.getElementById("panelCategorySystem").inert,
    returnFocusTarget: returnFocusTarget || null
  };
  document.getElementById("categoryItemEditNameInput").value = name;
  document.getElementById("categoryItemEditStatus").textContent = "";
  const choices = document.getElementById("categoryItemEditIconChoices");
  const onSelect = key => {
    categoryItemIconEditState.iconKey = key;
    renderCategoryIconChoices(choices, key, onSelect);
  };
  renderCategoryIconChoices(choices, categoryItemIconEditState.iconKey, onSelect);
  const backdrop = document.getElementById("categoryItemEditBackdrop");
  backdrop.hidden = false;
  backdrop.querySelector(".category-item-edit-sheet").scrollTop = 0;
  document.getElementById("panelCategorySystem").inert = true;
  document.body.classList.add("category-item-editor-open");
  backdrop.querySelector(".category-item-edit-sheet").focus({ preventScroll: true });
  const grid = choices.querySelector(".category-system-icon-grid");
  const selected = grid.querySelector(".selected");
  if (selected) grid.scrollTop = Math.max(0, selected.getBoundingClientRect().top - grid.getBoundingClientRect().top - 8);
  return true;
}

function closeCategoryItemIconEditor() {
  if (!categoryItemIconEditState) return false;
  if (typeof pendingConfirm !== "undefined" && pendingConfirm) { finishAppConfirm(false); return true; }
  if (typeof pendingNotice !== "undefined" && pendingNotice) { finishAppNotice(); return true; }
  if (categoryItemIconEditState.saving) return true;
  const target = categoryItemIconEditState.returnFocusTarget;
  const { scrollTop, pageWasInert } = categoryItemIconEditState;
  categoryItemIconEditState = null;
  document.getElementById("categoryItemEditBackdrop").hidden = true;
  document.getElementById("panelCategorySystem").inert = !!pageWasInert;
  document.body.classList.remove("category-item-editor-open");
  window.scrollTo(0, scrollTop);
  if (target && target.isConnected && typeof target.focus === "function") target.focus({ preventScroll: true });
  return true;
}

function persistCategoryItemIcon(name, iconKey) {
  const previousIcons = dataState.customCategoryIcons || {};
  const nextIcons = { ...previousIcons, [name]: iconKey };
  try {
    dataState.customCategoryIcons = nextIcons;
    saveCustomCategoryIcons();
  } catch (error) {
    dataState.customCategoryIcons = previousIcons;
    appNotice("图标保存失败，原设置已保留；请检查手机剩余存储空间");
    return false;
  }
  try {
    if (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange() && typeof markLocalChangePending === "function") {
      markLocalChangePending("category_icon_write");
    }
  } catch (error) { /* 本机设置已保存；同步标记失败不回滚本地设置。 */ }
  return true;
}

async function saveCategoryItemChanges() {
  if (!categoryItemIconEditState || categoryItemIconEditState.saving) return false;
  const editState = categoryItemIconEditState;
  const saveButton = document.getElementById("categoryItemEditSave");
  const status = document.getElementById("categoryItemEditStatus");
  editState.saving = true;
  saveButton.disabled = true;
  saveButton.setAttribute("aria-busy", "true");
  saveButton.textContent = "保存中…";
  document.querySelectorAll("[data-category-item-edit-close]").forEach(button => { button.disabled = true; });
  status.textContent = "";
  try {
    const { groupKey, name, iconKey } = categoryItemIconEditState;
    const newName = document.getElementById("categoryItemEditNameInput").value;
    const group = categorySystemGroups().find(item => item.key === groupKey);
    if (!group || !group.items.includes(name) || !categoryIconMarkupByKey(iconKey)) {
      appNotice("类别设置已变化，请重新打开后再保存");
      return false;
    }
    const oldIconKey = (dataState.customCategoryIcons && dataState.customCategoryIcons[name]) || currentCategoryIconKey(name, group);
    const normalizedName = categoryNameInput(newName, "小类");
    if (!normalizedName) return false;
    if (oldIconKey === iconKey && normalizedName === name) {
      editState.saving = false;
      closeCategoryItemIconEditor();
      return true;
    }
    if (normalizedName !== name) {
      if (!await renameCategoryItem(groupKey, name, normalizedName, iconKey)) {
        status.textContent = "更改尚未保存，可调整后重试；原设置已保留。";
        return false;
      }
    } else if (!persistCategoryItemIcon(name, iconKey)) {
      status.textContent = "图标保存失败，原设置已保留；请检查存储空间后重试。";
      return false;
    }
    const returnFocusTarget = categoryItemIconEditState.returnFocusTarget;
    editState.saving = false;
    closeCategoryItemIconEditor();
    if (typeof renderCategoryChips === "function") renderCategoryChips();
    if (typeof fillCategoryFilter === "function") fillCategoryFilter();
    renderCategorySystem();
    let focusTarget = returnFocusTarget;
    if (!focusTarget || !focusTarget.isConnected) {
      focusTarget = Array.from(document.querySelectorAll(".category-system-item"))
        .find(row => row.dataset.sortId === normalizedName);
    }
    if (focusTarget && focusTarget.isConnected && typeof focusTarget.focus === "function") {
      focusTarget.focus({ preventScroll: true });
    }
    appNotice(normalizedName === name ? "小类图标已保存" : "小类名称和图标已保存");
    return true;
  } finally {
    editState.saving = false;
    saveButton.disabled = false;
    saveButton.setAttribute("aria-busy", "false");
    saveButton.textContent = "保存更改";
    document.querySelectorAll("[data-category-item-edit-close]").forEach(button => { button.disabled = false; });
  }
}

function renderCategoryGroupChoices() {
  const iconBox = document.getElementById("categoryGroupIconChoices");
  renderCategoryIconChoices(iconBox, categoryGroupIconDraft, key => {
    categoryGroupIconDraft = key;
    renderCategoryGroupChoices();
  });
  const colorBox = document.getElementById("categoryGroupColorChoices");
  if (!colorBox) return;
  colorBox.innerHTML = "";
  CATEGORY_SYSTEM_COLORS.forEach((choice, index) => {
    const button = categorySystemButton("", "category-system-color-choice" + (index === categoryGroupColorDraft ? " selected" : ""), () => {
      categoryGroupColorDraft = index;
      renderCategoryGroupChoices();
    });
    button.style.backgroundColor = choice.color;
    button.setAttribute("aria-label", "颜色 " + (index + 1));
    button.setAttribute("aria-pressed", index === categoryGroupColorDraft ? "true" : "false");
    colorBox.appendChild(button);
  });
}

function renderCategorySystemGroup(group) {
  const article = categorySystemElement("article", "category-system-group");
  article.classList.toggle("expanded", categorySystemExpandedKey === group.key);
  article.dataset.sortId = group.key;
  article.style.setProperty("--group-color", group.color);
  article.style.setProperty("--group-bg", group.background);
  const expanded = categorySystemExpandedKey === group.key;
  const header = categorySystemElement("div", "category-system-group-head");
  const toggle = categorySystemButton("", "category-system-group-toggle", null);
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  const icon = categorySystemElement("span", "category-system-group-icon");
  icon.innerHTML = categoryIconMarkupByKey(group.icon) || categoryIconMarkupByKey("other");
  icon.setAttribute("aria-hidden", "true");
  toggle.appendChild(icon);
  toggle.appendChild(categorySystemElement("strong", "category-system-group-name", group.name));
  toggle.setAttribute("aria-label", group.name + "，点击展开或收起，长按拖动排序");
  const rename = categorySystemButton("改名", "category-system-group-rename-inline", () => beginCategoryGroupRename(article, group));
  rename.setAttribute("aria-label", "修改大类「" + group.name + "」的名称");
  const meta = categorySystemButton("", "category-system-group-meta", null);
  meta.setAttribute("aria-expanded", expanded ? "true" : "false");
  meta.setAttribute("aria-label", group.name + "，" + (expanded ? "收起" : "展开") + "小类");
  meta.appendChild(categorySystemElement("span", "category-system-group-count", group.items.length + " 个小类"));
  meta.appendChild(categorySystemElement("span", "category-system-chevron", expanded ? "⌃" : "⌄"));
  header.append(toggle, rename, meta);
  const groupSort = bindCategoryLongPressSort(toggle, article, document.getElementById("categorySystemGroups"),
    "category-system-group", group.name, reorderCategoryGroups);
  const toggleGroup = event => {
    if (groupSort.consumeClick()) {
      event.preventDefault();
      return;
    }
    categorySystemExpandedKey = expanded ? null : group.key;
    categorySubIconDraft = group.icon;
    renderCategorySystem();
  };
  toggle.onclick = toggleGroup;
  meta.onclick = toggleGroup;
  toggle.onkeydown = event => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveCategoryGroup(group.key, event.key === "ArrowUp" ? -1 : 1);
    }
  };
  article.appendChild(header);
  if (!expanded) return article;

  const actions = categorySystemElement("div", "category-system-group-actions");
  actions.appendChild(categorySystemButton("删除大类", "category-system-small-btn danger", () => removeCategoryGroup(group.key)));
  article.appendChild(actions);

  const items = categorySystemElement("div", "category-system-items");
  items.setAttribute("role", "list");
  if (!group.items.length) items.appendChild(categorySystemElement("p", "category-system-empty", "还没有小类，先在下方添加一个。"));
  group.items.forEach(name => {
    const row = categorySystemElement("div", "category-system-item");
    row.dataset.sortId = name;
    row.tabIndex = 0;
    row.setAttribute("role", "listitem");
    row.setAttribute("aria-label", name + "，点击图标修改名称和图标，长按拖动排序，键盘可用方向键");
    const itemIcon = categorySystemButton("", "category-system-item-icon", null);
    itemIcon.innerHTML = categoryIconMarkup(name, group.icon) || categoryIconMarkupByKey(group.icon);
    itemIcon.setAttribute("aria-label", "修改" + name + "的名称和图标");
    row.appendChild(itemIcon);
    row.appendChild(categorySystemElement("span", "category-system-item-name", name));
    row.onkeydown = event => {
      if (event.target !== row) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCategoryItemIconEditor(group.key, name, row);
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        moveCategoryItem(group.key, name, ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1);
      }
    };
    const itemSort = bindCategoryLongPressSort(row, row, items, "category-system-item", name,
      order => reorderCategoryItems(group.key, order));
    row.onclick = event => {
      if (event.target.closest(".category-system-remove")) return;
      if (itemSort.consumeClick()) {
        event.preventDefault();
        return;
      }
      openCategoryItemIconEditor(group.key, name, row);
    };
    items.appendChild(row);
  });
  article.appendChild(items);

  const addToggle = categorySystemButton("", "category-system-sub-toggle", null);
  addToggle.appendChild(categorySystemElement("span", "category-system-sub-toggle-label", "新增小类"));
  const addChevron = categorySystemElement("span", "category-system-sub-chevron", "⌄");
  addChevron.setAttribute("aria-hidden", "true");
  addToggle.appendChild(addChevron);
  const form = categorySystemElement("form", "category-system-sub-form");
  form.id = "category-system-sub-form-" + group.key;
  form.hidden = true;
  addToggle.setAttribute("aria-controls", form.id);
  const setSubFormOpen = open => {
    form.hidden = !open;
    addToggle.setAttribute("aria-expanded", open ? "true" : "false");
    addToggle.setAttribute("aria-label", (open ? "收起" : "展开") + "新增小类，" + group.name);
    addChevron.textContent = open ? "⌃" : "⌄";
  };
  setSubFormOpen(false);
  const label = categorySystemElement("label", "category-system-sub-label", "新增小类");
  const input = categorySystemElement("input", "category-system-sub-input");
  input.type = "text";
  input.maxLength = 20;
  input.autocomplete = "off";
  input.placeholder = "例如：下午茶";
  label.appendChild(input);
  form.appendChild(label);
  form.appendChild(categorySystemElement("div", "category-system-choice-label", "选择图标"));
  const choices = categorySystemElement("div", "category-system-icon-choices");
  const chooseIcon = key => {
    categorySubIconDraft = key;
    renderCategoryIconChoices(choices, key, chooseIcon);
  };
  renderCategoryIconChoices(choices, categorySubIconDraft, chooseIcon);
  form.appendChild(choices);
  const formActions = categorySystemElement("div", "category-system-sub-form-actions");
  const cancel = categorySystemButton("取消", "btn-ghost category-system-sub-cancel", () => {
    input.value = "";
    categorySubIconDraft = currentCategoryIconKey("", group);
    setSubFormOpen(false);
    renderCategoryIconChoices(choices, categorySubIconDraft, chooseIcon);
  });
  const submit = categorySystemElement("button", "btn-primary category-system-sub-submit", "添加小类");
  submit.type = "submit";
  formActions.append(cancel, submit);
  form.appendChild(formActions);
  addToggle.onclick = () => {
    const open = form.hidden;
    setSubFormOpen(open);
    if (!open) {
      input.value = "";
      categorySubIconDraft = currentCategoryIconKey("", group);
      renderCategoryIconChoices(choices, categorySubIconDraft, chooseIcon);
    }
  };
  form.onsubmit = async event => {
    event.preventDefault();
    await createCategoryItem(group.key, input.value, categorySubIconDraft, submit);
  };
  article.append(addToggle, form);
  return article;
}

function renderCategorySystem() {
  const box = document.getElementById("categorySystemGroups");
  if (!box) return;
  const preserveScroll = uiState.activeTab === "categorySystem";
  const scrollTop = preserveScroll ? (window.scrollY || 0) : 0;
  renderCategoryGroupChoices();
  const groups = categorySystemVisibleGroups();
  const summary = document.getElementById("categorySystemSummary");
  if (summary) summary.textContent = groups.length + " 个大类 · " + groups.reduce((count, group) => count + group.items.length, 0) + " 个小类";
  document.querySelectorAll("[data-category-system-side]").forEach(button => {
    const active = button.dataset.categorySystemSide === categorySystemSide;
    button.classList.toggle("selected", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  box.innerHTML = "";
  if (!groups.length) box.appendChild(categorySystemElement("p", "category-system-empty", categorySystemSide === "income" ? "还没有收入大类，先创建一个大类再添加小类。" : "还没有支出大类，先创建一个大类再添加小类。"));
  groups.forEach(group => box.appendChild(renderCategorySystemGroup(group)));
  if (preserveScroll && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => window.scrollTo(0, scrollTop));
  }
}

function restoreCategorySystemScrollPosition() {
  if (!categorySystemHasScrollPosition || typeof window.requestAnimationFrame !== "function") return;
  // 面板高度变化可能先派发一次顶部滚动事件；恢复本次进入时捕获的位置。
  const scrollTop = categorySystemScrollTop;
  window.requestAnimationFrame(() => window.scrollTo(0, scrollTop));
}

function rememberCategorySystemScrollPosition() {
  categorySystemScrollTop = Math.max(0, window.scrollY || 0);
  categorySystemHasScrollPosition = true;
}

function openCategorySystem() {
  if (!dataState.categorySystem) loadCategorySystem();
  const selected = categoryGroupForName(uiState.selectedCategory);
  const selectedSide = typeSide(uiState.selectedType);
  categorySystemSide = selectedSide === "income" || selectedSide === "expense"
    ? selectedSide
    : (selected ? selected.side : "expense");
  const visible = categorySystemVisibleGroups();
  const previousGroupStillExists = categorySystemHasScrollPosition && visible.some(group => group.key === categorySystemExpandedKey);
  if (!previousGroupStillExists) {
    categorySystemExpandedKey = selected && selected.side === categorySystemSide ? selected.key : (visible[0] && visible[0].key);
  }
  categorySubIconDraft = selected ? selected.icon : "other";
  switchTab("categorySystem");
  if (typeof restoreCategorySystemScrollPosition === "function") restoreCategorySystemScrollPosition();
}

function bindCategorySystemEvents() {
  if (!categorySystemScrollListenerBound) {
    window.addEventListener("scroll", () => {
      if (uiState.activeTab !== "categorySystem") return;
      categorySystemScrollTop = window.scrollY || 0;
      categorySystemHasScrollPosition = true;
    }, { passive: true });
    categorySystemScrollListenerBound = true;
  }
  document.getElementById("categorySystemBackBtn").onclick = () => switchTab("record", { replaceHistory: true });
  document.querySelectorAll("[data-category-system-side]").forEach(button => {
    button.onclick = () => {
      categorySystemSide = button.dataset.categorySystemSide === "income" ? "income" : "expense";
      categorySystemExpandedKey = null;
      setCategoryGroupFormOpen(false);
      renderCategorySystem();
    };
  });
  document.getElementById("categoryGroupCreateToggle").onclick = () => {
    const form = document.getElementById("categoryGroupForm");
    setCategoryGroupFormOpen(form.hidden);
    if (!form.hidden) document.getElementById("categoryGroupName").focus();
  };
  document.getElementById("categoryGroupForm").onsubmit = event => {
    event.preventDefault();
    createCategoryGroup(document.getElementById("categoryGroupName").value);
  };
  const editBackdrop = document.getElementById("categoryItemEditBackdrop");
  editBackdrop.addEventListener("click", event => {
    if (event.target === editBackdrop) closeCategoryItemIconEditor();
  });
  document.querySelectorAll("[data-category-item-edit-close]").forEach(button => {
    button.onclick = closeCategoryItemIconEditor;
  });
  document.getElementById("categoryItemEditSave").onclick = saveCategoryItemChanges;
  document.getElementById("categoryItemEditDelete").onclick = async () => {
    const state = categoryItemIconEditState;
    if (!state || state.saving) return;
    state.saving = true;
    const button = document.getElementById("categoryItemEditDelete");
    button.disabled = true;
    try {
      if (await removeCategoryItem(state.groupKey, state.name)) {
        state.saving = false;
        closeCategoryItemIconEditor();
        const group = Array.from(document.querySelectorAll(".category-system-group"))
          .find(item => item.dataset.sortId === state.groupKey);
        if (group) group.querySelector(".category-system-group-toggle").focus({ preventScroll: true });
      }
    } finally { state.saving = false; button.disabled = false; }
  };
  document.addEventListener("keydown", event => {
    if (event.defaultPrevented || !categoryItemIconEditState ||
        (typeof pendingConfirm !== "undefined" && pendingConfirm) ||
        (typeof pendingNotice !== "undefined" && pendingNotice)) return;
    if (event.key === "Tab") {
      const sheet = document.querySelector(".category-item-edit-sheet");
      const buttons = Array.from(sheet.querySelectorAll("button:not(:disabled), input:not(:disabled)"));
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (first && (event.shiftKey ? document.activeElement === first || document.activeElement === sheet : document.activeElement === last || document.activeElement === sheet)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    if (event.key === "Escape" && categoryItemIconEditState) {
      event.preventDefault();
      closeCategoryItemIconEditor();
    }
  });
}
