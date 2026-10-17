// 只在确定时更新原日期字段；不读取或写入账本存储。
let compactCalendar = null;

function calendarDateText(year, month, day = 1) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function calendarMonthCells(year, month) {
  if (!Number.isInteger(year) || year < 100 || year > 9999 || !Number.isInteger(month) || month < 1 || month > 12) return [];
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  return Array.from({ length: offset + days }, (_, index) => index < offset ? "" : calendarDateText(year, month, index - offset + 1));
}

function closeCompactCalendar() {
  if (!compactCalendar) return;
  const { input, app, pageWasInert } = compactCalendar;
  compactCalendar = null;
  document.getElementById("compactCalendarOverlay").hidden = true;
  document.body.classList.remove("calendar-open");
  if (app) app.inert = pageWasInert;
  input.setAttribute("aria-expanded", "false");
  if (input.isConnected) input.focus({ preventScroll: true });
}

function calendarValueAllowed(value) {
  const input = compactCalendar.input;
  return !!value && (!input.min || value >= input.min) && (!input.max || value <= input.max);
}

function renderCompactCalendar() {
  const state = compactCalendar;
  if (!state) return;
  const { year, month, view, input } = state;
  const yearButton = document.getElementById("compactCalendarYear");
  const monthButton = document.getElementById("compactCalendarMonth");
  const grid = document.getElementById("compactCalendarGrid");
  const selected = document.getElementById("compactCalendarSelection");
  const start = Math.max(100, Math.min(9988, year - year % 12));
  yearButton.textContent = view === "years" ? `${start}—${start + 11} 年` : `${year} 年`;
  monthButton.textContent = `${month} 月`;
  monthButton.hidden = input.type === "month" || view === "years";
  grid.className = "compact-calendar-grid " + (view === "days" ? "calendar-days" : "calendar-choices");
  if (view === "days") {
    grid.innerHTML = ["一", "二", "三", "四", "五", "六", "日"].map(day => `<span class="calendar-weekday">${day}</span>`).join("") +
      calendarMonthCells(year, month).map(value => value ? `<button type="button" data-calendar-value="${value}" aria-label="${esc(formatDate(value))}" aria-pressed="${state.value === value}" ${calendarValueAllowed(value) ? "" : "disabled"}>${Number(value.slice(-2))}</button>` : '<span aria-hidden="true"></span>').join("");
  } else if (view === "months") {
    grid.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const value = calendarDateText(year, i + 1).slice(0, 7);
      const allowed = (!input.min || value >= input.min.slice(0, 7)) && (!input.max || value <= input.max.slice(0, 7));
      return `<button type="button" data-calendar-month="${i + 1}" aria-pressed="${state.value.slice(0, 7) === value}" ${allowed ? "" : "disabled"}>${i + 1} 月</button>`;
    }).join("");
  } else {
    grid.innerHTML = Array.from({ length: 12 }, (_, i) => `<button type="button" data-calendar-year="${start + i}" ${(!input.min || start + i >= Number(input.min.slice(0, 4))) && (!input.max || start + i <= Number(input.max.slice(0, 4))) ? "" : "disabled"}>${start + i} 年</button>`).join("");
  }
  selected.textContent = state.value ? (input.type === "month" ? state.value.replace("-", "年") + "月" : formatDate(state.value)) : "尚未选择";
  document.getElementById("compactCalendarConfirm").disabled = !calendarValueAllowed(state.value);
  document.getElementById("compactCalendarClear").hidden = input.required;
}

function openCompactCalendar(input) {
  if (input.disabled || input.readOnly) return;
  if (compactCalendar) closeCompactCalendar();
  if (typeof hideRecordKeyboard === "function") hideRecordKeyboard();
  const value = input.value;
  const seed = value || todayStr();
  const app = document.querySelector(".app");
  compactCalendar = { input, value, year: Number(seed.slice(0, 4)), month: Number(seed.slice(5, 7)),
    view: input.type === "month" ? "months" : "days", bookId: dataState.currentBookId, app, pageWasInert: !!app?.inert };
  const overlay = document.getElementById("compactCalendarOverlay");
  document.getElementById("compactCalendarTitle").textContent = input.getAttribute("aria-label") || input.closest(".field")?.querySelector(".field-label")?.textContent || (input.type === "month" ? "选择月份" : "选择日期");
  overlay.hidden = false;
  input.setAttribute("aria-expanded", "true");
  document.body.classList.add("calendar-open");
  renderCompactCalendar();
  document.getElementById("compactCalendarCancel").focus({ preventScroll: true });
  if (app) app.inert = true;
}

