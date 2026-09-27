// 记一笔专用数字键盘：金额输入和简单四则计算都在应用内完成。

let recordKeyboardExpression = "";
let recordKeyboardVisible = false;

function recordAmountInput() {
  return document.getElementById("amount");
}

function normalizeAmountExpression(value) {
  return String(value || "")
    .replace(/[＋]/g, "+")
    .replace(/[−]/g, "-")
    .replace(/[×]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/\s+/g, "");
}

function tokenizeAmountExpression(value) {
  const source = normalizeAmountExpression(value);
  if (!source) return [];
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+|[+\-*/()])/g);
  if (!tokens || tokens.join("") !== source) return null;
  return tokens;
}

// 不使用 eval：用递归下降解析器支持 +、−、×、÷ 和括号。
function evaluateAmountExpression(value) {
  const tokens = tokenizeAmountExpression(value);
  if (!tokens || tokens.length === 0) return null;
  let cursor = 0;

  function parsePrimary() {
    const token = tokens[cursor];
    if (token === "+" || token === "-") {
      cursor += 1;
      const operand = parsePrimary();
      return operand === null ? null : (token === "-" ? -operand : operand);
    }
    if (token === "(") {
      cursor += 1;
      const valueInParentheses = parseExpression();
      if (tokens[cursor] !== ")") return null;
      cursor += 1;
      return valueInParentheses;
    }
    if (!token || !/^\d*\.?\d+$/.test(token)) return null;
    cursor += 1;
    const number = Number(token);
    return Number.isFinite(number) ? number : null;
  }

  function parseTerm() {
    let valueInTerm = parsePrimary();
    if (valueInTerm === null) return null;
    while (cursor < tokens.length && (tokens[cursor] === "*" || tokens[cursor] === "/")) {
      const operator = tokens[cursor++];
      const right = parsePrimary();
      if (right === null || (operator === "/" && right === 0)) return null;
      valueInTerm = operator === "*" ? valueInTerm * right : valueInTerm / right;
      if (!Number.isFinite(valueInTerm)) return null;
    }
    return valueInTerm;
  }

  function parseExpression() {
    let valueInExpression = parseTerm();
    if (valueInExpression === null) return null;
    while (cursor < tokens.length && (tokens[cursor] === "+" || tokens[cursor] === "-")) {
      const operator = tokens[cursor++];
      const right = parseTerm();
      if (right === null) return null;
      valueInExpression = operator === "+" ? valueInExpression + right : valueInExpression - right;
      if (!Number.isFinite(valueInExpression)) return null;
    }
    return valueInExpression;
  }

  const result = parseExpression();
  return cursor === tokens.length && Number.isFinite(result) ? result : null;
}

function recordAmountValue() {
  const input = recordAmountInput();
  if (!input) return null;
  const source = recordKeyboardExpression || input.value;
  return evaluateAmountExpression(source);
}

function dispatchRecordAmountInput() {
  const input = recordAmountInput();
  if (input) input.dispatchEvent(new Event("input", { bubbles: true }));
}

