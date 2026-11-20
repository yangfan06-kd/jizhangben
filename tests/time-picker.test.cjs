const test = require("node:test");
const assert = require("node:assert/strict");
const { createRuntime } = require("./runtime.cjs");

function createFormRuntime() {
  const runtime = createRuntime({});
  runtime.run(`
    globalThis.formElements = {};
    globalThis.document = {
      getElementById(id) {
        if (!formElements[id]) formElements[id] = { value: "", textContent: "", classList: { toggle() {} } };
        return formElements[id];
      }
    };
    uiState.editingRecordId = null;
  `);
  return runtime;
}

test("时间选择：默认显示当前时间，选中后显示所选时间", () => {
  const runtime = createFormRuntime();
  runtime.run("setRecordTimeField('')");
  assert.match(runtime.run("formElements.recordTimeText.textContent"), /^\d{2}:\d{2}$/);
  assert.equal(runtime.run("formElements.recordTime.value"), "");

  runtime.run("setRecordTimeField('21:05')");
  assert.equal(runtime.run("formElements.recordTime.value"), "21:05");
  assert.equal(runtime.run("formElements.recordTimeText.textContent"), "21:05");
});

test("时间选择：编辑旧账目没有时间时显示未记录，非法值不写入", () => {
  const runtime = createFormRuntime();
  runtime.run("uiState.editingRecordId = 66; setRecordTimeField('')");
  assert.equal(runtime.run("formElements.recordTimeText.textContent"), "未记录");

  runtime.run("setRecordTimeField('25:00')");
  assert.equal(runtime.run("formElements.recordTime.value"), "");
  assert.equal(runtime.run("formElements.recordTimeText.textContent"), "未记录");
});

test("时间选择：滚轮索引和文案换算", () => {
  const runtime = createFormRuntime();
  assert.equal(runtime.run("timeWheelIndex({ scrollTop: 21 * 38, children: { length: 24 } })"), 21);
  assert.equal(runtime.run("timeWheelIndex({ scrollTop: -30, children: { length: 24 } })"), 0);
  assert.equal(runtime.run("timeWheelIndex({ scrollTop: 99 * 38, children: { length: 24 } })"), 23);
  assert.equal(runtime.run("timePickerTimeText(7, 5)"), "07:05");
  assert.equal(runtime.run("timePickerTimeText(23, 59)"), "23:59");
});
