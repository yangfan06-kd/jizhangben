// 类别系统：大类/小类只管理今后的可选项，历史流水始终保留原类别名称。

const CATEGORY_SYSTEM_COLORS = [
  { color: "#E57C58", background: "#FFF0EA" },
  { color: "#4D91C7", background: "#EAF4FB" },
  { color: "#3C9A94", background: "#E8F7F5" },
  { color: "#9A6AD6", background: "#F3EDFC" },
  { color: "#D56B94", background: "#FCECF3" },
  { color: "#C18A45", background: "#FCF4E7" }
];

let categorySystemExpandedKey = null;
let categoryGroupIconDraft = "other";
let categoryGroupColorDraft = 0;
let categorySubIconDraft = "other";
const CATEGORY_SORT_HOLD_MS = 180;

function categorySystemGroups() {
  return dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
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
  const index = groups.findIndex(group => group.key === key);
  const next = index + direction;
  if (index < 0 || next < 0 || next >= groups.length) return false;
  return categorySystemCommit(() => {
    [groups[index], groups[next]] = [groups[next], groups[index]];
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
  if (!Array.isArray(keys) || keys.length !== groups.length ||
    new Set(keys).size !== groups.length || keys.some(key => !groups.some(group => group.key === key))) return false;
  if (keys.every((key, index) => key === groups[index].key)) return true;
  const byKey = new Map(groups.map(group => [group.key, group]));
  return categorySystemCommit(() => { dataState.categorySystem.groups = keys.map(key => byKey.get(key)); });
}

function reorderCategoryItems(key, names) {
  const group = categorySystemGroups().find(item => item.key === key);
  if (!group || !Array.isArray(names) || names.length !== group.items.length ||
    new Set(names).size !== group.items.length || names.some(name => !group.items.includes(name))) return false;
  if (names.every((name, index) => name === group.items[index])) return true;
  return categorySystemCommit(() => { group.items = names.slice(); });
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
    if (!active) return;
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
      if (Math.abs(x - startX) > 10 || Math.abs(y - startY) > 10) {
        window.clearTimeout(timer);
        timer = null;
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
    if (event.target.closest(".category-system-remove")) return;
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
    if (event.touches.length !== 1 || touchId !== null || pointerId !== null) return;
    if (event.target.closest(".category-system-remove")) return;
    const touch = event.changedTouches[0];
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
      key, name, icon: categoryGroupIconDraft, color: color.color, background: color.background, items: []
    });
  });
  if (saved) {
    categorySystemExpandedKey = key;
    if (typeof document !== "undefined") {
      document.getElementById("categoryGroupForm").hidden = true;
      document.getElementById("categoryGroupCreateToggle").setAttribute("aria-expanded", "false");
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
    categorySystemExpandedKey = categorySystemGroups()[0] ? categorySystemGroups()[0].key : null;
    if (typeof document !== "undefined") renderCategorySystem();
  }
  return saved;
}

