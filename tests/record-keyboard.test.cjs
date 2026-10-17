const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createRuntime } = require("./runtime.cjs");

function createKeyboardRuntime(useResizeObserver = true) {
  const runtime = createRuntime();
  runtime.run(`
    var keyboardMeasuredHeight = 300;
    var keyboardStyleProperties = {};
    var keyboardResizeCallback;
    var keyboardWindowListeners = {};
    window.addEventListener = (name, callback) => { keyboardWindowListeners[name] = callback; };
    globalThis.ResizeObserver = function(callback) {
      keyboardResizeCallback = callback;
      this.observe = () => {};
    };
    var keyboardElements = {
      amount: { value: "", addEventListener() {}, dispatchEvent() {}, focus(options) { this.focusOptions = options; } },
      balancePrincipal: { value: "", addEventListener() {}, dispatchEvent() {}, focus(options) { this.focusOptions = options; } },
      recordAmountExpression: { hidden: true, textContent: "" },
      balancePrincipalExpression: { hidden: true, textContent: "" },
      recordAmountVisual: { classList: { toggle() {} } },
      recordAmountVisualText: { textContent: "" },
      recordAmountTapTarget: { addEventListener(name, callback) { this[name] = callback; } },
      recordKeyboard: { hidden: true, getBoundingClientRect() { return { height: keyboardMeasuredHeight }; } },
    };
    var keyboardTypeButtons = ["支出", "收入", "转账"].map(type => ({
      dataset: { recordKeyboardType: type },
      setAttribute(name, value) { this[name] = value; }
    }));
    document = {
      documentElement: { style: {
        setProperty(name, value) { keyboardStyleProperties[name] = value; },
        removeProperty(name) { delete keyboardStyleProperties[name]; }
      } },
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
  if (!useResizeObserver) runtime.run("ResizeObserver = undefined");
  const keyboardSource = fs.readFileSync(path.resolve(__dirname, "../js/record-keyboard.js"), "utf8");
  runtime.run(keyboardSource);
  return runtime;
}

test("keyboard layout follows measured height and clears its space on hide without changing amounts", () => {
  const runtime = createKeyboardRuntime();
  const stored = runtime.localStorage.toObject();
  runtime.run('uiState.activeTab="record";setRecordKeyboardExpression("12+3");showRecordKeyboard()');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), "312px");
  runtime.run("keyboardMeasuredHeight=421.5;keyboardResizeCallback()");
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), "434px");
  assert.equal(runtime.run("recordKeyboardExpression"), "12+3");
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
  assert.equal(runtime.run("saveCalls"), 0);
  runtime.run("hideRecordKeyboard()");
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), undefined);
  assert.equal(runtime.run("recordKeyboardExpression"), "12+3");
  assert.deepEqual(runtime.localStorage.toObject(), stored);
});

test("older WebViews without ResizeObserver update keyboard space on window resize", () => {
  const runtime = createKeyboardRuntime(false);
  runtime.run("showRecordKeyboard();keyboardMeasuredHeight=264;keyboardWindowListeners.resize()");
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), "276px");
  runtime.run('keyboardMeasuredHeight=330;setRecordKeyboardExpression("10+5")');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), "342px");
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
  runtime.run("hideRecordKeyboard();keyboardWindowListeners.resize()");
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-space"]'), undefined);
  assert.equal(runtime.run("saveCalls"), 0);
});

test("short windows reserve room for the first-row amount without shrinking touch keys", () => {
  const runtime = createKeyboardRuntime();
  runtime.run('window.innerHeight=320;keyboardElements.recordAmountTapTarget.getBoundingClientRect=()=>({top:108,bottom:202});showRecordKeyboard()');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-max-height"]'), "110px");
  runtime.run('window.innerHeight=812;keyboardWindowListeners.resize()');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-max-height"]'), "602px");
  runtime.run('window.innerHeight=320;keyboardElements.recordAmountTapTarget.getBoundingClientRect=()=>({top:116,bottom:263});keyboardWindowListeners.resize()');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-max-height"]'), "49px");
  runtime.run('hideRecordKeyboard()');
  assert.equal(runtime.run('keyboardStyleProperties["--record-keyboard-max-height"]'), undefined);
});

test("refocusing an amount keeps its unfinished calculation and switching fields reads the correct value", () => {
  const runtime = createKeyboardRuntime();
  runtime.run('uiState.activeTab="record";setRecordKeyboardExpression("12+3");showRecordKeyboard();hideRecordKeyboard();keyboardElements.recordAmountTapTarget.click({target:{}});targetRecordKeyboard("amount")');
  assert.equal(runtime.run("recordKeyboardExpression"), "12+3");
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
  runtime.run('keyboardElements.balancePrincipal.value="100";targetRecordKeyboard("balancePrincipal");setRecordKeyboardExpression("100+25");hideRecordKeyboard();keyboardElements.recordAmountTapTarget.click({target:{}})');
  assert.equal(runtime.run("recordKeyboardTargetId"), "amount");
  assert.equal(runtime.run("recordKeyboardExpression"), "15");
  assert.equal(runtime.run("keyboardElements.balancePrincipal.value"), "125");
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
  assert.equal(runtime.run("saveCalls"), 0);
});

test("confirming a valid keyboard amount saves it immediately", async () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`recordKeyboardExpression = "12+3.456"; recordKeyboardVisible = true;`);

  await runtime.run("confirmRecordKeyboardExpression()");

  assert.equal(runtime.run("saveCalls"), 1);
  assert.equal(runtime.run("savedAmount"), "15.46");
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), true);
});

test("top amount keeps its own value while principal arithmetic uses a separate expression", () => {
  const runtime = createKeyboardRuntime();
  const stored = runtime.localStorage.toObject();
  runtime.run('setRecordKeyboardExpression("12+3");showRecordKeyboard()');
  assert.equal(runtime.run('keyboardElements.recordAmountVisualText.textContent'), "15");
  assert.equal(runtime.run('keyboardElements.recordAmountExpression.textContent'), "12＋3");
  runtime.run('keyboardElements.balancePrincipal.value="100";targetRecordKeyboard("balancePrincipal");setRecordKeyboardExpression("100+25")');
  assert.equal(runtime.run('keyboardElements.balancePrincipal.value'), "125");
  assert.equal(runtime.run('keyboardElements.amount.value'), "15");
  assert.equal(runtime.run('keyboardElements.recordAmountVisualText.textContent'), "15");
  assert.equal(runtime.run('keyboardElements.recordAmountExpression.hidden'), true);
  assert.equal(runtime.run('keyboardElements.balancePrincipalExpression.textContent'), "100＋25");
  runtime.run('hideRecordKeyboard()');
  assert.equal(runtime.run('keyboardElements.balancePrincipalExpression.hidden'), true);
  assert.equal(runtime.run('saveCalls'), 0);
  assert.deepEqual(runtime.localStorage.toObject(), stored);
});

test("confirming account principal arithmetic saves the account adjustment", async () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`
    uiState.balanceTargetAccountId = "wechat";
    uiState.selectedType = "余额";
    keyboardElements.amount.value = "120";
    recordKeyboardTargetId = "balancePrincipal";
    recordKeyboardExpression = "100+25.5";
  `);

  await runtime.run("confirmRecordKeyboardExpression()");

  assert.equal(runtime.run("saveCalls"), 1);
  assert.equal(runtime.run("keyboardElements.balancePrincipal.value"), "125.5");
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

test("invalid arithmetic reports beside the active amount field without losing the expression", async () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`
    var fieldErrorCall;
    showRecordFieldError = (message, target) => { fieldErrorCall = { message, target }; };
    targetRecordKeyboard("balancePrincipal");
    setRecordKeyboardExpression("100+");
  `);
  await runtime.run("confirmRecordKeyboardExpression()");
  assert.equal(runtime.run("fieldErrorCall.target"), "balancePrincipal");
  assert.equal(runtime.run("fieldErrorCall.message"), "请输入正确的金额或计算式");
  assert.equal(runtime.run("recordKeyboardExpression"), "100+");
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false);
  assert.equal(runtime.run("saveCalls"), 0);
});

test("field feedback preserves draft and storage, focuses the picker, and clears only its own ARIA description", () => {
  const runtime = createKeyboardRuntime();
  const stored = runtime.localStorage.toObject();
  runtime.run(`
    var fieldListeners = {}, fieldScrolled = false;
    var errorField = {
      appendChild(error) { keyboardElements.recordFieldError = error; },
      addEventListener(name, callback) { fieldListeners[name] = callback; },
      removeEventListener(name) { delete fieldListeners[name]; },
      scrollIntoView() { fieldScrolled = true; }
    };
    var accountErrorTarget = {
      attributes: { "aria-describedby": "accountHelp" }, value: "",
      closest() { return errorField; }, matches() { return true; },
      getAttribute(name) { return this.attributes[name] || null; },
      setAttribute(name, value) { this.attributes[name] = value; },
      removeAttribute(name) { delete this.attributes[name]; },
      focus() { this.focused = true; }
    };
    keyboardElements.accountPickerBtn = accountErrorTarget;
    document.createElement = () => ({
      setAttribute() {}, remove() { delete keyboardElements.recordFieldError; }
    });
    setRecordKeyboardExpression("12+3");showRecordKeyboard();
    showRecordFieldError("请选择账户", "accountPickerBtn");
  `);
  assert.equal(runtime.run("keyboardElements.recordFieldError.textContent"), "请选择账户");
  assert.equal(runtime.run("accountErrorTarget.attributes['aria-invalid']"), "true");
  assert.equal(runtime.run("accountErrorTarget.attributes['aria-describedby']"), "accountHelp recordFieldError");
  assert.equal(runtime.run("accountErrorTarget.focused && fieldScrolled"), true);
  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), true);
  assert.equal(runtime.run("recordKeyboardExpression"), "12+3");
  assert.equal(runtime.run("keyboardElements.amount.value"), "15");
  runtime.run("fieldListeners.change()");
  assert.equal(runtime.run("keyboardElements.recordFieldError"), undefined);
  assert.equal(runtime.run("accountErrorTarget.attributes['aria-invalid']"), undefined);
  assert.equal(runtime.run("accountErrorTarget.attributes['aria-describedby']"), "accountHelp");
  assert.equal(runtime.run("Object.keys(fieldListeners).length"), 0);
  assert.equal(runtime.run("saveCalls"), 0);
  assert.deepEqual(runtime.localStorage.toObject(), stored);
});

test("the amount remains available when the keyboard is closed and reopened", () => {
  const runtime = createKeyboardRuntime();
  runtime.run(`uiState.activeTab = "record"; setRecordKeyboardExpression("12+3"); showRecordKeyboard(); hideRecordKeyboard();`);

  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), true);
  assert.equal(runtime.run("keyboardElements.recordAmountVisualText.textContent"), "15");

  runtime.run("keyboardElements.recordAmountTapTarget.click({target:{}})");

  assert.equal(runtime.run("keyboardElements.recordKeyboard.hidden"), false);
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
