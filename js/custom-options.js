// 自定义类型与类别：负责按钮渲染、添加、删除和“怎么算”选项。
// 自定义数据保存在 dataState，当前选择和展开状态保存在 uiState。

function renderTypeChips() {
  const box = document.getElementById("typeChips");
  box.innerHTML = "";
  const list = allTypes();
  const collapsed = list.slice(0, COLLAPSE_COUNT);
  let visible = uiState.typesExpanded ? list : collapsed;
  // 选中的那项即使被折叠，也要露出来，方便看清当前选的是什么
  if (!uiState.typesExpanded && uiState.selectedType && list.includes(uiState.selectedType) && !visible.includes(uiState.selectedType)) {
    visible = visible.concat([uiState.selectedType]);
  }
  visible.forEach(t => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    const side = typeSide(t);
    if (side === "income") b.classList.add("chip-income");
    if (side === "expense") b.classList.add("chip-expense");
    if (t === uiState.selectedType) b.classList.add("selected");
    b.textContent = t;
    if (isCustomType(t)) {
      const x = document.createElement("span");
      x.className = "chip-del";
      x.textContent = "×";
      x.title = "删除这个自定义类型";
      x.onclick = (e) => { e.stopPropagation(); removeCustom("type", t); };
      b.appendChild(x);
    }
    b.onclick = () => { uiState.selectedType = t; renderTypeChips(); updateFormFields(); };
    box.appendChild(b);
  });
  if (list.length > COLLAPSE_COUNT) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chip chip-toggle";
    toggle.textContent = uiState.typesExpanded ? "▴ 收起" : "▾ 展开";
    toggle.onclick = () => { uiState.typesExpanded = !uiState.typesExpanded; renderTypeChips(); };
    box.appendChild(toggle);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "chip chip-add";
  add.textContent = "＋自定义";
  add.onclick = () => renderCustomBox("type");
  box.appendChild(add);
}

function renderCategoryChips() {
  const box = document.getElementById("categoryChips");
  box.innerHTML = "";
  const list = allCategories();
  const collapsed = list.slice(0, COLLAPSE_COUNT);
  let visible = uiState.categoriesExpanded ? list : collapsed;
  if (!uiState.categoriesExpanded && uiState.selectedCategory && list.includes(uiState.selectedCategory) && !visible.includes(uiState.selectedCategory)) {
    visible = visible.concat([uiState.selectedCategory]);
  }
  visible.forEach(c => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "chip";
    if (c === uiState.selectedCategory) b.classList.add("selected");
    b.textContent = c;
    if (isCustomCategory(c)) {
      const x = document.createElement("span");
      x.className = "chip-del";
      x.textContent = "×";
      x.title = "删除这个自定义类别";
      x.onclick = (e) => { e.stopPropagation(); removeCustom("category", c); };
      b.appendChild(x);
    }
    b.onclick = () => { uiState.selectedCategory = c; renderCategoryChips(); };
    box.appendChild(b);
  });
  if (list.length > COLLAPSE_COUNT) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "chip chip-toggle";
    toggle.textContent = uiState.categoriesExpanded ? "▴ 收起" : "▾ 展开";
    toggle.onclick = () => { uiState.categoriesExpanded = !uiState.categoriesExpanded; renderCategoryChips(); };
    box.appendChild(toggle);
  }
  const add = document.createElement("button");
  add.type = "button";
  add.className = "chip chip-add";
  add.textContent = "＋自定义";
  add.onclick = () => renderCustomBox("category");
  box.appendChild(add);
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
  }
  box.innerHTML = html;
  const input = document.getElementById("customInput");
  input.focus();
  document.getElementById("customOk").onclick = () => addCustom(kind);
  document.getElementById("customCancel").onclick = () => { box.innerHTML = ""; };
  input.onkeydown = (e) => { if (e.key === "Enter") addCustom(kind); };
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

// 新增一个自定义类型 / 类别
function addCustom(kind) {
  const input = document.getElementById("customInput");
  const name = (input.value || "").trim();
  const isType = (kind === "type");
  if (!name) { alert(isType ? "请先输入新类型名称" : "请先输入新类别名称"); return; }
  const list = isType ? allTypes() : allCategories();
  if (list.includes(name)) { alert("「" + name + "」已经存在了"); return; }
  if (isType) {
    dataState.customTypes.push({ name: name, side: uiState.customTypeSideDraft });
    saveCustomTypes();
    uiState.selectedType = name;
  } else {
    dataState.customCategories.push(name);
    saveCustomCategories();
    uiState.selectedCategory = name;
  }
  document.getElementById(isType ? "typeCustomBox" : "categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  if (isType) updateFormFields();
  else fillCategoryFilter();
}

// 是不是自定义（只有自定义的才能删）
function isCustomType(name) {
  return dataState.customTypes.some(x => (typeof x === "string" ? x : x.name) === name);
}
function isCustomCategory(name) {
  return dataState.customCategories.includes(name);
}

// 删除一个自定义类型 / 类别
function removeCustom(kind, name) {
  const used = (kind === "type")
    ? dataState.records.filter(r => r.type === name).length
    : dataState.records.filter(r => r.category === name).length;
  let msg = "删除「" + name + "」吗？";
  if (used > 0) {
    msg += (kind === "type")
      ? "\n已有 " + used + " 笔账用它，删除后这些账还在，但不再算收入/支出（变中性）。"
      : "\n已有 " + used + " 笔账用它，删除后这些账还在，只是以后不能再选它。";
  }
  if (!confirm(msg)) return;
  if (kind === "type") {
    dataState.customTypes = dataState.customTypes.filter(x => (typeof x === "string" ? x : x.name) !== name);
    saveCustomTypes();
    if (uiState.selectedType === name) uiState.selectedType = null;
  } else {
    dataState.customCategories = dataState.customCategories.filter(c => c !== name);
    saveCustomCategories();
    if (uiState.selectedCategory === name) uiState.selectedCategory = null;
    if (filterState.category === name) {
      filterState.category = "";
      document.getElementById("filterCategorySel").value = "";
    }
  }
  document.getElementById("typeCustomBox").innerHTML = "";
  document.getElementById("categoryCustomBox").innerHTML = "";
  renderTypeChips();
  renderCategoryChips();
  if (kind === "type") updateFormFields();
  if (kind === "category") fillCategoryFilter();
  refreshDetail();
}
