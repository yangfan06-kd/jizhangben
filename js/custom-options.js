// 自定义类型与类别：负责按钮渲染、添加、删除和“怎么算”选项。
// 自定义数据保存在 dataState，当前选择和展开状态保存在 uiState。

function renderTypeChips() {
  const box = document.getElementById("typeChips");
  if (!box) return;
  box.innerHTML = "";
  const list = allTypes();
  // 类型保持一行横向滑动；自定义类型自然排在内置类型后面，末尾再放新增入口。
  list.forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    b.setAttribute("aria-pressed", t === uiState.selectedType ? "true" : "false");
    const side = typeSide(t);
    if (side === "income") b.classList.add("chip-income");
    if (side === "expense") b.classList.add("chip-expense");
    if (t === uiState.selectedType) b.classList.add("selected");
    b.textContent = t;
    if (isCustomType(t)) {
      const x = document.createElement("span");
      x.className = "chip-del";
      x.setAttribute("role", "button");
      x.setAttribute("tabindex", "0");
      x.setAttribute("aria-label", "删除这个自定义类型");
      x.textContent = "×";
      x.title = "删除这个自定义类型";
      x.onclick = (e) => { e.stopPropagation(); removeCustom("type", t); };
      x.onkeydown = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          removeCustom("type", t);
        }
      };
      b.appendChild(x);
    }
    b.onclick = () => chooseRecordType(t);
    box.appendChild(b);
    if (t === TYPES[TYPES.length - 1]) {
      const social = document.createElement("button");
      social.type = "button";
      social.className = "chip";
      social.textContent = "退休金";
      social.setAttribute("aria-label", "退休金固收设置");
      social.onclick = () => switchTab("fixedIncome");
      box.appendChild(social);
    }
  });
  const add = document.createElement("button");
  add.type = "button";
  add.className = "chip chip-add";
  add.textContent = "＋ 自定义";
  add.onclick = () => renderCustomBox("type");
  box.appendChild(add);
}

function renderCategoryChips() {
  const box = document.getElementById("categoryChips");
  if (!box) return;
  box.innerHTML = "";
  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "category-picker-trigger";
  trigger.setAttribute("aria-haspopup", "dialog");
  trigger.setAttribute("aria-expanded", "false");
  trigger.onclick = openCategoryPicker;
  if (uiState.selectedCategory) {
    const iconMarkup = typeof categoryIconMarkup === "function" ? categoryIconMarkup(uiState.selectedCategory) : "";
    if (iconMarkup) {
      const icon = document.createElement("span");
      icon.className = "category-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.innerHTML = iconMarkup;
      trigger.appendChild(icon);
    }
    const label = document.createElement("span");
    label.className = "category-picker-current";
    label.textContent = uiState.selectedCategory;
    trigger.appendChild(label);
  } else {
    const label = document.createElement("span");
    label.className = "category-picker-placeholder";
    label.textContent = "点击选择类别";
    trigger.appendChild(label);
  }
  const arrow = document.createElement("span");
  arrow.className = "category-picker-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.textContent = "›";
  trigger.appendChild(arrow);
  box.appendChild(trigger);
}

