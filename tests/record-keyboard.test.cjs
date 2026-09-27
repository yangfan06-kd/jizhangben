const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime.cjs");

function createKeyboardRuntime() {
  const runtime = createRuntime();
  runtime.run(`
    var keyboardElements = {
      amount: { value: "", addEventListener() {}, dispatchEvent() {}, focus(options) { this.focusOptions = options; } },
      recordAmountExpression: { hidden: true, textContent: "" },
      recordKeyboard: { hidden: true },
      recordKeyboardOpenBtn: { hidden: true }
    };
    var keyboardTypeButtons = ["支出", "收入", "转账"].map(type => ({
      dataset: { recordKeyboardType: type },
      setAttribute(name, value) { this[name] = value; }
    }));
    document = {
      body: { classList: { add() {}, remove() {} } },
      getElementById(id) { return keyboardElements[id] || null; },
      querySelectorAll(selector) { return selector === "[data-record-keyboard-type]" ? keyboardTypeButtons : []; },
      addEventListener() {}
    };
    Event = function Event(type, options) { this.type = type; this.bubbles = !!(options && options.bubbles); };
    var saveCalls = 0;
    var savedAmount = null;
    var shownMessage = "";
    handleSave = async function() {
      saveCalls += 1;
      savedAmount = keyboardElements.amount.value;
    };
    showMsg = function(message) { shownMessage = message; };
  `);
  const keyboardSource = fs.readFileSync(path.resolve(__dirname, "../js/record-keyboard.js"), "utf8");
  runtime.run(keyboardSource);
  return runtime;
}

test("confirming a valid keyboard amount saves it immediately", async () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`recordKeyboardExpression = "12+3.456"; recordKeyboardVisible = true;`);

  await runtime.run("confirmRecordKeyboardExpression()");

  assert.equal(runtime.run("saveCalls"), 1);
  assert.equal(runtime.run("savedAmount"), "15.46");
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), true);
});

test("an invalid keyboard expression stays open and is not saved", async () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`recordKeyboardExpression = "12+"; recordKeyboardVisible = true; keyboardElements.recordKeyboard.hidden = false;`);

  await runtime.run("confirmRecordKeyboardExpression()");

  assert.equal(runtime.run("saveCalls"), 0);
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false);
  assert.equal(runtime.run("shownMessage"), "请输入正确的金额或计算式");
});

test("the amount remains available when the keyboard is closed and reopened", () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`uiState.activeTab = "record"; setRecordKeyboardExpression("12+3"); showRecordKeyboard(); hideRecordKeyboard();`);

  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), true);
  assert.equal(runtime.run("keyboardElements.recordKeyboardOpenBtn.hidden"), false);

  runtime.run("recordKeyboardOpenButton.onclick()");

  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false);
  assert.equal(runtime.run("keyboardElements.recordKeyboardOpenBtn.hidden"), true);
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
});

test("each top-level type reopens the keyboard without saving or losing the amount", () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`
    function makeTypeElement() {
      return {
        children: [], classList: { add() {} },
        setAttribute() {}, appendChild(child) { this.children.push(child); },
        set innerHTML(value) { this.children = []; }
      };
    }
    document.createElement = makeTypeElement;
    keyboardElements.typeChips = makeTypeElement();
    keyboardElements.accountSel = { value: "wechat" };
    dataState.accounts = [{ id: "wechat", name: "微信" }];
    dataState.customTypes = [{ name: "自定义主类", side: "expense" }];
    renderCategoryChips = function() {};
    var fieldsUpdatedFor = null;
    updateFormFields = function() { fieldsUpdatedFor = uiState.selectedType; };
    uiState.activeTab = "record";
    uiState.selectedType = "支出";
    uiState.selectedCategory = "餐饮";
    setRecordKeyboardExpression("12+3");
    renderTypeChips();
  `);
  const types = JSON.parse(runtime.run("JSON.stringify(allTypes())"));
  for (const type of types) {
    runtime.run(`
      hideRecordKeyboard();
      keyboardElements.typeChips.children.find(button => button.textContent === ${JSON.stringify(type)}).onclick();
    `);
    assert.equal(runtime.run("uiState.selectedType"), type);
    assert.equal(runtime.run("fieldsUpdatedFor"), type);
    assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false, type);
    assert.equal(runtime.run("keyboardElements.amount.focusOptions.preventScroll"), true);
    assert.equal(runtime.run("recordKeyboardExpression"), "12+3");
    assert.equal(runtime.run("keyboardElements.amount.value"), "15");
    assert.equal(runtime.run("saveCalls"), 0);
    if (type === "收入") {
      assert.equal(runtime.run("keyboardElements.accountSel.value"), "");
      assert.equal(runtime.run("uiState.selectedCategory"), null);
    }
  }
  runtime.run(`hideRecordKeyboard(); keyboardTypeButtons[1].onclick();`);
  assert.equal(runtime.run("uiState.selectedType"), "收入");
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false);
  assert.equal(runtime.run("keyboardTypeButtons[1]['aria-pressed']"), "true");
  assert.equal(runtime.run("saveCalls"), 0);
});