async function restoreDefaultCategories() {
  if (!await appConfirm("补回默认大类和小类吗？\n已有自定义内容及排序会保留，缺少的默认类别追加到末尾。")) return false;
  return categorySystemCommit(() => {
    const active = new Set(categorySystemItemNames());
    CATEGORY_GROUPS.forEach(template => {
      let group = categorySystemGroups().find(item => item.key === template.key || item.name === template.name);
      const missing = template.items.filter(name => !active.has(name));
      if (!group && missing.length) {
        group = { ...template, items: [] };
        dataState.categorySystem.groups.push(group);
      }
      if (group) group.items.push(...missing);
      missing.forEach(name => active.add(name));
    });
    dataState.categorySystem.hidden = dataState.categorySystem.hidden.filter(name => !active.has(name));
  });
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
  box.innerHTML = "";
  CATEGORY_ICON_OPTIONS.forEach(option => {
    const button = categorySystemButton("", "category-system-icon-choice" + (option.key === selectedKey ? " selected" : ""), () => onSelect(option.key));
    button.setAttribute("aria-label", option.name);
    button.setAttribute("aria-pressed", option.key === selectedKey ? "true" : "false");
    button.title = option.name;
    button.innerHTML = categoryIconMarkupByKey(option.key);
    box.appendChild(button);
  });
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
  article.dataset.sortId = group.key;
  article.style.setProperty("--group-color", group.color);
  article.style.setProperty("--group-bg", group.background);
  const expanded = categorySystemExpandedKey === group.key;
  const toggle = categorySystemButton("", "category-system-group-toggle", null);
  toggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  const icon = categorySystemElement("span", "category-system-group-icon");
  icon.innerHTML = categoryIconMarkupByKey(group.icon) || categoryIconMarkupByKey("other");
  icon.setAttribute("aria-hidden", "true");
  toggle.appendChild(icon);
  toggle.appendChild(categorySystemElement("strong", "category-system-group-name", group.name));
  toggle.appendChild(categorySystemElement("span", "category-system-group-count", group.items.length + " 个小类"));
  toggle.appendChild(categorySystemElement("span", "category-system-chevron", expanded ? "⌃" : "⌄"));
  toggle.setAttribute("aria-label", group.name + "，点击展开或收起，长按拖动排序");
  const groupSort = bindCategoryLongPressSort(toggle, article, document.getElementById("categorySystemGroups"),
    "category-system-group", group.name, reorderCategoryGroups);
  toggle.onclick = event => {
    if (groupSort.consumeClick()) {
      event.preventDefault();
      return;
    }
    categorySystemExpandedKey = expanded ? null : group.key;
    categorySubIconDraft = group.icon;
    renderCategorySystem();
  };
  toggle.onkeydown = event => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      moveCategoryGroup(group.key, event.key === "ArrowUp" ? -1 : 1);
    }
  };
  article.appendChild(toggle);
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
    row.setAttribute("aria-label", name + "，长按图标拖动排序，键盘可用方向键");
    const itemIcon = categorySystemElement("span", "category-system-item-icon");
    itemIcon.innerHTML = categoryIconMarkup(name, group.icon) || categoryIconMarkupByKey(group.icon);
    itemIcon.setAttribute("aria-hidden", "true");
    row.appendChild(itemIcon);
    row.appendChild(categorySystemElement("span", "category-system-item-name", name));
    const controls = categorySystemElement("div", "category-system-item-actions");
    const remove = categorySystemButton("×", "category-system-remove", () => removeCategoryItem(group.key, name));
    remove.setAttribute("aria-label", "删除" + name);
    controls.appendChild(remove);
    row.onkeydown = event => {
      if (event.target !== row) return;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
        event.preventDefault();
        moveCategoryItem(group.key, name, ["ArrowUp", "ArrowLeft"].includes(event.key) ? -1 : 1);
      }
    };
    bindCategoryLongPressSort(row, row, items, "category-system-item", name,
      order => reorderCategoryItems(group.key, order));
    row.appendChild(controls);
    items.appendChild(row);
  });
  article.appendChild(items);

  const form = categorySystemElement("form", "category-system-sub-form");
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
  const submit = categorySystemElement("button", "btn-primary category-system-sub-submit", "添加小类");
  submit.type = "submit";
  form.appendChild(submit);
  form.onsubmit = async event => {
    event.preventDefault();
    await createCategoryItem(group.key, input.value, categorySubIconDraft, submit);
  };
  article.appendChild(form);
  return article;
}

function renderCategorySystem() {
  const box = document.getElementById("categorySystemGroups");
  if (!box) return;
  renderCategoryGroupChoices();
  const groups = categorySystemGroups();
  const summary = document.getElementById("categorySystemSummary");
  if (summary) summary.textContent = groups.length + " 个大类 · " + categorySystemItemNames().length + " 个小类";
  box.innerHTML = "";
  if (!groups.length) box.appendChild(categorySystemElement("p", "category-system-empty", "还没有大类，在上方创建后再添加小类。"));
  groups.forEach(group => box.appendChild(renderCategorySystemGroup(group)));
}

function openCategorySystem() {
  if (!dataState.categorySystem) loadCategorySystem();
  const selected = categoryGroupForName(uiState.selectedCategory);
  categorySystemExpandedKey = selected ? selected.key : (categorySystemGroups()[0] && categorySystemGroups()[0].key);
  categorySubIconDraft = selected ? selected.icon : "other";
  switchTab("categorySystem");
}

function bindCategorySystemEvents() {
  document.getElementById("categorySystemBackBtn").onclick = () => switchTab("record", { replaceHistory: true });
  document.getElementById("categoryGroupCreateToggle").onclick = () => {
    const form = document.getElementById("categoryGroupForm");
    form.hidden = !form.hidden;
    document.getElementById("categoryGroupCreateToggle").setAttribute("aria-expanded", form.hidden ? "false" : "true");
    if (!form.hidden) document.getElementById("categoryGroupName").focus();
  };
  document.getElementById("categoryGroupForm").onsubmit = event => {
    event.preventDefault();
    createCategoryGroup(document.getElementById("categoryGroupName").value);
  };
  document.getElementById("categorySystemRestoreBtn").onclick = restoreDefaultCategories;
}