function closeCategoryPicker() {
  const dialog = document.getElementById("categoryPickerDialog");
  if (!dialog) return;
  dialog.hidden = true;
  document.body.classList.remove("dialog-open");
  const trigger = document.querySelector(".category-picker-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function categoryGroupForName(name) {
  const groups = dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
  return groups
    .find(group => Array.isArray(group.items) && group.items.includes(name)) || null;
}

function categoryPickerSide() {
  const side = typeSide(uiState.selectedType);
  return side === "income" || side === "expense" ? side : "all";
}

function recentCategoryNames(limit = 8, side = categoryPickerSide()) {
  const available = new Set(allCategories(side === "all" ? "" : side));
  const seen = new Set();
  return dataState.records
    .map((record, index) => ({ record, index }))
    .filter(item => item.record && item.record.category && available.has(item.record.category) &&
      (side === "all" || typeSide(item.record.type) === side))
    .sort((a, b) => String(b.record.date || "").localeCompare(String(a.record.date || "")) || b.index - a.index)
    .map(item => item.record.category)
    .filter(category => {
      if (seen.has(category)) return false;
      seen.add(category);
      return true;
    })
    .slice(0, limit);
}

function makeCategoryPickerOption(category, group) {
  const option = document.createElement("button");
  option.type = "button";
  option.className = "category-picker-option";
  option.setAttribute("role", "option");
  option.setAttribute("aria-selected", category === uiState.selectedCategory ? "true" : "false");
  if (category === uiState.selectedCategory) option.classList.add("selected");
  const color = group && group.color ? group.color : "#6E8790";
  const background = group && group.background ? group.background : "#EEF3F4";
  option.style.setProperty("--category-color", color);
  option.style.setProperty("--category-bg", background);
  option.dataset.categoryName = category;
  const iconMarkup = typeof categoryIconMarkup === "function"
    ? categoryIconMarkup(category, group && group.icon)
    : "";
  if (iconMarkup) {
    const icon = document.createElement("span");
    icon.className = "category-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = iconMarkup;
    option.appendChild(icon);
  }
  const label = document.createElement("span");
  label.textContent = category;
  option.appendChild(label);
  option.onclick = () => {
    uiState.selectedCategory = category;
    closeCategoryPicker();
    renderCategoryChips();
  };
  return option;
}

function appendCategoryPickerSection(box, title, items, group, options = {}) {
  if (!Array.isArray(items) || (items.length === 0 && !options.emptyText)) return;
  const section = document.createElement("section");
  section.className = "category-picker-section" + (options.recent ? " recent" : "");
  const head = document.createElement("div");
  head.className = "category-picker-section-head";
  const titleBox = document.createElement("div");
  titleBox.className = "category-picker-section-title";
  const iconMarkup = group && group.icon && typeof categoryIconMarkupByKey === "function"
    ? categoryIconMarkupByKey(group.icon)
    : "";
  if (iconMarkup) {
    const icon = document.createElement("span");
    icon.className = "category-picker-section-icon";
    icon.style.color = group.color || "#6E8790";
    icon.innerHTML = iconMarkup;
    icon.setAttribute("aria-hidden", "true");
    titleBox.appendChild(icon);
  }
  const heading = document.createElement("strong");
  heading.textContent = title;
  titleBox.appendChild(heading);
  head.appendChild(titleBox);
  const hint = document.createElement("span");
  hint.className = "category-picker-section-hint";
  hint.textContent = options.recent ? "最近记过" : "常用小项";
  head.appendChild(hint);
  section.appendChild(head);
  const grid = document.createElement("div");
  grid.className = "category-picker-options" + (options.recent ? " recent" : "");
  if (items.length > 0) {
    items.forEach(category => grid.appendChild(makeCategoryPickerOption(category, categoryGroupForName(category) || group)));
  } else {
    const empty = document.createElement("p");
    empty.className = "category-picker-empty";
    empty.textContent = options.emptyText;
    grid.appendChild(empty);
  }
  section.appendChild(grid);
  box.appendChild(section);
}

function renderCategoryPickerOptions() {
  const box = document.getElementById("categoryPickerOptions");
  if (!box) return;
  box.innerHTML = "";
  const side = categoryPickerSide();
  const sideLabel = side === "income" ? "收入" : side === "expense" ? "支出" : "全部";
  const available = new Set(allCategories(side === "all" ? "" : side));
  const title = document.getElementById("categoryPickerTitle");
  const hint = document.querySelector(".record-picker-hint");
  const manage = document.getElementById("categoryPickerManageBtn");
  if (title) title.textContent = "选择" + sideLabel + "类别";
  if (hint) hint.textContent = "收入和支出分别管理类别；历史流水不会因调整类别而删除。";
  if (manage) {
    const label = manage.querySelector("strong");
    const detail = manage.querySelector("small");
    if (label) label.textContent = "管理" + sideLabel + "类别";
    if (detail) detail.textContent = "自行创建大类、小类并设置图标和顺序";
  }
  appendCategoryPickerSection(box, "近期使用", recentCategoryNames(8, side), null, {
    recent: true,
    emptyText: available.size ? "还没有记录" : "还没有类别，请先创建大类和小类"
  });
  const groups = dataState.categorySystem && Array.isArray(dataState.categorySystem.groups)
    ? dataState.categorySystem.groups : [];
  groups.forEach(group => {
    if (side !== "all" && group.side !== side) return;
    const items = (Array.isArray(group.items) ? group.items : []).filter(category => available.has(category));
    appendCategoryPickerSection(box, group.name, items, group);
  });
  const grouped = new Set(groups
    .filter(group => side === "all" || group.side === side)
    .flatMap(group => Array.isArray(group.items) ? group.items : []));
  const customOnly = dataState.customCategories.filter(category => available.has(category) && !grouped.has(category));
  appendCategoryPickerSection(box, "自定义类别", customOnly, null);
}

function openCategoryPicker() {
  const dialog = document.getElementById("categoryPickerDialog");
  if (!dialog) return;
  renderCategoryPickerOptions();
  dialog.hidden = false;
  const panel = dialog.querySelector(".record-picker-dialog");
  if (panel) panel.scrollTop = 0;
  document.body.classList.add("dialog-open");
  const trigger = document.querySelector(".category-picker-trigger");
  if (trigger) trigger.setAttribute("aria-expanded", "true");
  const selected = document.querySelector("#categoryPickerOptions .selected");
  if (selected && typeof selected.focus === "function") selected.focus();
}

// 点「＋自定义」后，在下方显示一个输入行（类型多一行“怎么算”）
function renderCustomBox(kind) {
  document.getElementById("typeCustomBox").innerHTML = "";
  document.getElementById("categoryCustomBox").innerHTML = "";
  const isType = (kind === "type");
  const box = document.getElementById(isType ? "typeCustomBox" : "categoryCustomBox");
  const label = isType ? "新类型" : "新类别";
  const example = isType ? "工资" : "宠物";
  let html = `
    <div class="custom-add">
      <input id="customInput" type="text" placeholder="${label}名称，如：${example}">
      <button class="mini-btn" id="customOk">添加</button>
      <button class="mini-btn" id="customCancel">取消</button>
    </div>`;
  if (isType) {
    uiState.customTypeSideDraft = "neutral";
    html += `
    <div class="custom-side">
      <span class="custom-side-label">怎么算：</span>
      <button class="chip custom-side-chip" data-side="income">算收入</button>
      <button class="chip custom-side-chip" data-side="expense">算支出</button>
      <button class="chip custom-side-chip selected" data-side="neutral">中性</button>
    </div>`;
  } else {
    uiState.customCategoryIconDraft = "other";
    html += `<div class="custom-category-icon-field"><span class="custom-side-label">选择图标：</span><div id="customCategoryIconPicker" class="category-system-icon-choices" aria-label="选择自定义类别图标"></div></div>`;
  }
  box.innerHTML = html;
  const input = document.getElementById("customInput");
  input.focus();
  document.getElementById("customOk").onclick = () => addCustom(kind);
  document.getElementById("customCancel").onclick = () => { box.innerHTML = ""; };
  input.onkeydown = (e) => { if (e.key === "Enter") addCustom(kind); };
  if (!isType) renderCustomCategoryIconPicker(document.getElementById("customCategoryIconPicker"));
  if (isType) {
    box.querySelectorAll(".custom-side-chip").forEach(chip => {
      chip.onclick = () => {
        uiState.customTypeSideDraft = chip.dataset.side;
        box.querySelectorAll(".custom-side-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
      };
    });
  }
}

function renderCustomCategoryIconPicker(box) {
  if (!box) return;
  renderCategoryIconChoices(box, uiState.customCategoryIconDraft, key => {
    uiState.customCategoryIconDraft = key;
    renderCustomCategoryIconPicker(box);
  });
}

function customOptionsBackendEnabled() {
  return !!(
    typeof backendApi !== "undefined" &&
    backendApi.baseUrl() &&
    dataState.authStatus === "authenticated" &&
    dataState.backendOptionsLoaded
  );
}

function customTypeCode(name) {
  const slug = String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  const suffix = (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).slice(-14);
  return ("custom-" + (slug || "type") + "-" + suffix).slice(0, 50);
}

function finishCustomAdd(kind, name, backendItem) {
  const isType = kind === "type";
  if (isType) {
    const side = uiState.customTypeSideDraft;
    dataState.customTypes.push({ name: name, side: side });
    saveCustomTypes();
    selectRecordType(name);
    if (backendItem && backendItem.id) dataState.backendTypeIds[name] = backendItem.id;
  } else {
    dataState.customCategories.push(name);
    dataState.customCategoryIcons[name] = uiState.customCategoryIconDraft || "other";
    saveCustomCategories();
    saveCustomCategoryIcons();
    if (typeof syncCategorySystemWithCustomCategories === "function") syncCategorySystemWithCustomCategories();
    uiState.selectedCategory = name;
    if (backendItem && backendItem.id) dataState.backendCategoryIds[name] = backendItem.id;
  }
  document.getElementById(isType ? "typeCustomBox" : "categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  if (isType) updateFormFields();
  else fillCategoryFilter();
}

// 新增一个自定义类型 / 类别；登录后的 HTTP 页面优先同步服务端。
async function addCustom(kind) {
  const input = document.getElementById("customInput");
  const name = (input.value || "").trim();
  const isType = (kind === "type");
  if (!name) {
    await appNotice(isType ? "请先输入新类型名称" : "请先输入新类别名称");
    return;
  }
  const list = isType ? allTypes() : allCategories();
  if (list.includes(name)) {
    await appNotice("「" + name + "」已经存在了");
    return;
  }

  const confirmButton = document.getElementById("customOk");
  if (confirmButton) confirmButton.disabled = true;
  let backendItem = null;
  let backendFallback = false;
  try {
    if (customOptionsBackendEnabled()) {
      backendItem = isType
        ? await backendApi.createRecordType({
          code: customTypeCode(name),
          name,
          behavior: uiState.customTypeSideDraft
        })
        : await backendApi.createCategory({ name });
      if (!backendItem || !backendItem.id) throw new Error("custom_option_response_invalid");
    }
  } catch (error) {
    if (error && error.code && error.code !== "backend_request_failed") {
      await appNotice(userFacingError(error, "服务端拒绝了这个自定义选项"));
      if (confirmButton) confirmButton.disabled = false;
      return;
    }
    backendFallback = true;
  }
  finishCustomAdd(kind, name, backendItem);
  if (backendFallback || (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange())) {
    if (typeof markLocalChangePending === "function") markLocalChangePending(isType ? "type_write" : "category_write");
  }
  if (typeof showMsg === "function" && backendFallback) {
    showMsg("服务端暂不可用，已保存到本地，恢复网络后可迁移", "local");
  } else if (typeof showMsg === "function" && backendItem) {
    showMsg("自定义选项已同步服务端", "success");
  }
  if (confirmButton) confirmButton.disabled = false;
}

// 是不是自定义（只有自定义的才能删）
function isCustomType(name) {
  return dataState.customTypes.some(x => (typeof x === "string" ? x : x.name) === name);
}
function isCustomCategory(name) {
  return dataState.customCategories.includes(name);
}

// 删除一个自定义类型 / 类别
async function removeCustom(kind, name) {
  const used = (kind === "type")
    ? dataState.records.filter(r => r.type === name).length
    : dataState.records.filter(r => r.category === name).length;
  let msg = "删除「" + name + "」吗？";
  if (used > 0) {
    msg += (kind === "type")
      ? "\n已有 " + used + " 笔账用它，删除后这些账还在，但不再算收入/支出（变中性）。"
      : "\n已有 " + used + " 笔账用它，删除后这些账还在，只是以后不能再选它。";
  }
  if (!await appConfirm(msg)) return;

  const backendEnabled = customOptionsBackendEnabled();
  const optionId = kind === "type"
    ? backendOptionId(dataState.backendTypeIds, name)
    : backendOptionId(dataState.backendCategoryIds, name);
  let backendFallback = false;
  if (backendEnabled && optionId) {
    try {
      if (kind === "type") await backendApi.deleteRecordType(optionId);
      else await backendApi.deleteCategory(optionId);
    } catch (error) {
      if (error && error.code && error.code !== "backend_request_failed") {
        await appNotice(userFacingError(error, "服务端拒绝删除这个自定义选项"));
        return;
      }
      backendFallback = true;
    }
  }
  if (kind === "type") {
    dataState.customTypes = dataState.customTypes.filter(x => (typeof x === "string" ? x : x.name) !== name);
    saveCustomTypes();
    if (uiState.selectedType === name) uiState.selectedType = null;
  } else {
    dataState.customCategories = dataState.customCategories.filter(c => c !== name);
    delete dataState.customCategoryIcons[name];
    if (dataState.categorySystem) {
      dataState.categorySystem.groups.forEach(group => { group.items = group.items.filter(item => item !== name); });
      if (!dataState.categorySystem.hidden.includes(name)) dataState.categorySystem.hidden.push(name);
      saveCategorySystem();
    }
    saveCustomCategories();
    saveCustomCategoryIcons();
    if (uiState.selectedCategory === name) uiState.selectedCategory = null;
    if (filterState.category === name) {
      filterState.category = "";
      document.getElementById("filterCategorySel").value = "";
    }
  }
  if (backendFallback || (typeof shouldMarkLocalChange === "function" && shouldMarkLocalChange())) {
    if (typeof markLocalChangePending === "function") markLocalChangePending(kind === "type" ? "type_delete" : "category_delete");
  }
  if (kind === "type") delete dataState.backendTypeIds[name];
  else delete dataState.backendCategoryIds[name];
  document.getElementById("typeCustomBox").innerHTML = "";
  document.getElementById("categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  if (kind === "type") updateFormFields();
  if (kind === "category") fillCategoryFilter();
  refreshDetail();
  if (typeof showMsg === "function" && backendFallback) {
    showMsg("服务端暂不可用，已在本地移除；恢复网络后需再次核对", "local");
  }
}
