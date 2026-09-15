const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

class MemoryStorage {
  constructor(initialValues = {}) {
    this.values = new Map(
      Object.entries(initialValues).map(([key, value]) => [key, String(value)])
    );
  }

  get length() {
    return this.values.size;
  }

  key(index) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  getItem(key) {
    return this.values.has(String(key)) ? this.values.get(String(key)) : null;
  }

  setItem(key, value) {
    this.values.set(String(key), String(value));
  }

  removeItem(key) {
    this.values.delete(String(key));
  }

  toObject() {
    return Object.fromEntries(this.values);
  }
}

function createRuntime(initialStorage = {}) {
  const localStorage = new MemoryStorage(initialStorage);
  const context = vm.createContext({ window: { localStorage }, console });
  const projectRoot = path.resolve(__dirname, "..");
  const scripts = [
    "js/constants.js",
    "js/state.js",
    "js/helpers.js",
    "js/deposit-form.js",
    "js/storage-adapter.js",
    "js/migrations.js",
    "js/storage.js",
    "js/api-client.js",
    "js/records.js",
    "js/backup.js",
    "js/record-form.js",
    "js/book-form.js",
    "js/account-form.js"
  ];

  scripts.forEach(relativePath => {
    const absolutePath = path.join(projectRoot, relativePath);
    const source = fs.readFileSync(absolutePath, "utf8");
    vm.runInContext(source, context, { filename: absolutePath });
  });

  return {
    localStorage,
    run(source) {
      return vm.runInContext(source, context);
    }
  };
}

module.exports = { MemoryStorage, createRuntime };
