# JSON 与本地保存

日期：2026-10-18。当前课次只学习代码里的数据转换，不读取或修改手机、家人的账本。

## JSON 是什么

程序运行中的记录通常是 JavaScript 对象和数组。JSON 是一种便于保存、传递的文本格式，可以把这些数据写成文字，再解析回程序可用的对象和数组。

例如对象 `{ type: "支出", amountCents: 1800 }` 序列化后会成为 JSON 文本：

```json
{"type":"支出","amountCents":1800}
```

JSON 是表示数据的格式。导出文件后，必须传给另一台设备并在那里导入，数据才会迁移；文件本身不会随原设备新增账目自动更新。

## 保存时：对象变成文本

`js/storage.js` 中的 `save()`：

```js
function save() {
  dataState.records = normalizeRecords(dataState.records);
  appStorage.set(recordsKey(dataState.currentBookId), JSON.stringify(dataState.records));
}
```

这段整体负责保存当前账本记录：先整理记录格式，再用 `JSON.stringify` 把数组转成 JSON 字符串，最后把文本交给 `appStorage.set` 写入当前账本对应的存储位置。

`appStorage` 是统一存储入口；本节先看它的调用职责，不展开 Android SQLite 桥接细节。

## 加载时：文本还原为对象

```js
function load() {
  try {
    const raw = appStorage.get(recordsKey(dataState.currentBookId));
    dataState.records = raw ? normalizeRecords(JSON.parse(raw)) : [];
  } catch (e) {
    dataState.records = [];
  }
}
```

读取流程反过来：`appStorage.get` 取回文本，`JSON.parse` 把文本解析为数组和对象，`normalizeRecords` 再整理成当前程序能使用的记录结构。结果放进运行中的 `dataState.records`。

如果没有保存内容，程序初始化空数组；如果文本解析失败，catch 会避免启动时直接因异常中断，并在内存中暂设为空数组。异常兜底不等于成功恢复，也不能据此断言损坏内容已被修好。

## 把流程串起来

```text
运行中的对象数组
  → JSON.stringify
  → JSON 文本交给 appStorage 保存
  → 程序再次读取 JSON 文本
  → JSON.parse
  → 规范记录后放入 dataState
```

这说明“变量数组”“存储文本”“导出备份”处在不同步骤。保存一份 JSON 只包含导出时的数据快照；持续同步需要额外的同步机制。

## 一个练习

在保存代码里，`JSON.stringify` 和 `appStorage.set` 分别负责什么？用一句话描述即可。

用户答案待记录。
