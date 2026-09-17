const DISALLOWED_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1"
]);

const EXAMPLE_HOSTS = new Set(["example.com", "example.org", "example.net"]);
const EXAMPLE_SUFFIXES = [".example.com", ".example.org", ".example.net"];

function invalid(message, code) {
  return { ok: false, code, message };
}

function validateReleaseApiBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    return invalid(
      "正式 App 必须设置 JIZHANGBEN_API_BASE_URL，例如 https://你的真实域名/api。",
      "missing"
    );
  }

  const normalized = value.trim().replace(/\/+$/, "");
  let url;
  try {
    url = new URL(normalized);
  } catch {
    return invalid("API 地址不是有效的 URL，请填写完整的 HTTPS 地址。", "invalid-url");
  }

  if (url.protocol !== "https:") {
    return invalid("正式 App 的 API 地址必须使用 HTTPS。", "https-required");
  }

  const hostname = url.hostname.toLowerCase();
  if (DISALLOWED_HOSTS.has(hostname) || EXAMPLE_HOSTS.has(hostname) || EXAMPLE_SUFFIXES.some(suffix => hostname.endsWith(suffix))) {
    return invalid("正式 App 不能连接 localhost、回环地址或示例域名，请替换为真实服务器地址。", "local-or-example");
  }

  const apiPath = url.pathname.replace(/\/+$/, "");
  if (!apiPath.endsWith("/api")) {
    return invalid("API 地址路径必须以 /api 结尾，例如 https://账本.example.cn/api。", "api-path-required");
  }

  if (url.search || url.hash || url.username || url.password) {
    return invalid("API 地址不能包含查询参数、片段或账号密码。", "unsafe-url");
  }

  return { ok: true, value: normalized };
}

if (require.main === module) {
  const result = validateReleaseApiBaseUrl(process.env.JIZHANGBEN_API_BASE_URL);
  if (!result.ok) {
    console.error(result.message);
    process.exitCode = 1;
  } else {
    console.log(`正式 API 地址通过检查：${result.value}`);
  }
}

module.exports = { validateReleaseApiBaseUrl };
