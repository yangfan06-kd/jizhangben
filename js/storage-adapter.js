// 存储适配层：为业务模块提供统一的键值存储接口。
// 以后切换到 IndexedDB 或后端 API 时，优先替换这里，而不是逐个修改业务模块。

const appStorage = {
  get(key) {
    return window.localStorage.getItem(key);
  },

  set(key, value) {
    window.localStorage.setItem(key, value);
  },

  remove(key) {
    window.localStorage.removeItem(key);
  },

  entries(prefix = "") {
    const result = {};
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && key.indexOf(prefix) === 0) result[key] = window.localStorage.getItem(key);
    }
    return result;
  },

  removeMany(keys) {
    keys.forEach(key => this.remove(key));
  },

  setMany(entries) {
    Object.entries(entries).forEach(([key, value]) => this.set(key, value));
  }
};