function commitCompactCalendar(clear = false) {
  const state = compactCalendar;
  if (!state || (clear ? state.input.required : !calendarValueAllowed(state.value))) return;
  const valid = state.input.isConnected && !state.input.disabled && String(state.bookId) === String(dataState.currentBookId);
  closeCompactCalendar();
  if (!valid) return;
  state.input.value = clear ? "" : state.value;
  state.input.dispatchEvent(new Event("input", { bubbles: true }));
  state.input.dispatchEvent(new Event("change", { bubbles: true }));
}

function bindCompactCalendar() {
  const overlay = document.getElementById("compactCalendarOverlay");
  document.querySelectorAll('input[type="date"], input[type="month"]').forEach(input => {
    input.setAttribute("aria-haspopup", "dialog");
    input.setAttribute("aria-expanded", "false");
  });
  const isDate = target => target.matches?.('input[type="date"], input[type="month"]');
  // 阻止系统日期弹窗，仍保留原生字段类型、校验和现有 onchange 逻辑。
  document.addEventListener("pointerdown", event => { if (isDate(event.target) && !event.target.disabled && !event.target.readOnly) event.preventDefault(); }, true);
  document.addEventListener("click", event => {
    if (!isDate(event.target)) return;
    event.preventDefault();
    openCompactCalendar(event.target);
  }, true);
  overlay.addEventListener("click", event => {
    if (event.target === overlay || event.target.closest("#compactCalendarCancel")) return closeCompactCalendar();
    if (!compactCalendar) return;
    if (event.target.closest("#compactCalendarConfirm")) return commitCompactCalendar();
    if (event.target.closest("#compactCalendarClear")) return commitCompactCalendar(true);
    const target = event.target.closest("button");
    if (!target || target.disabled) return;
    if (target.dataset.calendarValue) compactCalendar.value = target.dataset.calendarValue;
    else if (target.dataset.calendarYear) {
      compactCalendar.year = Number(target.dataset.calendarYear);
      compactCalendar.view = "months";
    } else if (target.dataset.calendarMonth) {
      compactCalendar.month = Number(target.dataset.calendarMonth);
      if (compactCalendar.input.type === "month") compactCalendar.value = calendarDateText(compactCalendar.year, compactCalendar.month).slice(0, 7);
      else compactCalendar.view = "days";
    } else if (target.id === "compactCalendarYear") compactCalendar.view = compactCalendar.view === "years" ? (compactCalendar.input.type === "month" ? "months" : "days") : "years";
    else if (target.id === "compactCalendarMonth") compactCalendar.view = compactCalendar.view === "months" ? "days" : "months";
    else if (target.dataset.calendarStep) {
      const step = Number(target.dataset.calendarStep);
      if (compactCalendar.view === "years") compactCalendar.year = Math.max(100, Math.min(9999, compactCalendar.year + 12 * step));
      else if (compactCalendar.view === "months") compactCalendar.year = Math.max(100, Math.min(9999, compactCalendar.year + step));
      else {
        const next = new Date(compactCalendar.year, compactCalendar.month - 1 + step, 1);
        if (next.getFullYear() >= 100 && next.getFullYear() <= 9999) { compactCalendar.year = next.getFullYear(); compactCalendar.month = next.getMonth() + 1; }
      }
    }
    renderCompactCalendar();
    if (!overlay.contains(document.activeElement)) document.getElementById("compactCalendarYear").focus({ preventScroll: true });
  });
  document.addEventListener("keydown", event => {
    if (compactCalendar) {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); closeCompactCalendar(); }
      else if (event.key === "Tab") {
        const controls = Array.from(overlay.querySelectorAll("button:not([disabled])")).filter(item => !item.hidden && item.getClientRects().length);
        const first = controls[0], last = controls.at(-1);
        if (!overlay.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    } else if (isDate(event.target) && ["Enter", " ", "ArrowDown"].includes(event.key)) { event.preventDefault(); openCompactCalendar(event.target); }
  }, true);
}
