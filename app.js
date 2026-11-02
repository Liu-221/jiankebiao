/* 简课表 —— 界面与交互（v2）
 * 算课表的逻辑都在 engine.js，这里只负责画界面和接手势。
 */
(function () {
  'use strict';

  const HEAD_H = 54;
  const ROW_H = 52;
  const TIME_W = 40;

  const STORE = 'jiankebiao.v2';
  const LEGACY = 'jiankebiao.v1';
  const COLORS = ['#5B8FF9', '#61C0BF', '#F6BD60', '#F28482',
                  '#84A59D', '#9C8CD0', '#8AB17D', '#E08E9C'];
  const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  const WD1 = ['一', '二', '三', '四', '五', '六', '日'];

  const $ = (id) => document.getElementById(id);
  const appEl = $('app');
  const topbarEl = $('topbar');
  const sheetEl = $('sheet');
  const scrimEl = $('scrim');
  const toastEl = $('toast');
  const fileInput = $('fileInput');

  let store = null;
  let view = 'grid';
  let viewTermId = null;
  let week = 1;
  let slotsCache = [];
  let gridHeadH = 44;
  let picked = null;
  let pendingSlot = null;
  let dragState = null;
  let suppressClick = false;
  let imp = null;
  let undoFn = null;
  let toastTimer = null;
  let hideTimer = null;
  let fileHandler = null;
  let confirmFn = null;

  /* ================= 存储 ================= */

  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (raw) {
        const d = JSON.parse(raw);
        if (d && d.version === 2 && Array.isArray(d.terms) && d.terms.length) return d;
      }
    } catch (err) {
      console.warn('主数据读取失败', err);
    }

    // 主数据没了或被写坏了，试试镜像
    try {
      const bak = localStorage.getItem(STORE + '.bak');
      if (bak) {
        const d = JSON.parse(bak);
        if (d && d.version === 2 && Array.isArray(d.terms) && d.terms.length) {
          console.warn('已从本地镜像恢复');
          return d;
        }
      }
    } catch (err2) {
      console.warn('镜像也读不出来', err2);
    }

    try {
      const legacy = localStorage.getItem(LEGACY);
      if (legacy) {
        const o = JSON.parse(legacy);
        if (o && o.term && Array.isArray(o.courses)) return migrate(o);
      }
    } catch (err3) {
      console.warn('旧版数据读取失败', err3);
    }

    return seed();
  }

  function migrate(o) {
    return {
      version: 2,
      activeTermId: 't1',
      periods: o.periods,
      terms: [{
        id: 't1', name: o.term.name, startDate: o.term.startDate,
        totalWeeks: o.term.totalWeeks,
        courses: o.courses, sessions: o.sessions, adjustments: o.adjustments || []
      }],
      settings: { theme: 'auto' }
    };
  }

  function newTerm(name, startDate, totalWeeks) {
    return {
      id: Engine.uid(), name: name, startDate: startDate,
      totalWeeks: totalWeeks, courses: [], sessions: [], adjustments: []
    };
  }

  function seed() {
    const periods = [
      [1, '08:00', '08:45'], [2, '08:55', '09:40'], [3, '10:00', '10:45'], [4, '10:55', '11:40'],
      [5, '14:00', '14:45'], [6, '14:55', '15:40'], [7, '16:00', '16:45'], [8, '16:55', '17:40'],
      [9, '19:00', '19:45'], [10, '19:55', '20:40'], [11, '20:50', '21:35'], [12, '21:45', '22:30']
    ].map((p) => ({ i: p[0], start: p[1], end: p[2] }));

    const courses = [
      ['c1', '高等数学A(一)', '张伟', '教学主楼A203', 0],
      ['c2', '大学英语(二)', '李娜', '文渊楼B305', 1],
      ['c3', '数据结构', '王强', '计算机楼C401', 2],
      ['c4', '计算机网络', '刘洋', '计算机楼C305', 3],
      ['c5', '大学物理', '陈静', '理学楼D102', 4],
      ['c6', '体育(二)', '赵敏', '体育馆', 5],
      ['c7', '线性代数', '孙磊', '教学主楼B105', 6],
      ['c8', '程序设计实验', '王强', '机房E201', 7]
    ].map((c) => ({ id: c[0], name: c[1], teacher: c[2], location: c[3], color: COLORS[c[4]] }));

    const rows = [
      ['s1', 'c1', 1, 1, 2, '1-16周'],
      ['s2', 'c1', 3, 3, 4, '1-16周'],
      ['s3', 'c2', 1, 3, 4, '1-16周(单)'],
      ['s4', 'c2', 4, 5, 6, '1-16周(单)'],
      ['s5', 'c3', 2, 1, 2, '1-16周'],
      ['s6', 'c3', 5, 3, 4, '1-16周'],
      ['s7', 'c4', 2, 3, 4, '1-12周'],
      ['s8', 'c5', 3, 5, 6, '1-16周(双)'],
      ['s9', 'c6', 4, 3, 4, '1-16周'],
      ['s10', 'c7', 5, 1, 2, '1-8周'],
      ['s11', 'c8', 4, 7, 8, '3-16周']
    ];

    const t = newTerm('2026-2027-1', '2026-09-07', 20);
    t.id = 't1';
    t.courses = courses;
    t.sessions = rows.map((r) => ({
      id: r[0], courseId: r[1], weekday: r[2], start: r[3], end: r[4],
      weeks: Engine.parseWeeks(r[5])
    }));

    return {
      version: 2,
      activeTermId: 't1',
      periods: periods,
      terms: [t],
      settings: { theme: 'auto' },
      demo: true
    };
  }

  function save() {
    try {
      store.meta = store.meta || {};
      store.meta.savedAt = new Date().toISOString();
      const raw = JSON.stringify(store);
      localStorage.setItem(STORE, raw);
      // 再存一份镜像：主数据读不出来时还能救一次
      localStorage.setItem(STORE + '.bak', raw);
    } catch (err) {
      toast('保存失败：浏览器存储不可用（无痕模式？）');
    }
  }

  function storageWritable() {
    try {
      const k = '__jkb_test__';
      localStorage.setItem(k, '1');
      const ok = localStorage.getItem(k) === '1';
      localStorage.removeItem(k);
      return ok;
    } catch (err) {
      return false;
    }
  }

  function term() {
    return store.terms.filter((t) => t.id === viewTermId)[0] || store.terms[0];
  }

  function editable() {
    return term().id === store.activeTermId;
  }

  function todayDate() {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }

  function currentWeekOf(t) {
    return Engine.weekOf(t, todayDate());
  }

  function clampWeek(w) {
    return Math.min(Math.max(w || 1, 1), term().totalWeeks);
  }

  /* ================= 通用 ================= */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtMD(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }

  function openSheet(html) {
    sheetEl.innerHTML = html;
    sheetEl.hidden = false;
    scrimEl.hidden = false;
    // 同步重排再上类，避免 rAF 与「关闭」抢时序
    sheetEl.classList.remove('open');
    scrimEl.classList.remove('show');
    void sheetEl.offsetHeight;
    sheetEl.classList.add('open');
    scrimEl.classList.add('show');
  }

  function closeSheet() {
    sheetEl.classList.remove('open');
    scrimEl.classList.remove('show');
    setTimeout(() => {
      if (sheetEl.classList.contains('open')) return;
      sheetEl.hidden = true;
      scrimEl.hidden = true;
      sheetEl.innerHTML = '';
    }, 280);
  }

  function toast(text, undo) {
    $('toastText').textContent = text;
    $('undoBtn').style.display = undo ? '' : 'none';
    undoFn = undo || null;
    clearTimeout(hideTimer);
    toastEl.hidden = false;
    toastEl.classList.remove('show');
    void toastEl.offsetHeight;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, 5000);
  }

  function hideToast() {
    toastEl.classList.remove('show');
    clearTimeout(toastTimer);
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => { toastEl.hidden = true; }, 220);
  }

  function download(name, text, mime) {
    try {
      const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      toast('已生成 ' + name);
    } catch (err) {
      openSheet('<h3>复制到剪贴板</h3><div class="meta">浏览器不允许直接下载，长按全选下面文字复制。</div>' +
        '<textarea class="copybox" rows="10">' + esc(text) + '</textarea>' +
        '<div class="rows"><button class="btn" data-act="close">关闭</button></div>');
    }
  }

  function pickFile(accept, handler) {
    fileHandler = handler;
    fileInput.accept = accept;
    fileInput.value = '';
    fileInput.click();
  }

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f || !fileHandler) return;
    const reader = new FileReader();
    reader.onload = () => {
      const fn = fileHandler;
      fileHandler = null;
      fn(String(reader.result || ''), f.name);
    };
    reader.readAsText(f);
  });

  function confirmSheet(title, text, okText, fn) {
    confirmFn = fn;
    openSheet('<h3>' + esc(title) + '</h3><div class="meta">' + esc(text) + '</div>' +
      '<div class="rows">' +
      '<button class="btn danger" data-act="do-confirm">' + esc(okText) + '</button>' +
      '<button class="btn" data-act="close">取消</button>' +
      '</div>');
  }

  /* ================= 渲染入口 ================= */

  function render() {
    renderTopbar();
    renderTabs();
    if (view === 'grid') renderGrid();
    else if (view === 'today') renderToday();
    else if (view === 'log') renderLog();
    else renderSettings();
  }

  function renderTopbar() {
    if (view === 'grid') {
      const t = term();
      const hist = editable() ? '' : ' · 只读';
      topbarEl.innerHTML =
        '<button class="nav" data-act="prev">‹</button>' +
        '<div class="weekinfo"><div class="wlabel">第 ' + week + ' 周</div>' +
        '<div class="wsub">' + esc(t.name) + hist + '</div></div>' +
        '<button class="nav" data-act="next">›</button>' +
        '<button class="pill" data-act="today">今天</button>';
    } else if (view === 'today') {
      const d = todayDate();
      topbarEl.innerHTML = '<div class="titlebar"><div class="wlabel">今日</div>' +
        '<div class="wsub">' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 周' +
        WD1[(d.getDay() + 6) % 7] + '</div></div>';
    } else if (view === 'log') {
      topbarEl.innerHTML = '<div class="titlebar"><div class="wlabel">调课记录</div>' +
        '<div class="wsub">' + esc(term().name) + '</div></div>';
    } else {
      topbarEl.innerHTML = '<div class="titlebar"><div class="wlabel">设置</div>' +
        '<div class="wsub">本地存储 · 不联网</div></div>';
    }
  }

  function renderTabs() {
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), (el) => {
      el.classList.toggle('active', el.dataset.view === view);
    });
  }

  /* ================= 课表 ================= */

  function renderGrid() {
    const t = term();

    if (!t.courses.length) {
      appEl.innerHTML =
        '<div class="empty">' +
        '<div class="empty-ico">▦</div>' +
        '<h2>还没有课</h2>' +
        '<p>把课表弄进来，三种方式任选一种</p>' +
        '<button class="btn primary" data-act="import-paste">粘贴课表文本</button>' +
        '<button class="btn" data-act="import-html">导入网页文件</button>' +
        '<button class="btn" data-act="add">手动添加</button>' +
        '</div>';
      return;
    }

    let banner = '';
    if (!editable()) {
      banner = '<div class="banner strip">历史学期 · 只读。要修改请到「设置 → 学期」设为当前学期。</div>';
    } else if (picked) {
      banner = '<div class="banner strip">第 ' + week + ' 周：点击目标时段' +
        '<button class="link" data-act="pick-cancel">取消</button></div>';
    }

    if (Engine.isHoliday(t, week)) {
      const dates = Engine.weekDates(t, week);
      appEl.innerHTML = '<div class="banner strip">第 ' + week + ' 周 · 放假</div>' +
        '<div class="pad"><div class="hintbox">这一周放假，没有课。<br>' +
        fmtMD(dates[0]) + ' – ' + fmtMD(dates[6]) + '<br>' +
        '调课记录会保留，收假后自动恢复。</div>' +
        (editable() ? '<button class="btn ghost" data-act="holiday-off" data-week="' + week +
          '">取消这一周放假</button>' : '') +
        '</div>';
      return;
    }

    appEl.innerHTML = banner + '<div class="grid" id="grid"></div>' +
      (editable() ? '<button class="fab" data-act="add">＋</button>' : '');

    if (store.demo && editable()) {
      appEl.insertAdjacentHTML('afterbegin',
        '<div class="demo-tip">这是示例数据，不是你的课表' +
        '<button class="link-btn" data-act="demo-clear">清空</button></div>');
    }

    const grid = $('grid');
    // 有调休角标时表头要高一档，否则放不下第三行
    const ov = Engine.dayOverrides(t, week);
    const hasBadge = Object.keys(ov.off).length > 0 || Object.keys(ov.map).length > 0;
    gridHeadH = hasBadge ? HEAD_H : 44;
    grid.style.gridTemplateColumns = TIME_W + 'px repeat(7, minmax(0, 1fr))';
    grid.style.gridTemplateRows = gridHeadH + 'px repeat(' + store.periods.length + ', ' + ROW_H + 'px)';
    grid.innerHTML = '';

    const dates = Engine.weekDates(t, week);
    const todayWd = (todayDate().getDay() + 6) % 7 + 1;
    const isThisWeek = week === currentWeekOf(t);

    const corner = document.createElement('div');
    corner.style.gridArea = '1 / 1';
    grid.appendChild(corner);

    for (let d = 1; d <= 7; d++) {
      const el = document.createElement('div');
      el.className = 'day-head' + (isThisWeek && d === todayWd ? ' is-today' : '');
      el.style.gridColumn = String(d + 1);
      el.style.gridRow = '1';
      el.innerHTML = '<span>' + WEEKDAYS[d - 1] + '</span>' +
        '<span class="d">' + fmtMD(dates[d - 1]) + '</span>' +
        (ov.off[d] ? '<b class="badge off">假</b>'
          : (ov.map[d] ? '<b class="badge">补' + WD1[ov.map[d] - 1] + '</b>' : ''));
      grid.appendChild(el);
    }

    store.periods.forEach((p, idx) => {
      const el = document.createElement('div');
      el.className = 'time-cell';
      el.style.gridColumn = '1';
      el.style.gridRow = String(idx + 2);
      el.innerHTML = '<span class="p">' + p.i + '</span>' +
        '<span class="t">' + p.start + '</span>' +
        '<span class="te">' + p.end + '</span>';
      grid.appendChild(el);
    });

    for (let p = 0; p < store.periods.length; p++) {
      for (let d = 1; d <= 7; d++) {
        const el = document.createElement('div');
        el.className = 'cell' + (d === 7 ? ' last' : '');
        el.style.gridColumn = String(d + 1);
        el.style.gridRow = String(p + 2);
        el.dataset.day = String(d);
        el.dataset.period = String(p + 1);
        grid.appendChild(el);
      }
    }

    slotsCache = Engine.buildWeek(t, week);
    slotsCache.forEach((slot, i) => {
      if (!slot.course) return;
      const el = document.createElement('div');
      el.className = 'block' + (slot.adjusted ? ' adjusted' : '') +
        (slot.cancelled ? ' cancelled' : '') + (slot.temporary ? ' temp' : '');
      el.style.gridColumn = String(slot.weekday + 1);
      el.style.gridRow = (slot.start + 1) + ' / ' + (slot.end + 2);
      if (!slot.cancelled) el.style.background = slot.course.color;
      el.dataset.i = String(i);
      el.innerHTML = '<div class="bname">' + esc(slot.course.name) + '</div>' +
        '<div class="bloc">' + esc(slot.course.location || '') + '</div>';
      grid.appendChild(el);
    });
  }

  /* ================= 今日 ================= */

  function renderToday() {
    const t = term();
    const w = currentWeekOf(t);
    const d = todayDate();
    const wd = (d.getDay() + 6) % 7 + 1;
    const slots = Engine.buildWeek(t, w).filter((s) => s.weekday === wd);
    slotsCache = slots;

    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const toMin = (s) => {
      const p = String(s).split(':');
      return parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    };

    if (w < 1 || w > t.totalWeeks) {
      appEl.innerHTML = '<div class="pad"><div class="hintbox">今天不在学期内（第 ' + w + ' 周，共 ' +
        t.totalWeeks + ' 周）</div></div>';
      return;
    }
    if (Engine.isHoliday(t, w)) {
      appEl.innerHTML = '<div class="pad"><div class="hintbox">第 ' + w + ' 周放假，今天没有课。</div></div>';
      return;
    }
    const ovToday = t.overrides && t.overrides[Engine.dateKey(d)];
    if (ovToday && ovToday.off) {
      appEl.innerHTML = '<div class="pad"><div class="hintbox">今天调休放假，没有课。</div></div>';
      return;
    }
    if (!slots.length) {
      appEl.innerHTML = '<div class="pad"><div class="hintbox">今天没有课，休息一下。</div></div>';
      return;
    }

    let html = '<div class="pad"><div class="today-head">第 ' + w + ' 周 · 共 ' + slots.length + ' 节' +
      (ovToday && ovToday.weekday ? ' · 按' + WEEKDAYS[ovToday.weekday - 1] + '上课' : '') + '</div>';
    slots.forEach((s, i) => {
      const p1 = store.periods[s.start - 1], p2 = store.periods[s.end - 1];
      if (!p1 || !p2) return;
      const a = toMin(p1.start), b = toMin(p2.end);
      let status = '待上', cls = 'wait';
      if (nowMin >= b) { status = '已结束'; cls = 'done'; }
      else if (nowMin >= a) { status = '进行中'; cls = 'now'; }
      else { status = '还有 ' + Math.max(1, Math.round(a - nowMin)) + ' 分钟'; }

      html += '<div class="tcard' + (s.cancelled ? ' cancelled' : '') + '" data-act="open-slot" data-i="' + i + '">' +
        '<div class="tcard-time">' + p1.start + '<br>' + p2.end + '</div>' +
        '<div class="tcard-main">' +
        '<div class="tcard-name">' + esc(s.course ? s.course.name : '') + '</div>' +
        '<div class="tcard-sub">' + esc((s.course && s.course.location) || '') +
        (s.course && s.course.teacher ? ' · ' + esc(s.course.teacher) : '') + '</div>' +
        '</div>' +
        '<div class="chip ' + cls + '">' + (s.cancelled ? '停课' : status) + '</div>' +
        '</div>';
    });
    html += '</div>';
    appEl.innerHTML = html;
  }

  /* ================= 调课记录 ================= */

  function describeAdjust(a) {
    const t = term();
    const s = t.sessions.filter((x) => x.id === a.sessionId)[0];
    const course = s ? t.courses.filter((c) => c.id === s.courseId)[0] : null;
    const name = course ? course.name : '（已删除的课）';
    const weeks = Engine.weeksOf(a.weeks, t.totalWeeks);
    const range = weeks.length === 1
      ? '第 ' + weeks[0] + ' 周'
      : '第 ' + weeks[0] + '–' + weeks[weeks.length - 1] + ' 周';

    if (a.type === 'cancel') return { name: name, what: '停课', range: range };
    if (a.type === 'swap') return { name: name, what: '与另一门课互换', range: range };
    if (a.type === 'makeup') return { name: '补课', what: WEEKDAYS[a.weekday - 1] + ' ' + a.start + '-' + a.end + ' 节', range: range };

    const from = s ? WEEKDAYS[s.weekday - 1] + ' ' + s.start + '-' + s.end : '';
    return { name: name, what: from + ' → ' + WEEKDAYS[a.weekday - 1] + ' ' + a.start + '-' + a.end, range: range };
  }

  function renderLog() {
    const t = term();
    if (!t.adjustments.length) {
      appEl.innerHTML = '<div class="pad"><div class="hintbox">还没有调过课。在课表页点一门课，选「调课」。</div></div>';
      return;
    }

    const groups = {};
    t.adjustments.forEach((a) => {
      const ws = Engine.weeksOf(a.weeks, t.totalWeeks);
      const key = ws.length ? ws[0] : 1;
      (groups[key] = groups[key] || []).push(a);
    });

    const keys = Object.keys(groups).map(Number).sort((a, b) => b - a);
    let html = '<div class="pad">';
    keys.forEach((k) => {
      html += '<div class="group-title">第 ' + k + ' 周起</div>';
      groups[k].forEach((a) => {
        const d = describeAdjust(a);
        html += '<div class="row-item">' +
          '<div class="ri-main"><div class="ri-title">' + esc(d.name) + '</div>' +
          '<div class="ri-sub">' + esc(d.what) + ' · ' + esc(d.range) + '</div></div>' +
          '<button class="link-btn" data-act="log-del" data-id="' + a.id + '">还原</button>' +
          '</div>';
      });
    });
    html += '<button class="btn ghost" data-act="log-clear">清空全部调课记录</button></div>';
    appEl.innerHTML = html;
  }

  /* ================= 设置 ================= */

  function renderSettings() {
    const t = term();
    const st = Engine.termStats(t);
    const theme = (store.settings && store.settings.theme) || 'auto';
    const remind = (store.settings && typeof store.settings.remind === 'number') ? store.settings.remind : 15;
    const isCur = editable();

    let html = '<div class="pad">';

    html += '<section class="card"><h3>学期</h3>' +
      '<button class="kv" data-act="term-manage"><span>' + esc(t.name) + '</span>' +
      '<span class="muted">' + (isCur ? '当前学期' : '历史学期') + ' ›</span></button>' +
      '<div class="kv static"><span>第 ' + currentWeekOf(t) + ' 周 / 共 ' + t.totalWeeks + ' 周</span>' +
      '<span class="muted">' + st.courses + ' 门课</span></div>' +
      '</section>';

    html += '<section class="card"><h3>导入课表</h3>' +
      '<button class="kv" data-act="import-paste"><span>粘贴课表文本</span><span class="muted">最快 ›</span></button>' +
      '<button class="kv" data-act="import-html"><span>导入网页文件（.html）</span><span class="muted">最准 ›</span></button>' +
      '<button class="kv" data-act="import-csv"><span>导入 CSV 文件</span><span class="muted">›</span></button>' +
      '</section>';

    html += '<section class="card"><h3>数据</h3>' +
      '<button class="kv" data-act="backup-export"><span>导出备份</span><span class="muted">.json ›</span></button>' +
      '<button class="kv" data-act="backup-import"><span>从备份恢复</span><span class="muted">›</span></button>' +
      '<button class="kv" data-act="csv-export"><span>导出 CSV</span><span class="muted">给 Excel ›</span></button>' +
      '<button class="kv" data-act="ics-export"><span>导出到系统日历</span><span class="muted">.ics ›</span></button>' +
      '<button class="kv danger-text" data-act="clear-term"><span>清空本学期数据</span><span class="muted">不可撤销 ›</span></button>' +
      (st.courses > 0 && !(store.meta && store.meta.exportedAt)
        ? '<div class="warn small">还没备份过。浏览器清缓存、换手机、或者系统自动清理，数据会一起没掉。建议现在导出一份。</div>'
        : '') +
      '</section>';

    html += '<section class="card"><h3>课表设置</h3>' +
      '<button class="kv" data-act="period-edit"><span>节次与作息</span><span class="muted">' +
      store.periods.length + ' 节 ›</span></button>' +
      '<button class="kv" data-act="remind-edit"><span>课前提醒</span><span class="muted">' +
      (remind === 0 ? '不提醒' : remind + ' 分钟前') + ' ›</span></button>' +
      '<button class="kv" data-act="holiday-manage"><span>放假周</span><span class="muted">' +
      ((t.holidays || []).length ? (t.holidays.length + ' 周放假') : '未设置') + ' ›</span></button>' +
      '<button class="kv" data-act="override-manage"><span>调休与补班</span><span class="muted">' +
      ((t.overrides && Object.keys(t.overrides).length) ? (Object.keys(t.overrides).length + ' 天') : '未设置') + ' ›</span></button>' +
      '</section>';

    html += '<section class="card"><h3>外观</h3>' +
      '<div class="seg">' +
      '<button data-act="theme" data-theme="auto" class="' + (theme === 'auto' ? 'on' : '') + '">跟随系统</button>' +
      '<button data-act="theme" data-theme="light" class="' + (theme === 'light' ? 'on' : '') + '">浅色</button>' +
      '<button data-act="theme" data-theme="dark" class="' + (theme === 'dark' ? 'on' : '') + '">深色</button>' +
      '</div></section>';

    const canWrite = storageWritable();
    const savedAt = store.meta && store.meta.savedAt
      ? new Date(store.meta.savedAt).toLocaleString('zh-CN', { hour12: false })
      : '—';

    html += '<section class="card about"><h3>关于</h3>' +
      '<p>简课表 v2.1 · 数据只存在这台设备上，不联网、不上传。</p>' +
      '<p class="muted">调课记录 ' + st.adjustments + ' 条 · 排课 ' + st.sessions + ' 条</p>' +
      '<div class="kv static"><span>本机存储</span><span class="muted">' +
      (canWrite ? '可写入' : '不可写入 · 可能在无痕模式') + '</span></div>' +
      '<div class="kv static"><span>上次保存</span><span class="muted">' + esc(savedAt) + '</span></div>' +
      '</section>';

    html += '</div>';
    appEl.innerHTML = html;
  }

  /* ================= 课程详情 ================= */

  function openDetail(slot) {
    if (!slot || !slot.course) return;
    const t = term();
    const c = slot.course;
    const siblings = t.sessions.filter((s) => s.courseId === slot.courseId);
    const spanText = (s) => {
      const a = store.periods[s.start - 1], b = store.periods[s.end - 1];
      return WEEKDAYS[s.weekday - 1] + ' ' + s.start + '-' + s.end + ' 节' +
        (a && b ? '（' + a.start + '–' + b.end + '）' : '');
    };
    const original = siblings.length
      ? siblings.map(spanText).join('，')
      : '临时补课';
    const nowSpan = spanText(slot);

    const adjusted = slot.adjusted || (slot.sessionId && t.adjustments.some(
      (a) => a.sessionId === slot.sessionId && Engine.hasWeek(a.weeks, week)));

    let html = '<h3>' + esc(c.name) + '</h3>' +
      '<div class="meta">' + esc(c.teacher || '教师待定') + ' · ' + esc(c.location || '地点待定') +
      '<br>本周：' + esc(nowSpan) +
      '<br>原安排：' + esc(original) + (adjusted ? '<br>本周已调整' : '') + '</div>';

    html += '<div class="rows">';
    if (editable() && slot.sessionId && !slot.cancelled) {
      html += '<button class="btn primary" data-act="d-move">调课</button>';
      html += '<div class="row">' +
        '<button class="btn" data-act="d-cancel">本周停课</button>' +
        '<button class="btn" data-act="d-restore">还原</button>' +
        '</div>';
      html += '<div class="row">' +
        '<button class="btn" data-act="d-edit">编辑</button>' +
        '<button class="btn danger" data-act="d-delete">删除课程</button>' +
        '</div>';
    } else if (editable() && slot.temporary) {
      html += '<button class="btn danger" data-act="d-del-makeup">删除这次补课</button>';
    }
    html += '<button class="btn" data-act="close">关闭</button></div>';

    sheetEl.dataset.sessionId = slot.sessionId || '';
    sheetEl.dataset.slot = String(slotsCache.indexOf(slot));
    openSheet(html);
  }

  function currentSlot() {
    const i = parseInt(sheetEl.dataset.slot, 10);
    return isNaN(i) ? null : slotsCache[i];
  }

  /* ================= 调课 ================= */

  function startPicking(slot) {
    if (!slot || !slot.sessionId) return;
    picked = { slot: slot };
    closeSheet();
    render();
  }

  function stopPicking() {
    picked = null;
    render();
  }

  function openConfirm(slot, weekday, start) {
    const len = slot.end - slot.start;
    const end = start + len;
    if (end > store.periods.length) {
      toast('放不下：目标节次超出了课表范围');
      return;
    }

    const slots = Engine.buildWeek(term(), week);
    const hits = Engine.conflictsAt(slots, weekday, start, end, slot.sessionId);
    const hit = hits.length ? hits[0] : null;
    const target = WEEKDAYS[weekday - 1] + ' ' + start + '-' + end + ' 节';

    let html = '<h3>把「' + esc(slot.course.name) + '」调到<br>' + target + '</h3>' +
      '<div class="meta">原时段：' + WEEKDAYS[slot.weekday - 1] + ' ' + slot.start + '-' + slot.end + ' 节</div>';

    if (hit) {
      const sameLen = (hit.end - hit.start) === len;
      html += '<div class="warn">与「' + esc(hit.course.name) + '」时间冲突。' +
        (sameLen ? '可以两门课交换。' : '两节课长度不同，换个位置吧。') + '</div>';
      html += '<div class="rows">';
      if (sameLen) {
        html += '<button class="btn primary" data-act="confirm-swap" data-target="' + hit.sessionId + '">与它交换（仅本周）</button>';
      }
      html += '<button class="btn" data-act="close">取消</button></div>';
    } else {
      html += '<div class="rows">' +
        '<button class="btn primary" data-act="confirm-move" data-range="this" data-day="' + weekday + '" data-start="' + start + '">仅本周</button>' +
        '<button class="btn" data-act="confirm-move" data-range="from" data-day="' + weekday + '" data-start="' + start + '">本周起，之后都不变</button>' +
        '<button class="btn" data-act="close">取消</button></div>';
    }

    sheetEl.dataset.sessionId = slot.sessionId;
    pendingSlot = slot;
    openSheet(html);
  }

  function applyMove(slot, weekday, start, range) {
    const end = start + (slot.end - slot.start);
    const weeks = range === 'this'
      ? Engine.weekMask(week, week, 0)
      : Engine.weekMask(week, term().totalWeeks, 0);

    const record = {
      id: Engine.uid(), type: 'move', sessionId: slot.sessionId,
      weekday: weekday, start: start, end: end, weeks: weeks
    };
    term().adjustments.push(record);
    save();
    picked = null;
    closeSheet();
    render();
    toast('已调到 ' + WEEKDAYS[weekday - 1] + ' ' + start + '-' + end + ' 节', () => {
      term().adjustments = term().adjustments.filter((a) => a.id !== record.id);
      save(); render(); toast('已撤销');
    });
  }

  function applySwap(slot, targetSessionId) {
    const record = {
      id: Engine.uid(), type: 'swap', sessionId: slot.sessionId,
      targetSessionId: targetSessionId, weeks: Engine.weekMask(week, week, 0)
    };
    term().adjustments.push(record);
    save();
    picked = null;
    closeSheet();
    render();
    toast('两门课已交换', () => {
      term().adjustments = term().adjustments.filter((a) => a.id !== record.id);
      save(); render(); toast('已撤销');
    });
  }

  function applyCancel(slot) {
    const record = {
      id: Engine.uid(), type: 'cancel', sessionId: slot.sessionId,
      weeks: Engine.weekMask(week, week, 0)
    };
    term().adjustments.push(record);
    save();
    closeSheet();
    render();
    toast('本周已停课', () => {
      term().adjustments = term().adjustments.filter((a) => a.id !== record.id);
      save(); render(); toast('已撤销');
    });
  }

  function restoreSession(slot) {
    const t = term();
    const before = t.adjustments.length;
    t.adjustments = t.adjustments.filter((a) => !(a.sessionId === slot.sessionId && Engine.hasWeek(a.weeks, week)));
    save();
    closeSheet();
    render();
    toast(t.adjustments.length < before ? '已还原成本周原安排' : '本周没有可还原的调整');
  }

  /* ================= 添加 / 编辑课程 ================= */

  function dayOptions(sel) {
    return WEEKDAYS.map((w, i) =>
      '<option value="' + (i + 1) + '"' + (sel === i + 1 ? ' selected' : '') + '>' + w + '</option>').join('');
  }

  function periodOptions(sel) {
    return store.periods.map((p) =>
      '<option value="' + p.i + '"' + (sel === p.i ? ' selected' : '') + '>第 ' + p.i + ' 节 ' + p.start + '</option>').join('');
  }

  function openCourseForm(slot, pre) {
    const t = term();
    const editing = !!slot;
    const c = editing ? slot.course : { name: '', teacher: '', location: '' };
    const session = editing ? t.sessions.filter((s) => s.id === slot.sessionId)[0] : null;
    const dft = {
      weekday: session ? session.weekday : (pre ? pre.weekday : 1),
      start: session ? session.start : (pre ? pre.start : 1),
      end: session ? session.end : (pre ? pre.end : 2)
    };
    const color = c.color || COLORS[t.courses.length % COLORS.length];

    const swatches = COLORS.map((col) =>
      '<button type="button" class="swatch' + (col === color ? ' on' : '') + '"' +
      ' style="background:' + col + '" data-act="pick-color" data-color="' + col + '"' +
      ' aria-label="选择颜色"></button>').join('');

    const html = '<h3>' + (editing ? '编辑课程' : '添加课程') + '</h3>' +
      '<div class="meta">' + (editing ? '改完点保存，所有周都会变。' : '一门课有多个时段就多添加几次；同名课程会自动合并成一门。') + '</div>' +
      '<form data-form="course">' +
      '<div class="field"><label>课程名</label><input name="name" required value="' + esc(c.name) + '" placeholder="高等数学A(一)" autocomplete="off"></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>教师</label><input name="teacher" value="' + esc(c.teacher || '') + '" placeholder="选填"></div>' +
      '<div class="field"><label>地点</label><input name="location" value="' + esc(c.location || '') + '" placeholder="选填"></div>' +
      '</div>' +
      '<div class="field"><label>颜色</label><div class="colors">' + swatches + '</div>' +
      '<input type="hidden" name="color" value="' + color + '"></div>' +
      '<div class="field"><label>星期</label><select name="weekday">' + dayOptions(dft.weekday) + '</select></div>' +
      '<div class="grid2">' +
      '<div class="field"><label>起始节</label><select name="start">' + periodOptions(dft.start) + '</select></div>' +
      '<div class="field"><label>结束节</label><select name="end">' + periodOptions(dft.end) + '</select></div>' +
      '</div>' +
      '<div class="field"><label>周次</label><input name="weeks" value="' +
      (session ? weeksText(session.weeks) : '1-16周') + '" autocomplete="off">' +
      '<div class="hint">例：1-16周 / 1-16周(单) / 2-16周(双) / 1-4,6-9周</div></div>' +
      '<div class="rows">' +
      '<button class="btn primary" type="submit">保存</button>' +
      '<button class="btn" type="button" data-act="close">取消</button>' +
      '</div></form>';

    sheetEl.dataset.sessionId = session ? session.id : '';
    sheetEl.dataset.mode = editing ? 'edit' : 'add';
    openSheet(html);
  }

  function weeksText(mask) {
    const w = Engine.weeksOf(mask, term().totalWeeks);
    if (!w.length) return '1-16周';
    const parts = [];
    let s = w[0], prev = w[0];
    for (let i = 1; i <= w.length; i++) {
      if (w[i] === prev + 1) { prev = w[i]; continue; }
      parts.push(s === prev ? String(s) : s + '-' + prev);
      s = prev = w[i];
    }
    return parts.join(',') + '周';
  }

  function submitCourse(form) {
    if (!editable()) return toast('历史学期只读');
    const f = form.elements;
    const name = f['name'].value.trim();
    const teacher = f['teacher'].value.trim();
    const location = f['location'].value.trim();
    const weekday = parseInt(f['weekday'].value, 10);
    const start = parseInt(f['start'].value, 10);
    const end = parseInt(f['end'].value, 10);
    const weeksRaw = f['weeks'].value.trim();
    const color = f['color'] ? f['color'].value : '';
    const mask = Engine.parseWeeks(weeksRaw);

    if (!name) return toast('课程名不能为空');
    if (end < start) return toast('结束节不能早于起始节');
    if (mask === -1) return toast('周次看不懂，换个写法试试');

    const t = term();
    const mode = sheetEl.dataset.mode;
    const sessionId = sheetEl.dataset.sessionId;

    if (mode === 'edit' && sessionId) {
      const s = t.sessions.filter((x) => x.id === sessionId)[0];
      if (!s) return toast('找不到这条排课');
      const c = t.courses.filter((x) => x.id === s.courseId)[0];
      if (c) { c.name = name; c.teacher = teacher; c.location = location; if (color) c.color = color; }
      s.weekday = weekday; s.start = start; s.end = end; s.weeks = mask;
      save(); closeSheet(); render();
      toast('已保存');
      return;
    }

    let course = t.courses.filter((c) => c.name === name)[0];
    if (!course) {
      course = {
        id: Engine.uid(), name: name, teacher: teacher, location: location,
        color: color || COLORS[t.courses.length % COLORS.length]
      };
      t.courses.push(course);
    } else {
      if (teacher) course.teacher = teacher;
      if (location) course.location = location;
      if (color) course.color = color;
    }
    t.sessions.push({ id: Engine.uid(), courseId: course.id, weekday: weekday, start: start, end: end, weeks: mask });
    store.demo = false;
    save(); closeSheet();
    if (!Engine.hasWeek(mask, week)) week = clampWeek(currentWeekOf(t));
    render();
    toast('已添加「' + name + '」');
  }

  function openCellSheet(day, period) {
    if (!editable()) return;
    const t = term();
    if (!t.courses.length) {
      openCourseForm(null, { weekday: day, start: period, end: period });
      return;
    }
    openSheet('<h3>' + WEEKDAYS[day - 1] + ' 第 ' + period + ' 节</h3>' +
      '<div class="meta">这个时段现在是空的。</div>' +
      '<div class="rows">' +
      '<button class="btn primary" data-act="cell-add" data-day="' + day + '" data-period="' + period + '">在这里加一门课</button>' +
      '<button class="btn" data-act="cell-makeup" data-day="' + day + '" data-period="' + period + '">补一节本周的课</button>' +
      '<button class="btn" data-act="close">关闭</button></div>');
  }

  function openMakeupForm(day, period) {
    const t = term();
    if (!t.courses.length) return toast('先添加一门课，才能补课');
    const opts = t.courses.map((c) => '<option value="' + c.id + '">' + esc(c.name) + '</option>').join('');
    sheetEl.dataset.day = String(day);
    sheetEl.dataset.period = String(period);
    openSheet('<h3>补课</h3>' +
      '<div class="meta">只补第 ' + week + ' 周这一次，不影响之后的课表。</div>' +
      '<form data-form="makeup">' +
      '<div class="field"><label>课程</label><select name="course">' + opts + '</select></div>' +
      '<div class="field"><label>连上几节</label><select name="len">' +
      [1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === 2 ? ' selected' : '') + '>' + n + ' 节</option>').join('') +
      '</select></div>' +
      '<div class="rows"><button class="btn primary" type="submit">补上</button>' +
      '<button class="btn" type="button" data-act="close">取消</button></div></form>');
  }

  function applyMakeup(form) {
    const courseId = form.elements['course'].value;
    const len = parseInt(form.elements['len'].value, 10) || 1;
    const day = parseInt(sheetEl.dataset.day, 10);
    const period = parseInt(sheetEl.dataset.period, 10);
    if (!courseId || !day || !period) return toast('参数不对');

    term().adjustments.push({
      id: Engine.uid(), type: 'makeup', courseId: courseId,
      weekday: day, start: period, end: period + len - 1,
      weeks: Engine.weekMask(week, week, 0)
    });
    save(); closeSheet(); render();
    toast('已补上第 ' + week + ' 周的课');
  }

  function deleteCourse(slot) {
    const t = term();
    const courseId = slot.courseId;
    const ids = t.sessions.filter((s) => s.courseId === courseId).map((s) => s.id);
    t.sessions = t.sessions.filter((s) => s.courseId !== courseId);
    t.adjustments = t.adjustments.filter((a) => ids.indexOf(a.sessionId) === -1);
    t.courses = t.courses.filter((c) => c.id !== courseId);
    save(); closeSheet(); render();
    toast('已删除');
  }

  /* ================= 导入 ================= */

  function importPasteSheet() {
    openSheet(
      '<h3>粘贴课表文本</h3>' +
      '<div class="meta">一行一门课，字段用空格或逗号隔开，顺序随意。<br>' +
      '例：<code>高等数学 张伟 教学主楼A203 周一 1-2 1-16周</code></div>' +
      '<textarea id="pasteBox" class="copybox" rows="6" placeholder="高等数学 张伟 教学主楼A203 周一 1-2 1-16周&#10;大学英语 李娜 文渊楼B305 周三 3-4 1-16周(单)"></textarea>' +
      '<div class="rows">' +
      '<button class="btn primary" data-act="do-parse-paste">解析</button>' +
      '<button class="btn" data-act="close">取消</button>' +
      '</div>');
  }

  function showPreview(result, kind) {
    if (!result.items.length) {
      openSheet('<h3>没解析出课程</h3><div class="meta">' +
        esc(result.warnings.join('；') || '检查一下格式：一行一门课，要有课程名、星期、节次、周次。') +
        '</div><div class="rows"><button class="btn" data-act="close">知道了</button></div>');
      return;
    }
    imp = { items: result.items, kind: kind, warnings: result.warnings || [] };
    renderPreview();
  }

  function renderPreview() {
    let valid = 0;
    imp.items.forEach((it) => { if (it.valid && it.checked !== false) valid++; });

    let rows = '';
    imp.items.forEach((it, i) => {
      if (!it.start) { it.start = 1; it.end = 1; }
      const on = it.checked !== false;
      rows += '<div class="imp-row' + (it.valid ? '' : ' bad') + '">' +
        '<input type="checkbox" data-imp="check" data-i="' + i + '"' + (on ? ' checked' : '') + '>' +
        '<div class="imp-main">' +
        '<div class="imp-name">' + esc(it.name || '（没认出课程名）') + '</div>' +
        '<div class="imp-sub">' + esc([it.teacher, it.location, it.weeksText].filter(Boolean).join(' · ')) + '</div>' +
        '<div class="imp-edit">' +
        '<select data-imp="day" data-i="' + i + '"><option value="0">星期?</option>' + dayOptions(it.weekday) + '</select>' +
        '<span>第</span><select data-imp="start" data-i="' + i + '">' + periodOptions(it.start) + '</select>' +
        '<span>起</span><input type="number" min="1" max="' + store.periods.length + '" value="' + (it.end - it.start + 1) + '" data-imp="len" data-i="' + i + '"><span>节</span>' +
        '</div></div>' +
        '<button class="x" data-act="imp-del" data-i="' + i + '">×</button>' +
        '</div>';
    });

    openSheet(
      '<h3>确认导入</h3>' +
      '<div class="meta">共 ' + imp.items.length + ' 条，将导入 ' + valid + ' 条。' +
      (imp.warnings.length ? '<br>' + esc(imp.warnings.join('；')) : '') + '</div>' +
      '<div class="imp-list">' + rows + '</div>' +
      '<div class="rows">' +
      '<button class="btn primary" data-act="imp-apply"' + (valid ? '' : ' disabled') + '>导入 ' + valid + ' 条</button>' +
      '<button class="btn" data-act="close">取消</button>' +
      '</div>');
  }

  function applyImport() {
    const t = term();
    let added = 0, skipped = 0;
    imp.items.forEach((it) => {
      if (it.checked === false || !it.valid) { skipped++; return; }
      if (Engine.isDuplicate(t, it)) { skipped++; return; }
      let course = t.courses.filter((c) => c.name === it.name)[0];
      if (!course) {
        course = {
          id: Engine.uid(), name: it.name, teacher: it.teacher || '',
          location: it.location || '', color: COLORS[t.courses.length % COLORS.length]
        };
        t.courses.push(course);
      }
      t.sessions.push({
        id: Engine.uid(), courseId: course.id, weekday: it.weekday,
        start: it.start, end: it.end, weeks: Engine.parseWeeks(it.weeksText)
      });
      added++;
    });
    store.demo = false;
    save();
    imp = null;
    closeSheet();
    week = clampWeek(currentWeekOf(t));
    render();
    toast('新增 ' + added + ' 条' + (skipped ? '，跳过 ' + skipped + ' 条' : ''));
  }

  /* ================= 学期 ================= */

  function termSheet() {
    let html = '<h3>学期</h3><div class="meta">当前学期可以编辑，其他学期只读。点一下切换查看。</div>';
    store.terms.forEach((t) => {
      const isActive = t.id === store.activeTermId;
      const isView = t.id === viewTermId;
      html += '<div class="row-item"><div class="ri-main">' +
        '<div class="ri-title">' + esc(t.name) + (isView ? ' · 正在看' : '') + '</div>' +
        '<div class="ri-sub">' + t.courses.length + ' 门课 · 第 ' + Engine.weekOf(t, todayDate()) + ' 周 / ' + t.totalWeeks + ' 周' +
        (isActive ? ' · 当前学期' : '') + '</div></div>' +
        '<div class="ri-actions">' +
        (isView ? '' : '<button class="link-btn" data-act="term-view" data-id="' + t.id + '">查看</button>') +
        (isActive ? '' : '<button class="link-btn" data-act="term-active" data-id="' + t.id + '">设为当前</button>') +
        '<button class="link-btn" data-act="term-edit" data-id="' + t.id + '">编辑</button>' +
        (store.terms.length > 1 ? '<button class="link-btn danger" data-act="term-del" data-id="' + t.id + '">删除</button>' : '') +
        '</div></div>';
    });
    html += '<div class="rows" style="margin-top:14px">' +
      '<button class="btn primary" data-act="term-new">新建学期</button>' +
      '<button class="btn" data-act="close">关闭</button></div>';
    openSheet(html);
  }

  function openTermForm(termObj) {
    const editing = !!termObj;
    const d = todayDate();
    const guess = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
    const t = termObj || { name: '', startDate: guess, totalWeeks: 20 };

    openSheet('<h3>' + (editing ? '编辑学期' : '新建学期') + '</h3>' +
      '<div class="meta">开学日期填**第 1 周的周一**，课表的周次和日期都从这里推算。</div>' +
      '<form data-form="term-save"' + (editing ? ' data-id="' + t.id + '"' : '') + '>' +
      '<div class="field"><label>学期名称</label><input name="name" required value="' + esc(t.name) +
      '" placeholder="2026-2027-1" autocomplete="off"></div>' +
      '<div class="field"><label>开学日期（第 1 周周一）</label>' +
      '<input name="start" type="date" value="' + t.startDate + '" required></div>' +
      '<div class="field"><label>总周数</label>' +
      '<input name="weeks" type="number" min="1" max="31" value="' + t.totalWeeks + '"></div>' +
      '<div class="hint" style="margin:-4px 0 14px">按今天算，这个设置下是**第 ' +
      Math.min(Math.max(Engine.weekOf({ startDate: t.startDate }, todayDate()), 1), t.totalWeeks) +
      ' 周**。改开学日期就能把周次对齐到真实校历。</div>' +
      '<div class="rows"><button class="btn primary" type="submit">' +
      (editing ? '保存' : '创建') + '</button>' +
      '<button class="btn" type="button" data-act="close">取消</button></div></form>');
  }

  function saveTerm(form) {
    const f = form.elements;
    const name = f['name'].value.trim();
    const start = f['start'].value;
    const total = Math.min(Math.max(parseInt(f['weeks'].value, 10) || 20, 1), 31);
    if (!name) return toast('学期名称不能为空');
    if (!start) return toast('请选择开学日期');

    const id = form.dataset.id;
    if (id) {
      const t = store.terms.filter((x) => x.id === id)[0];
      if (!t) return toast('找不到这个学期');

      let maxWeek = 0;
      t.sessions.forEach((s) => {
        const w = Engine.weeksOf(s.weeks, 31);
        if (w.length && w[w.length - 1] > maxWeek) maxWeek = w[w.length - 1];
      });

      const apply = () => {
        t.name = name;
        t.startDate = start;
        t.totalWeeks = total;
        if (term().id === id) week = clampWeek(currentWeekOf(t));
        save();
        closeSheet();
        render();
        toast('已保存 · 现在是第 ' + Engine.weekOf(t, todayDate()) + ' 周');
      };

      if (maxWeek > total) {
        confirmSheet('缩短学期？',
          '有课程排到了第 ' + maxWeek + ' 周，缩短到 ' + total + ' 周之后它们不会再显示。',
          '仍要保存', apply);
        return;
      }
      apply();
      return;
    }

    const t = newTerm(name, start, total);
    store.terms.push(t);
    store.activeTermId = t.id;
    viewTermId = t.id;
    week = clampWeek(currentWeekOf(t));
    save();
    closeSheet();
    render();
    toast('学期已创建，去导入课表吧');
  }

  /* ================= 节次 ================= */

  function periodSheet() {
    let rows = '';
    store.periods.forEach((p, i) => {
      rows += '<div class="p-row"><span class="p-idx">' + p.i + '</span>' +
        '<input type="time" value="' + p.start + '" data-p="start" data-i="' + i + '">' +
        '<input type="time" value="' + p.end + '" data-p="end" data-i="' + i + '">' +
        '</div>';
    });
    openSheet('<h3>节次与作息</h3>' +
      '<div class="meta">共 ' + store.periods.length + ' 节。改完保存，课表左侧和日历导出会一起变。</div>' +
      '<div class="p-list">' + rows + '</div>' +
      '<div class="p-toolbar">' +
      '<button class="btn sm" data-act="period-add">＋ 加一节</button>' +
      '<button class="btn sm" data-act="period-del">－ 减一节</button>' +
      '</div>' +
      '<div class="rows"><button class="btn primary" data-act="period-save">保存</button>' +
      '<button class="btn" data-act="close">取消</button></div>');
  }

  function syncPeriodInputs() {
    Array.prototype.forEach.call(sheetEl.querySelectorAll('input[data-p]'), (inp) => {
      const i = parseInt(inp.dataset.i, 10);
      if (store.periods[i] && inp.value) store.periods[i][inp.dataset.p] = inp.value;
    });
  }

  function addMinutes(hhmm, delta) {
    const p = String(hhmm || '08:00').split(':').map(Number);
    let m = ((p[0] * 60 + (p[1] || 0) + delta) % 1440 + 1440) % 1440;
    return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
  }

  /* ================= 放假周 ================= */

  function holidaySheet() {
    const t = term();
    let rows = '';
    for (let w = 1; w <= t.totalWeeks; w++) {
      const on = Engine.isHoliday(t, w);
      rows += '<label class="h-row"><span>第 ' + w + ' 周</span>' +
        '<input type="checkbox" data-holiday="' + w + '"' + (on ? ' checked' : '') + '></label>';
    }
    openSheet('<h3>放假周</h3>' +
      '<div class="meta">勾上的周不排课、不提醒、不导出到日历。国庆、运动会这类整周不上课的周，在这里勾一下。</div>' +
      '<div class="p-list">' + rows + '</div>' +
      '<div class="rows"><button class="btn primary" data-act="holiday-save">保存</button>' +
      '<button class="btn" data-act="close">取消</button></div>');
  }

  function saveHolidays() {
    const t = term();
    const list = [];
    Array.prototype.forEach.call(sheetEl.querySelectorAll('input[data-holiday]'), (inp) => {
      if (inp.checked) list.push(parseInt(inp.dataset.holiday, 10));
    });
    t.holidays = list.sort((a, b) => a - b);
    save();
    closeSheet();
    render();
    toast(list.length ? '已设置 ' + list.length + ' 个放假周' : '已取消全部放假周');
  }

  /* ================= 调休与补班 ================= */

  function overrideSheet() {
    const t = term();
    const ov = t.overrides || {};
    const keys = Object.keys(ov).sort();
    let list = '';
    if (!keys.length) {
      list = '<div class="hintbox" style="margin-bottom:12px">还没有单日调整。</div>';
    } else {
      keys.forEach((k) => {
        const o = ov[k];
        const label = o.off ? '放假' : ('按' + WEEKDAYS[o.weekday - 1] + '的课表上课');
        list += '<div class="row-item"><div class="ri-main"><div class="ri-title">' + k + '</div>' +
          '<div class="ri-sub">' + label + '</div></div>' +
          '<button class="link-btn" data-act="ov-del" data-key="' + k + '">删除</button></div>';
      });
    }

    const d = todayDate();
    const guess = d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);

    openSheet('<h3>调休与补班</h3>' +
      '<div class="meta">调休用：某一天放假，或者某个周六按周一的课表上。只影响写进去的那一天。</div>' +
      '<div style="margin-bottom:14px">' + list + '</div>' +
      '<form data-form="override">' +
      '<div class="field"><label>日期</label><input name="date" type="date" value="' + guess + '" required></div>' +
      '<div class="field"><label>这一天</label><select name="kind">' +
      '<option value="off">放假</option>' +
      WEEKDAYS.map((w, i) => '<option value="w' + (i + 1) + '">按' + w + '的课表上课</option>').join('') +
      '</select></div>' +
      '<div class="rows"><button class="btn primary" type="submit">添加</button>' +
      '<button class="btn" type="button" data-act="close">关闭</button></div></form>');
  }

  function saveOverride(form) {
    const f = form.elements;
    const date = f['date'].value;
    if (!date) return toast('先选一个日期');
    const kind = f['kind'].value;
    const t = term();
    t.overrides = t.overrides || {};
    t.overrides[date] = kind === 'off' ? { off: true } : { weekday: parseInt(kind.slice(1), 10) };
    save();

    const w = Engine.weekOf(t, Engine.parseDate(date));
    if (w >= 1 && w <= t.totalWeeks) week = w;
    closeSheet();
    view = 'grid';
    render();
    toast('已把 ' + date + ' 设为' + (kind === 'off' ? '放假' : '补课日'));
  }

  /* ================= 备份 ================= */

  function backupExport() {
    store.meta = store.meta || {};
    store.meta.exportedAt = new Date().toISOString();
    save();
    const d = new Date();
    const name = '简课表备份-' + d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2) + '.json';
    download(name, JSON.stringify(store, null, 2), 'application/json');
  }

  function csvExport() {
    const t = term();
    const lines = ['课程名,教师,地点,星期,起始节,结束节,周次'];
    t.sessions.forEach((s) => {
      const c = t.courses.filter((x) => x.id === s.courseId)[0];
      if (!c) return;
      lines.push([c.name, c.teacher || '', c.location || '', s.weekday, s.start, s.end, weeksText(s.weeks)].join(','));
    });
    download(String(t.name).replace(/[\\/:*?"<>|]/g, '_') + '-课表.csv', '\uFEFF' + lines.join('\n'), 'text/csv;charset=utf-8');
  }

  function icsExport() {
    const t = term();
    const mins = (store.settings && typeof store.settings.remind === 'number') ? store.settings.remind : 15;
    download(t.name + '.ics',
      Engine.toICS(t, store.periods, { remindBefore: mins }),
      'text/calendar;charset=utf-8');
    setTimeout(() => icsHelpSheet(mins), 500);
  }

  function icsHelpSheet(mins) {
    openSheet('<h3>怎么让手机提醒你</h3>' +
      '<div class="meta">刚导出的日历文件里，每节课都带了一个' +
      (mins > 0 ? '「课前 ' + mins + ' 分钟」的闹钟' : '事件（当前设了不提醒）') + '。</div>' +
      '<ol class="steps">' +
      '<li>在「文件」App 或浏览器的下载列表里，点一下 <b>.ics</b> 文件</li>' +
      '<li>选「添加到日历」，新建一个叫 <b>课表</b> 的日历</li>' +
      '<li>之后每节课前，手机会弹提醒，锁屏上也能看到</li>' +
      '<li>课表改过之后：重新导出，先把旧的「课表」日历删掉，再导入新的</li>' +
      '</ol>' +
      '<div class="meta">网页版自己发不了通知，这是 iOS 的限制，用系统日历最稳。</div>' +
      '<div class="rows"><button class="btn primary" data-act="close">知道了</button></div>');
  }

  function remindSheet() {
    const cur = (store.settings && typeof store.settings.remind === 'number') ? store.settings.remind : 15;
    openSheet('<h3>课前提醒</h3>' +
      '<div class="meta">只影响「导出到系统日历」。导出之后，系统日历会在每节课开始前提醒你。网页本身发不了通知。</div>' +
      [0, 5, 10, 15, 30].map((m) =>
        '<button class="kv" data-act="remind-set" data-min="' + m + '">' +
        '<span>' + (m === 0 ? '不提醒' : m + ' 分钟前') + '</span>' +
        '<span class="muted">' + (m === cur ? '✓ 当前' : '') + '</span></button>').join('') +
      '<div class="rows" style="margin-top:12px"><button class="btn" data-act="close">关闭</button></div>');
  }

  /* ================= 拖拽调课 ================= */
  /* 长按 260ms 抓起课程块，拖到目标格子松手；点一下仍然是看详情。
   * 拖不动也没关系，点两下的调课路径一直都在。 */

  const DRAG_HOLD = 260;

  function onPointerDown(e) {
    if (!editable() || picked) return;
    const blk = e.target.closest('.block');
    if (!blk) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    const i = parseInt(blk.dataset.i, 10);
    const slot = slotsCache[i];
    if (!slot || !slot.sessionId || slot.cancelled) return;

    dragState = {
      slot: slot, el: blk, x0: e.clientX, y0: e.clientY,
      active: false, ghost: null, target: null, timer: 0
    };
    dragState.timer = setTimeout(beginDrag, DRAG_HOLD);
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  }

  function beginDrag() {
    const st = dragState;
    if (!st) return;
    st.active = true;

    const r = st.el.getBoundingClientRect();
    const ghost = st.el.cloneNode(true);
    ghost.className = 'block drag-ghost';
    ghost.style.left = r.left + 'px';
    ghost.style.top = r.top + 'px';
    ghost.style.width = r.width + 'px';
    ghost.style.height = r.height + 'px';
    document.body.appendChild(ghost);
    st.ghost = ghost;
    st.el.classList.add('drag-source');
    document.body.classList.add('dragging');
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* 忽略 */ }
  }

  function targetFromPoint(x, y) {
    const grid = $('grid');
    if (!grid) return null;
    const r = grid.getBoundingClientRect();
    const colW = (r.width - TIME_W) / 7;
    if (x < r.left + TIME_W || x > r.right) return null;
    if (y < r.top + gridHeadH || y > r.bottom) return null;
    const col = Math.floor((x - r.left - TIME_W) / colW);
    const row = Math.floor((y - r.top - gridHeadH) / ROW_H);
    if (col < 0 || col > 6 || row < 0 || row >= store.periods.length) return null;
    return { weekday: col + 1, period: row + 1 };
  }

  function highlightTarget(t) {
    const st = dragState;
    if (!st) return;
    Array.prototype.forEach.call(document.querySelectorAll('#grid .cell'), (c) => {
      c.classList.remove('drop', 'drop-range');
    });
    if (!t) { st.target = null; return; }
    const len = st.slot.end - st.slot.start;
    if (t.period + len > store.periods.length) { st.target = null; return; }
    st.target = t;
    for (let k = 0; k <= len; k++) {
      const cell = document.querySelector('#grid .cell[data-day="' + t.weekday +
        '"][data-period="' + (t.period + k) + '"]');
      if (cell) cell.classList.add(k === 0 ? 'drop' : 'drop-range');
    }
  }

  function onPointerMove(e) {
    const st = dragState;
    if (!st) return;
    if (!st.active) {
      if (Math.abs(e.clientX - st.x0) > 10 || Math.abs(e.clientY - st.y0) > 10) endDrag();
      return;
    }
    if (e.cancelable) e.preventDefault();
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    if (st.ghost) st.ghost.style.transform = 'translate(' + dx + 'px,' + dy + 'px) scale(1.04)';
    highlightTarget(targetFromPoint(e.clientX, e.clientY));
  }

  function onPointerUp() {
    const st = dragState;
    if (!st) return;
    if (!st.active) { endDrag(); return; }

    const target = st.target;
    const slot = st.slot;
    endDrag();

    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 80);

    if (!target) return;
    if (target.weekday === slot.weekday && target.period === slot.start) return;
    openConfirm(slot, target.weekday, target.period);
  }

  function endDrag() {
    const st = dragState;
    if (!st) return;
    clearTimeout(st.timer);
    if (st.ghost && st.ghost.parentNode) st.ghost.parentNode.removeChild(st.ghost);
    if (st.el) st.el.classList.remove('drag-source');
    document.body.classList.remove('dragging');
    Array.prototype.forEach.call(document.querySelectorAll('#grid .cell.drop, #grid .cell.drop-range'), (c) => {
      c.classList.remove('drop', 'drop-range');
    });
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('pointercancel', onPointerUp);
    dragState = null;
  }

  document.addEventListener('pointerdown', onPointerDown);

  // 拖动期间压住页面滚动和长按菜单
  document.addEventListener('touchmove', (e) => {
    if (dragState && dragState.active && e.cancelable) e.preventDefault();
  }, { passive: false });

  document.addEventListener('contextmenu', (e) => {
    if (dragState && dragState.active) e.preventDefault();
  });

  /* ================= 事件 ================= */

  const actions = {
    tab: (el) => { view = el.dataset.view; picked = null; render(); },
    prev: () => { if (week > 1) { week--; render(); } },
    next: () => { if (week < term().totalWeeks) { week++; render(); } },
    today: () => { week = clampWeek(currentWeekOf(term())); render(); },
    add: () => openCourseForm(null),
    close: () => closeSheet(),
    undo: () => { if (undoFn) undoFn(); undoFn = null; hideToast(); },

    'cell-add': (el) => {
      const day = parseInt(el.dataset.day, 10);
      const period = parseInt(el.dataset.period, 10);
      openCourseForm(null, { weekday: day, start: period, end: period });
    },
    'cell-makeup': (el) => {
      openMakeupForm(parseInt(el.dataset.day, 10), parseInt(el.dataset.period, 10));
    },

    'open-slot': (el) => {
      const i = parseInt(el.dataset.i, 10);
      if (!isNaN(i) && slotsCache[i]) openDetail(slotsCache[i]);
    },

    'd-move': () => { const s = currentSlot(); if (s) startPicking(s); },
    'd-cancel': () => { const s = currentSlot(); if (s) applyCancel(s); },
    'd-restore': () => { const s = currentSlot(); if (s) restoreSession(s); },
    'd-edit': () => { const s = currentSlot(); if (s) openCourseForm(s); },
    'd-delete': () => {
      const s = currentSlot();
      if (!s) return;
      confirmSheet('删除这门课？', '会同时删掉它的全部时段和调课记录，不能撤销。', '删除', () => deleteCourse(s));
    },
    'd-del-makeup': () => {
      const s = currentSlot();
      if (!s) return;
      const t = term();
      t.adjustments = t.adjustments.filter((a) => !(a.type === 'makeup' && a.courseId === s.courseId &&
        a.weekday === s.weekday && a.start === s.start && Engine.hasWeek(a.weeks, week)));
      save(); closeSheet(); render(); toast('已删除这次补课');
    },

    'pick-cancel': () => stopPicking(),
    'confirm-move': (el) => {
      const s = pendingSlot;
      if (!s) return;
      applyMove(s, parseInt(el.dataset.day, 10), parseInt(el.dataset.start, 10), el.dataset.range);
    },
    'confirm-swap': (el) => {
      const s = pendingSlot;
      if (!s) return;
      applySwap(s, el.dataset.target);
    },

    'log-del': (el) => {
      const id = el.dataset.id;
      const t = term();
      t.adjustments = t.adjustments.filter((a) => a.id !== id);
      save(); render(); toast('已还原');
    },
    'log-clear': () => confirmSheet('清空调课记录？', '课表会回到最初的排课，不能撤销。', '清空', () => {
      term().adjustments = [];
      save(); render(); toast('已清空');
    }),

    'import-paste': () => importPasteSheet(),
    'do-parse-paste': () => {
      const box = $('pasteBox');
      showPreview(Engine.parsePaste(box ? box.value : ''), 'paste');
    },
    'import-html': () => pickFile('.html,.htm,text/html', (text) => {
      showPreview(Engine.parseHTMLTable(text), 'html');
    }),
    'import-csv': () => pickFile('.csv,text/csv', (text) => {
      showPreview(Engine.parseCSV(text), 'csv');
    }),
    'imp-del': (el) => {
      imp.items.splice(parseInt(el.dataset.i, 10), 1);
      if (!imp.items.length) { imp = null; closeSheet(); render(); return; }
      renderPreview();
    },
    'imp-apply': () => applyImport(),

    'term-manage': () => termSheet(),
    'term-new': () => openTermForm(null),
    'term-edit': (el) => {
      const t = store.terms.filter((x) => x.id === el.dataset.id)[0];
      if (t) openTermForm(t);
    },
    'term-view': (el) => {
      viewTermId = el.dataset.id;
      week = clampWeek(currentWeekOf(term()));
      closeSheet(); render(); toast('已切换到 ' + term().name);
    },
    'term-active': (el) => {
      store.activeTermId = el.dataset.id;
      viewTermId = el.dataset.id;
      week = clampWeek(currentWeekOf(term()));
      save(); closeSheet(); render(); toast('当前学期已切换');
    },
    'term-del': (el) => {
      if (store.terms.length <= 1) return toast('至少要保留一个学期');
      const id = el.dataset.id;
      const target = store.terms.filter((t) => t.id === id)[0];
      if (!target) return;
      confirmSheet('删除学期「' + target.name + '」？', '这个学期的课程和调课记录都会删掉，不能撤销。', '删除', () => {
        store.terms = store.terms.filter((t) => t.id !== id);
        if (store.activeTermId === id) store.activeTermId = store.terms[0].id;
        if (viewTermId === id) viewTermId = store.activeTermId;
        week = clampWeek(currentWeekOf(term()));
        save(); render(); toast('学期已删除');
      });
    },

    'period-edit': () => periodSheet(),
    'period-add': () => {
      if (store.periods.length >= 20) return toast('最多 20 节');
      syncPeriodInputs();
      const last = store.periods[store.periods.length - 1];
      store.periods.push({
        i: last.i + 1,
        start: addMinutes(last.end, 10),
        end: addMinutes(last.end, 55)
      });
      save();
      periodSheet();
      toast('已加到 ' + store.periods.length + ' 节，记得保存时间');
    },
    'period-del': () => {
      if (store.periods.length <= 1) return toast('至少要保留一节');
      const n = store.periods.length;
      const used = store.terms.some((t) => t.sessions.some((s) => s.end >= n));
      if (used) return toast('第 ' + n + ' 节还有课，先把它挪走再删');
      syncPeriodInputs();
      store.periods.pop();
      save();
      periodSheet();
      toast('已减到 ' + store.periods.length + ' 节');
    },
    'holiday-manage': () => holidaySheet(),
    'holiday-save': () => saveHolidays(),
    'holiday-off': (el) => {
      const t = term();
      const wk = parseInt(el.dataset.week, 10);
      t.holidays = (t.holidays || []).filter((w) => w !== wk);
      save(); render(); toast('已取消第 ' + wk + ' 周放假');
    },
    'override-manage': () => overrideSheet(),
    'ov-del': (el) => {
      const key = el.dataset.key;
      const t = term();
      if (t.overrides) delete t.overrides[key];
      save(); overrideSheet(); render();
      toast('已删除 ' + key);
    },
    'demo-clear': () => confirmSheet('清空示例数据？', '示例课程会被删掉，然后你可以导入自己的课表。', '清空', () => {
      const t = term();
      t.courses = []; t.sessions = []; t.adjustments = [];
      t.holidays = []; t.overrides = {};
      store.demo = false;
      save(); render(); toast('已清空，去导入你的课表吧');
    }),

    'pick-color': (el) => {
      const box = el.closest('.field');
      if (!box) return;
      const input = box.querySelector('input[name="color"]');
      if (input) input.value = el.dataset.color;
      Array.prototype.forEach.call(box.querySelectorAll('.swatch'), (b) => {
        b.classList.toggle('on', b === el);
      });
    },
    'period-save': () => {
      const list = sheetEl.querySelectorAll('input[data-p]');
      const next = store.periods.map((p) => ({ i: p.i, start: p.start, end: p.end }));
      Array.prototype.forEach.call(list, (inp) => {
        const i = parseInt(inp.dataset.i, 10);
        next[i][inp.dataset.p] = inp.value || next[i][inp.dataset.p];
      });
      store.periods = next;
      save(); closeSheet(); render(); toast('节次时间已更新');
    },

    'backup-export': () => backupExport(),
    'backup-import': () => pickFile('.json,application/json', (text) => {
      try {
        const d = JSON.parse(text);
        if (!d || d.version !== 2 || !Array.isArray(d.terms) || !d.terms.length) throw new Error('bad');
        store = d;
        viewTermId = store.activeTermId = d.activeTermId || d.terms[0].id;
        week = clampWeek(currentWeekOf(term()));
        store.meta = store.meta || {};
        store.meta.exportedAt = new Date().toISOString();
        save(); render(); toast('已从备份恢复');
      } catch (e) {
        toast('这个文件不是有效的备份');
      }
    }),
    'csv-export': () => csvExport(),
    'ics-export': () => icsExport(),
    'remind-edit': () => remindSheet(),
    'remind-set': (el) => {
      store.settings = store.settings || {};
      store.settings.remind = parseInt(el.dataset.min, 10);
      save();
      closeSheet();
      render();
      toast(store.settings.remind ? '已设为课前 ' + store.settings.remind + ' 分钟提醒' : '已关闭课前提醒');
    },
    'clear-term': () => confirmSheet('清空本学期数据？', '课程、排课、调课记录都会删除，课表回到空。', '清空', () => {
      const t = term();
      t.courses = []; t.sessions = []; t.adjustments = [];
      save(); render(); toast('本学期已清空');
    }),

    theme: (el) => {
      const th = el.dataset.theme;
      store.settings = store.settings || {};
      store.settings.theme = th;
      save(); applyTheme(); render();
    },

    'do-confirm': () => {
      const fn = confirmFn;
      confirmFn = null;
      closeSheet();
      if (fn) fn();
    }
  };

  document.addEventListener('click', (e) => {
    // 拖拽松手后会跟着一次合成 click，只吞掉「落在课表里」的那一下
    if (suppressClick) {
      if (e.target.closest && e.target.closest('#grid')) { suppressClick = false; return; }
      suppressClick = false;
    }
    const actEl = e.target.closest('[data-act]');
    if (actEl) {
      const fn = actions[actEl.dataset.act];
      if (fn) { e.preventDefault(); fn(actEl, e); }
      return;
    }

    if (!picked) {
      const blk = e.target.closest('.block');
      if (blk) {
        const i = parseInt(blk.dataset.i, 10);
        if (!isNaN(i) && slotsCache[i]) openDetail(slotsCache[i]);
        return;
      }
      const emptyCell = e.target.closest('.cell');
      if (emptyCell) openCellSheet(parseInt(emptyCell.dataset.day, 10), parseInt(emptyCell.dataset.period, 10));
      return;
    }
    const cell = e.target.closest('.cell');
    const block = e.target.closest('.block');
    const s = picked.slot;
    picked = null;
    render();
    if (cell) {
      openConfirm(s, parseInt(cell.dataset.day, 10), parseInt(cell.dataset.period, 10));
    } else if (block) {
      const target = slotsCache[parseInt(block.dataset.i, 10)];
      if (!target) return;
      openConfirm(s, target.weekday, target.start);
    }
  });

  document.addEventListener('submit', (e) => {
    const form = e.target.closest('form[data-form]');
    if (!form) return;
    e.preventDefault();
    if (form.dataset.form === 'course') submitCourse(form);
    else if (form.dataset.form === 'makeup') applyMakeup(form);
    else if (form.dataset.form === 'override') saveOverride(form);
    else if (form.dataset.form === 'term-save') saveTerm(form);
  });

  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.imp) return;
    const i = parseInt(el.dataset.i, 10);
    const it = imp && imp.items[i];
    if (!it) return;

    if (el.dataset.imp === 'check') {
      it.checked = el.checked;
    } else if (el.dataset.imp === 'day') {
      it.weekday = parseInt(el.value, 10);
    } else if (el.dataset.imp === 'start') {
      const len = it.end - it.start;
      it.start = parseInt(el.value, 10);
      it.end = it.start + len;
    } else if (el.dataset.imp === 'len') {
      const len = Math.max(1, parseInt(el.value, 10) || 1);
      it.end = it.start + len - 1;
    } else {
      return;
    }

    it.valid = !!(it.name && it.weekday && it.start && Engine.parseWeeks(it.weeksText) !== -1);
    renderPreview();
  });

  scrimEl.addEventListener('click', closeSheet);

  /* ================= 主题与启动 ================= */

  function applyTheme() {
    const th = (store.settings && store.settings.theme) || 'auto';
    if (th === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', th);
  }

  store = load();
  viewTermId = store.activeTermId;
  week = clampWeek(currentWeekOf(term()));
  applyTheme();
  render();

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
  }
})();