function formatRecordKeyboardNumber(value) {
  const rounded = Math.round((Number(value) + Number.EPSILON) * 100) / 100;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function readableRecordKeyboardExpression(value) {
  return normalizeAmountExpression(value)
    .replace(/\*/g, "×")
    .replace(/\//g, "÷")
    .replace(/\+/g, "＋")
    .replace(/-/g, "−");
}

function syncRecordAmountVisual(input) {
  const visual = document.getElementById("recordAmountVisual");
  const text = document.getElementById("recordAmountVisualText");
  if (!visual || !text) return;
  const value = String(input.value || "");
  visual.classList.toggle("is-empty", !value);
  text.textContent = value || "请输入金额";
}

function updateRecordAmountDisplay() {
  const input = recordAmountInput();
  const expressionBox = document.getElementById("recordAmountExpression");
  if (!input) return;
  const expression = recordKeyboardExpression;
  if (!expression) {
    input.value = "";
    syncRecordAmountVisual(input);
    if (expressionBox) {
      expressionBox.hidden = true;
      expressionBox.textContent = "";
    }
    return;
  }
  const result = evaluateAmountExpression(expression);
  const resultText = result === null ? null : formatRecordKeyboardNumber(result);
  const fallback = (expression.match(/(?:\d*\.?\d+)$/) || ["", expression])[0];
  input.value = resultText || fallback || expression;
  syncRecordAmountVisual(input);
  if (expressionBox) {
    const shouldShow = recordKeyboardVisible && (!resultText || resultText !== expression);
    expressionBox.hidden = !shouldShow;
    expressionBox.textContent = shouldShow ? readableRecordKeyboardExpression(expression) : "";
  }
}

function setRecordKeyboardExpression(value) {
  recordKeyboardExpression = String(value || "");
  updateRecordAmountDisplay();
  dispatchRecordAmountInput();
}

function syncRecordKeyboardTypeButtons() {
  document.querySelectorAll("[data-record-keyboard-type]").forEach(button => {
    const selected = button.dataset.recordKeyboardType === uiState.selectedType;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function showRecordKeyboard() {
  const keyboard = document.getElementById("recordKeyboard");
  const openButton = document.getElementById("recordKeyboardOpenBtn");
  const input = recordAmountInput();
  if (!keyboard || !input) return;
  if (!recordKeyboardExpression) recordKeyboardExpression = input.value || "";
  keyboard.hidden = false;
  if (openButton) openButton.hidden = true;
  recordKeyboardVisible = true;
  document.body.classList.add("record-keyboard-open");
  updateRecordAmountDisplay();
  syncRecordKeyboardTypeButtons();
}

function hideRecordKeyboard() {
  const keyboard = document.getElementById("recordKeyboard");
  const openButton = document.getElementById("recordKeyboardOpenBtn");
  if (keyboard) keyboard.hidden = true;
  if (openButton) openButton.hidden = uiState.activeTab !== "record";
  recordKeyboardVisible = false;
  document.body.classList.remove("record-keyboard-open");
  updateRecordAmountDisplay();
}

function resetRecordKeyboard() {
  recordKeyboardExpression = "";
  hideRecordKeyboard();
}

function appendRecordKeyboardDigit(digit) {
  let expression = recordKeyboardExpression;
  if (expression === "0") expression = "";
  setRecordKeyboardExpression(expression + digit);
}

function appendRecordKeyboardDecimal() {
  const expression = recordKeyboardExpression;
  const currentNumber = expression.split(/[+\-*/()]/).pop() || "";
  if (currentNumber.includes(".")) return;
  setRecordKeyboardExpression(expression && !/[+\-*/(]$/.test(expression)
    ? expression + "."
    : expression + "0.");
}

function appendRecordKeyboardOperator(operator) {
  let expression = recordKeyboardExpression;
  if (!expression && operator !== "-") return;
  if (/[+\-*/]$/.test(expression)) expression = expression.slice(0, -1);
  if (expression.endsWith(".")) expression += "0";
  setRecordKeyboardExpression(expression + operator);
}

async function confirmRecordKeyboardExpression() {
  const result = evaluateAmountExpression(recordKeyboardExpression);
  if (result === null || result < 0) {
    if (typeof showMsg === "function") showMsg("请输入正确的金额或计算式");
    return;
  }
  const rounded = Math.round((result + Number.EPSILON) * 100) / 100;
  setRecordKeyboardExpression(String(rounded));
  hideRecordKeyboard();
  if (typeof handleSave === "function") await handleSave();
}

function handleRecordKeyboardKey(key) {
  if (/^\d$/.test(key)) appendRecordKeyboardDigit(key);
  else if (key === ".") appendRecordKeyboardDecimal();
  else if (key === "plus") appendRecordKeyboardOperator("+");
  else if (key === "minus") appendRecordKeyboardOperator("-");
  else if (key === "backspace") setRecordKeyboardExpression(recordKeyboardExpression.slice(0, -1));
  else if (key === "confirm") confirmRecordKeyboardExpression();
}

document.querySelectorAll("[data-record-key]").forEach(button => {
  button.onclick = () => handleRecordKeyboardKey(button.dataset.recordKey);
});
document.querySelectorAll("[data-record-keyboard-type]").forEach(button => {
  button.onclick = () => chooseRecordType(button.dataset.recordKeyboardType);
});
const recordKeyboardHandle = document.getElementById("recordKeyboardHandle");
if (recordKeyboardHandle) recordKeyboardHandle.onclick = hideRecordKeyboard;
const recordKeyboardOpenButton = document.getElementById("recordKeyboardOpenBtn");
if (recordKeyboardOpenButton) recordKeyboardOpenButton.onclick = () => {
  showRecordKeyboard();
  const input = recordAmountInput();
  if (input) input.focus({ preventScroll: true });
};
const amountInput = recordAmountInput();
const recordAmountTapTarget = document.getElementById("recordAmountTapTarget");
if (recordAmountTapTarget) recordAmountTapTarget.addEventListener("click", event => {
  if (event.target === amountInput) return;
  if (amountInput) amountInput.focus({ preventScroll: true });
});
if (amountInput) {
  amountInput.addEventListener("focus", showRecordKeyboard);
  amountInput.addEventListener("click", showRecordKeyboard);
  amountInput.addEventListener("keydown", event => {
    if (/^\d$/.test(event.key) || [".", "+", "-", "Backspace", "Enter"].includes(event.key)) {
      event.preventDefault();
      if (/^\d$/.test(event.key)) handleRecordKeyboardKey(event.key);
      else if (event.key === ".") handleRecordKeyboardKey(".");
      else if (event.key === "+") handleRecordKeyboardKey("plus");
      else if (event.key === "-") handleRecordKeyboardKey("minus");
      else if (event.key === "Backspace") handleRecordKeyboardKey("backspace");
      else if (event.key === "Enter") handleRecordKeyboardKey("confirm");
    }
  });
}
document.addEventListener("focusin", event => {
  if (!recordKeyboardVisible || !event.target.closest || !event.target.closest("#panelRecord")) return;
  if (event.target.id !== "amount" && !event.target.closest("#recordKeyboard")) hideRecordKeyboard();
});
