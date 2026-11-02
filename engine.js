/* 课表引擎 v2：纯逻辑，不碰 DOM，可以在 Node 里直接跑测试。
 *
 * 核心思想（说明书第九章）：
 *   最终课表 = 基础排课 + 调课记录
 * 渲染时先铺基础排课，再把本周的调课记录叠上去。
 * 这样原始课表永远不丢，撤销就是删掉一条记录。
 */
var Engine = (function () {
  'use strict';

  // 周次用 32 位整数做位图：第 1 周 = 第 0 位。
  // JS 的位运算是 32 位有符号，所以最多支持 31 周，一个学期足够。
  var MAX_WEEKS = 31;

  function setBit(mask, w) {
    if (w < 1 || w > MAX_WEEKS) return mask >>> 0;
    return (mask | (1 << (w - 1))) >>> 0;
  }

  function hasWeek(mask, w) {
    if (w < 1 || w > MAX_WEEKS) return false;
    return ((mask >>> (w - 1)) & 1) === 1;
  }

  // mode: 0 每周 / 1 单周 / 2 双周
  function weekMask(from, to, mode) {
    var m = 0;
    for (var w = from; w <= to; w++) {
      if (mode === 1 && w % 2 === 0) continue;
      if (mode === 2 && w % 2 === 1) continue;
      m = setBit(m, w);
    }
    return m;
  }

  function weeksOf(mask, max) {
    var out = [];
    for (var w = 1; w <= (max || MAX_WEEKS); w++) {
      if (hasWeek(mask, w)) out.push(w);
    }
    return out;
  }

  /* 解析教务系统里的周次写法，支持：
   *   "1-16周" "1-16周(单)" "2-16周(双)" "1-4,6-9周" "第1-8周"
   * 解析不出来时返回 -1，让调用方提示用户手改，绝不静默丢弃。
   */
  function parseWeeks(text) {
    if (typeof text !== 'string') return -1;
    var s = text.replace(/\s/g, '').replace(/第/g, '').replace(/周/g, '');
    if (!s) return -1;

    var mode = 0;
    if (/[（(]单[)）]|单周/.test(s)) mode = 1;
    else if (/[（(]双[)）]|双周/.test(s)) mode = 2;
    s = s.replace(/[（(][单双][)）]/g, '').replace(/单周|双周/g, '');

    var mask = 0;
    var parts = s.split(/[,，、]/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (!p) continue;
      var range = p.match(/^(\d+)[-~—](\d+)$/);
      if (range) {
        var a = parseInt(range[1], 10);
        var b = parseInt(range[2], 10);
        if (a > b) return -1;
        mask = mask | weekMask(a, b, mode);
        continue;
      }
      if (/^\d+$/.test(p)) {
        var w = parseInt(p, 10);
        if (mode === 1 && w % 2 === 0) continue;
        if (mode === 2 && w % 2 === 1) continue;
        mask = setBit(mask, w);
        continue;
      }
      return -1;
    }
    return mask === 0 ? -1 : mask;
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return !(aEnd < bStart || aStart > bEnd);
  }

  function findSlot(slots, sessionId) {
    for (var i = 0; i < slots.length; i++) {
      if (slots[i].sessionId === sessionId) return slots[i];
    }
    return null;
  }

  function courseById(data, id) {
    for (var i = 0; i < data.courses.length; i++) {
      if (data.courses[i].id === id) return data.courses[i];
    }
    return null;
  }

  function makeSlot(session, course) {
    return {
      sessionId: session.id,
      courseId: session.courseId,
      course: course,
      weekday: session.weekday,
      start: session.start,
      end: session.end,
      cancelled: false,
      adjusted: false,
      temporary: false
    };
  }

  function applyMove(slots, a) {
    var s = findSlot(slots, a.sessionId);
    if (!s) return;
    s.weekday = a.weekday;
    s.start = a.start;
    s.end = a.end;
    s.adjusted = true;
  }

  function applySwap(slots, a) {
    var x = findSlot(slots, a.sessionId);
    var y = findSlot(slots, a.targetSessionId);
    if (!x || !y) return;
    var wd = x.weekday, st = x.start, en = x.end;
    x.weekday = y.weekday; x.start = y.start; x.end = y.end;
    y.weekday = wd; y.start = st; y.end = en;
    x.adjusted = true;
    y.adjusted = true;
  }

  function applyCancel(slots, a) {
    var s = findSlot(slots, a.sessionId);
    if (s) s.cancelled = true;
  }

  function applyMakeup(slots, a, data) {
    slots.push({
      sessionId: null,
      courseId: a.courseId,
      course: courseById(data, a.courseId),
      weekday: a.weekday,
      start: a.start,
      end: a.end,
      cancelled: false,
      adjusted: true,
      temporary: true
    });
  }

  /* 某一周是不是放假周（整周不排课） */
  function isHoliday(term, week) {
    return !!(term && Array.isArray(term.holidays) && term.holidays.indexOf(week) !== -1);
  }

  function dateKey(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* 单日调整（调休）：
   *   { '2026-10-01': { off: true } }        这天放假
   *   { '2026-10-10': { weekday: 1 } }       这天按周一的课表上
   * 返回这一周里「哪几列放假」「哪几列借了别的星期」。
   */
  function dayOverrides(term, week) {
    var out = { off: {}, map: {}, borrowed: {} };
    if (!term || !term.overrides) return out;
    var dates = weekDates(term, week);
    for (var d = 1; d <= 7; d++) {
      var ov = term.overrides[dateKey(dates[d - 1])];
      if (!ov) continue;
      if (ov.off) {
        out.off[d] = true;
      } else if (ov.weekday) {
        out.map[d] = ov.weekday;
        out.borrowed[ov.weekday] = d;
      }
    }
    return out;
  }

  /* 生成某一周的课表。返回的数组已按「星期、节次」排好序。
   * 放假周直接返回空数组，这样课表、今日、日历导出会自动一致。
   */
  function buildWeek(data, week) {
    var slots = [];
    if (isHoliday(data, week)) return slots;

    var ov = dayOverrides(data, week);

    for (var i = 0; i < data.sessions.length; i++) {
      var s = data.sessions[i];
      if (!hasWeek(s.weeks, week)) continue;

      // 调休：某天的课挪到另一天（如周六补周一的课）
      var wd = s.weekday;
      if (ov.borrowed[wd] !== undefined) wd = ov.borrowed[wd];
      if (ov.off[wd]) continue;

      var slot = makeSlot(s, courseById(data, s.courseId));
      slot.weekday = wd;
      slots.push(slot);
    }

    for (var j = 0; j < data.adjustments.length; j++) {
      var a = data.adjustments[j];
      if (!hasWeek(a.weeks, week)) continue;
      if (a.type === 'move') applyMove(slots, a);
      else if (a.type === 'swap') applySwap(slots, a);
      else if (a.type === 'cancel') applyCancel(slots, a);
      else if (a.type === 'makeup') applyMakeup(slots, a, data);
    }

    slots.sort(function (x, y) {
      if (x.weekday !== y.weekday) return x.weekday - y.weekday;
      return x.start - y.start;
    });
    return slots;
  }

  /* 目标时段是否已被占用。ignoreSessionId 用来排除「自己」。
   * 判定必须在渲染后的结果上做，才能发现「本周已被别的调课占用」。
   */
  function conflictsAt(slots, weekday, start, end, ignoreSessionId) {
    var hit = [];
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      if (s.cancelled) continue;
      if (s.sessionId !== null && s.sessionId === ignoreSessionId) continue;
      if (s.weekday !== weekday) continue;
      if (overlaps(start, end, s.start, s.end)) hit.push(s);
    }
    return hit;
  }

  function uid() {
    return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
  }

  /* ================= 日期 ================= */

  function parseDate(text) {
    var p = String(text).split('-').map(Number);
    return new Date(p[0], (p[1] || 1) - 1, p[2] || 1);
  }

  function weekDates(term, week) {
    var start = parseDate(term.startDate);
    var out = [];
    for (var d = 0; d < 7; d++) {
      out.push(new Date(start.getTime() + ((week - 1) * 7 + d) * 86400000));
    }
    return out;
  }

  function weekOf(term, date) {
    var start = parseDate(term.startDate);
    var diff = Math.round((date - start) / 86400000);
    return Math.floor(diff / 7) + 1;
  }

  /* ================= 导入解析 ================= */

  var LOCATION_RE = /楼|室|馆|场|区|机房|教室|实验|中心|校区|号|教\d/;
  var WEEKDAY_MAP = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '日': 7, '天': 7 };

  function splitFields(text) {
    return String(text).split(/[\s,，、|｜\t]+/).filter(function (s) { return s !== ''; });
  }

  function looksLikeLocation(s) {
    return LOCATION_RE.test(s);
  }

  /* 解析一行课。支持：
   *   高等数学 张伟 教学主楼A203 周一 1-2 1-16周
   *   高等数学,张伟,教学主楼A203,周一,1-2,1-16周
   * 星期、节次、周次都可以放在任意位置。
   */
  function parseCourseLine(line) {
    var raw = String(line).trim();
    if (!raw) return null;

    var row = { raw: raw, name: '', teacher: '', location: '', weekday: 0, start: 0, end: 0, weeksText: '', valid: false };

    // 星期（先摘掉，避免和后面的数字打架）
    var wdM = raw.match(/(?:周|星期)\s*([一二三四五六日天])/);
    if (wdM) {
      row.weekday = WEEKDAY_MAP[wdM[1]] || 0;
      raw = raw.replace(wdM[0], ' ');
    }

    // 节次：1-2 / 第1-2节。后面紧跟「周」的是周次，不是节次。
    var pM = raw.match(/(?:^|[\s,，、|｜])第?(\d{1,2})\s*[-~—]\s*(\d{1,2})(?!\s*周)\s*节?/);
    if (pM) {
      row.start = parseInt(pM[1], 10);
      row.end = parseInt(pM[2], 10);
      raw = raw.replace(pM[0], ' ');
    } else {
      var spM = raw.match(/(?:^|[\s,，、|｜])第?(\d{1,2})\s*节/);
      if (spM) {
        row.start = row.end = parseInt(spM[1], 10);
        raw = raw.replace(spM[0], ' ');
      }
    }

    // 周次
    var weeksM = raw.match(/(第?\s*\d+\s*(?:[-~—,，、]\s*\d+)*\s*周(?:\s*[（(][单双][)）])?)/);
    if (weeksM) {
      row.weeksText = weeksM[1].replace(/\s/g, '');
      raw = raw.replace(weeksM[1], ' ');
    }

    var parts = splitFields(raw);
    if (parts.length) {
      row.name = parts[0];
      for (var i = 1; i < parts.length; i++) {
        var p = parts[i];
        if (!row.location && looksLikeLocation(p)) { row.location = p; continue; }
        if (!row.teacher && /^[\u4e00-\u9fa5]{2,4}(老师)?$/.test(p)) { row.teacher = p.replace(/老师$/, ''); continue; }
      }
      // 没识别出地点时，第二个字段当作地点，剩下的忽略
      if (!row.location && parts.length > 2) row.location = parts[2];
      if (!row.teacher && parts.length > 1 && !looksLikeLocation(parts[1])) row.teacher = parts[1];
    }

    row.valid = !!(row.name && row.weekday && row.start && parseWeeks(row.weeksText) !== -1);
    return row;
  }

  /* 粘贴导入：一行一门课。返回解析结果与警告。 */
  function parsePaste(text) {
    var lines = String(text || '').split(/\r?\n/);
    var items = [], warnings = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var row = parseCourseLine(line);
      if (!row) continue;
      if (!row.name) { warnings.push('第 ' + (i + 1) + ' 行没有识别出课程名'); continue; }
      items.push(row);
    }
    return { items: items, warnings: warnings };
  }

  /* CSV 导入：列顺序见说明书附录 A。 */
  function parseCSV(text) {
    var lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    var items = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      var cells = line.split(',');
      if (i === 0 && /课程名|name/i.test(cells[0])) continue;
      var row = {
        raw: line,
        name: (cells[0] || '').trim(),
        teacher: (cells[1] || '').trim(),
        location: (cells[2] || '').trim(),
        weekday: 0,
        start: parseInt((cells[4] || '').trim(), 10) || 0,
        end: parseInt((cells[5] || '').trim(), 10) || 0,
        weeksText: (cells[6] || '').trim(),
        valid: false
      };
      var wd = (cells[3] || '').trim();
      var m = wd.match(/^(\d)$/);
      if (m) row.weekday = parseInt(m[1], 10);
      else {
        var wm = wd.match(/(?:周|星期)?\s*([一二三四五六日天])/);
        if (wm) row.weekday = WEEKDAY_MAP[wm[1]] || 0;
      }
      row.valid = !!(row.name && row.weekday && row.start && parseWeeks(row.weeksText) !== -1);
      if (!row.end) row.end = row.start;
      items.push(row);
    }
    return { items: items, warnings: [] };
  }

  /* 把正方课表格子里的多行文本拆成字段：课程名 / 教师 / 周次 / 地点 */
  function parseCellLines(text) {
    var lines = String(text).split(/\n/).map(function (s) { return s.trim(); }).filter(Boolean);
    var out = { name: '', teacher: '', location: '', weeksText: '' };
    if (!lines.length) return out;

    // 正方课表格子的第一行永远是课程名，先定下来，避免被当成教师姓名
    out.name = lines[0];

    for (var i = 1; i < lines.length; i++) {
      var ln = lines[i];
      if (!out.weeksText && parseWeeks(ln) !== -1) { out.weeksText = ln.replace(/\s/g, ''); continue; }
      if (!out.location && looksLikeLocation(ln)) { out.location = ln; continue; }
      if (!out.teacher && /^[\u4e00-\u9fa5]{2,4}(老师)?$/.test(ln)) { out.teacher = ln.replace(/老师$/, ''); continue; }
    }
    return out;
  }

  function cellText(html) {
    var s = String(html)
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|td)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    return s.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).join('\n');
  }

  /* HTML 导入：解析正方课表的表格结构，自动还原星期与节次。 */
  function parseHTMLTable(html) {
    var rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    var cellRe = /<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi;
    var rawRows = [], m;

    while ((m = rowRe.exec(html))) {
      var inner = m[1], cells = [], cm;
      cellRe.lastIndex = 0;
      while ((cm = cellRe.exec(inner))) {
        var attrs = cm[1] || '';
        var rs = /rowspan\s*=\s*["']?(\d+)/i.exec(attrs);
        var cs = /colspan\s*=\s*["']?(\d+)/i.exec(attrs);
        cells.push({
          text: cellText(cm[2]),
          rowspan: rs ? parseInt(rs[1], 10) : 1,
          colspan: cs ? parseInt(cs[1], 10) : 1
        });
      }
      if (cells.length) rawRows.push(cells);
    }

    if (!rawRows.length) return { items: [], warnings: ['没有在文件里找到表格'] };

    // 展开 rowspan / colspan
    var grid = [];
    for (var r = 0; r < rawRows.length; r++) {
      if (!grid[r]) grid[r] = [];
      var c = 0;
      for (var k = 0; k < rawRows[r].length; k++) {
        var cell = rawRows[r][k];
        while (grid[r][c] !== undefined) c++;
        for (var i2 = 0; i2 < cell.rowspan; i2++) {
          if (!grid[r + i2]) grid[r + i2] = [];
          for (var j2 = 0; j2 < cell.colspan; j2++) {
            grid[r + i2][c + j2] = (i2 === 0 && j2 === 0) ? cell : null;
          }
        }
        c += cell.colspan;
      }
    }

    // 找表头行
    var headerRow = -1;
    for (var r2 = 0; r2 < grid.length && headerRow === -1; r2++) {
      for (var c2 = 0; c2 < grid[r2].length; c2++) {
        var ht = (grid[r2][c2] || {}).text || '';
        if (/星期[一二三四五六日天]|周[一二三四五六日天]/.test(ht)) { headerRow = r2; break; }
      }
    }
    if (headerRow === -1) headerRow = 0;

    // 列 → 星期
    var colToWeekday = {};
    var header = grid[headerRow] || [];
    for (var c3 = 0; c3 < header.length; c3++) {
      var t = ((header[c3] || {}).text || '').replace(/\s/g, '');
      var mm = t.match(/星期([一二三四五六日天])/);
      if (mm) colToWeekday[c3] = WEEKDAY_MAP[mm[1]];
      else if (/^周[一二三四五六日天]$/.test(t)) colToWeekday[c3] = WEEKDAY_MAP[t.charAt(1)];
    }
    if (!Object.keys(colToWeekday).length) {
      for (var c4 = 1; c4 <= 7; c4++) colToWeekday[c4] = c4;
    }

    var items = [], warnings = [], period = 0;
    for (var r3 = headerRow + 1; r3 < grid.length; r3++) {
      var rowCells = grid[r3] || [];
      var objs = rowCells.filter(Boolean);
      if (!objs.length) continue;

      // 上午 / 下午 / 晚上 这种分隔行
      if (objs.length === 1 && /^(上午|下午|晚上|中午|早晨)$/.test(objs[0].text.replace(/\s/g, ''))) continue;

      period++;

      for (var c5 = 0; c5 < rowCells.length; c5++) {
        var weekday = colToWeekday[c5];
        if (!weekday) continue;
        var cellObj = rowCells[c5];
        if (!cellObj) continue;
        var text = cellObj.text;
        if (!text || !/周/.test(text)) continue;
        var parsed = parseCellLines(text);
        if (!parsed.name) continue;
        items.push({
          raw: text.replace(/\n/g, ' / '),
          name: parsed.name,
          teacher: parsed.teacher,
          location: parsed.location,
          weekday: weekday,
          start: period,
          end: period + (cellObj.rowspan || 1) - 1,
          weeksText: parsed.weeksText,
          valid: parseWeeks(parsed.weeksText) !== -1
        });
      }
    }

    if (!items.length) warnings.push('表格里没有找到课程，可能是页面结构不被支持');
    return { items: items, warnings: warnings };
  }

  /* 导入时去重：同课名 + 同星期 + 同节次 + 同周次，视为已存在。 */
  function isDuplicate(term, item) {
    var weeks = parseWeeks(item.weeksText);
    if (weeks === -1) return false;
    for (var i = 0; i < term.sessions.length; i++) {
      var s = term.sessions[i];
      if (s.weekday !== item.weekday) continue;
      if (s.start !== item.start || s.end !== item.end) continue;
      if (s.weeks !== weeks) continue;
      var c = courseById(term, s.courseId);
      if (c && c.name === item.name) return true;
    }
    return false;
  }

  /* ================= 日历导出 ================= */

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  function icsDate(date, time) {
    var p = time.split(':');
    return date.getFullYear() + pad(date.getMonth() + 1) + pad(date.getDate()) +
      'T' + pad(parseInt(p[0], 10)) + pad(parseInt(p[1], 10)) + '00';
  }

  function icsEscape(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/;/g, '\\;')
      .replace(/,/g, '\\,').replace(/\n/g, '\\n');
  }

  /* 每个「课次 × 周」生成一个事件：跨周、单双周、调课后的时间都能正确表达。 */
  function toICS(term, periods) {
    var out = [];
    out.push('BEGIN:VCALENDAR');
    out.push('VERSION:2.0');
    out.push('PRODID:-//JianKeBiao//CN');
    out.push('CALSCALE:GREGORIAN');
    out.push('METHOD:PUBLISH');
    out.push('X-WR-CALNAME:' + icsEscape(term.name));

    for (var w = 1; w <= term.totalWeeks; w++) {
      var dates = weekDates(term, w);
      var slots = buildWeek(term, w);
      for (var i = 0; i < slots.length; i++) {
        var s = slots[i];
        if (s.cancelled || !s.course) continue;
        var pd = periods[s.start - 1], pdEnd = periods[s.end - 1];
        if (!pd || !pdEnd) continue;
        out.push('BEGIN:VEVENT');
        out.push('UID:' + (s.sessionId || s.courseId) + '-' + w + '-' + i + '@jiankebiao');
        out.push('DTSTAMP:' + icsDate(new Date(), '00:00'));
        out.push('DTSTART:' + icsDate(dates[s.weekday - 1], pd.start));
        out.push('DTEND:' + icsDate(dates[s.weekday - 1], pdEnd.end));
        out.push('SUMMARY:' + icsEscape(s.course.name));
        if (s.course.location) out.push('LOCATION:' + icsEscape(s.course.location));
        out.push('DESCRIPTION:' + icsEscape(
          (s.course.teacher ? s.course.teacher + ' · ' : '') + '第 ' + w + ' 周'
        ));
        out.push('END:VEVENT');
      }
    }

    out.push('END:VCALENDAR');
    return out.join('\r\n');
  }

  /* ================= 统计 ================= */

  function termStats(term) {
    return {
      courses: term.courses.length,
      sessions: term.sessions.length,
      adjustments: term.adjustments.length
    };
  }

  return {
    MAX_WEEKS: MAX_WEEKS,
    setBit: setBit,
    hasWeek: hasWeek,
    weekMask: weekMask,
    weeksOf: weeksOf,
    parseWeeks: parseWeeks,
    buildWeek: buildWeek,
    conflictsAt: conflictsAt,
    isHoliday: isHoliday,
    dayOverrides: dayOverrides,
    dateKey: dateKey,
    overlaps: overlaps,
    uid: uid,
    parseDate: parseDate,
    weekDates: weekDates,
    weekOf: weekOf,
    parsePaste: parsePaste,
    parseCSV: parseCSV,
    parseHTMLTable: parseHTMLTable,
    parseCourseLine: parseCourseLine,
    parseCellLines: parseCellLines,
    isDuplicate: isDuplicate,
    toICS: toICS,
    icsEscape: icsEscape,
    termStats: termStats
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
