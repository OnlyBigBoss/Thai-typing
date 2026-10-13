(() => {
  const DATA = window.TH_DATA;
  const LAYOUT = DATA.layout;
  const store = window.TT.store;
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const textEl = $("text"), inputEl = $("input"), kbEl = $("keyboard"), counterEl = $("counter");
  const COMBINING = /[ัิ-ฺ็-๎]/;
  const PRESETS = { time: [15, 30, 60, 120], words: [10, 25, 50, 100], lessonCount: [5, 10, 15, 25],
    weakCount: [10, 25, 50, 100] };
  const LIMITS = { time: [5, 600], words: [1, 500], lessonCount: [1, 200], weakCount: [1, 500] };
  const MODE_NAMES = { lesson: "บทเรียน", time: "เวลา", words: "จำนวนคำ", weak: "ปุ่มอ่อน" };
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  const FINGERS = { LP: "ก้อยซ้าย", LR: "นางซ้าย", LM: "กลางซ้าย", LI: "ชี้ซ้าย",
    RI: "ชี้ขวา", RM: "กลางขวา", RR: "นางขวา", RP: "ก้อยขวา", T: "โป้ง" };
  // single words (no spaces) for time/words modes
  const WORD_POOL = DATA.lessons.filter((l) => ["words", "clusters", "tones"].includes(l.id))
    .flatMap((l) => l.items).filter((w) => !w.includes(" "));
  // every real single word in the lessons, for the weak-keys mode (not whole unspaced sentences)
  const ALL_WORDS = [...new Set(DATA.lessons.filter((l) => l.type !== "paragraph" && l.id !== "sentences")
    .flatMap((l) => l.items.flatMap((i) => i.split(" "))).filter(Boolean))];
  const LESSON_IDS = DATA.lessons.map((l) => l.id);

  // pieces for made-up syllables when "real words" is off
  const PARTS = {
    cons: "กขคฆงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ",
    lead: "เแโใไ", above: "ัิีึื", below: "ุู", tone: "่้๊๋", after: "าะำ", final: "กงดนบมยวร",
  };
  const ALL_CHARS = new Set(LAYOUT.rows.flatMap((r) => [...r.base, ...r.shift]));

  const DEFAULTS = { mode: "time", time: 30, words: 25, lesson: 0, lessonCount: 10, weakCount: 25,
    realWords: true, criteria: store.defaultCriteria() };
  let settings = { ...DEFAULTS, ...store.load(store.KEYS.settings, {}) };
  if (!MODE_NAMES[settings.mode]) settings.mode = DEFAULTS.mode;
  let target = [];           // code points of the target text
  let typed = [];            // code points typed so far
  let total = 0, errors = 0; // keystroke counters (errors stay counted after backspace)
  let startedAt = 0, endedAt = 0, timerId = 0, finished = false;
  let baseText = "";          // text the round started with (for "same set again")
  // per target character this round: [attempts, errors, timed attempts, total ms of timed attempts]
  let keyStats = {}, lastKeyAt = 0;
  let weak = { ready: false, keys: [] }; // weak keys for the current weak-mode round
  const settingsListeners = [];

  // ---- theme ----
  function setTheme(t) { document.documentElement.dataset.theme = t; store.save(store.KEYS.theme, t); }
  setTheme(store.load(store.KEYS.theme, "dark"));

  // ---- keyboard ----
  const show = (ch) => (COMBINING.test(ch) ? "◌" + ch : ch);
  const keyOf = new Map(); // char -> { r, c, shift, finger }
  LAYOUT.rows.forEach((row, r) => ["base", "shift"].forEach((layer) =>
    row[layer].forEach((ch, c) => {
      if (!keyOf.has(ch)) keyOf.set(ch, { r, c, shift: layer === "shift", finger: row.fingers[c] });
    })));
  const bumps = new Set(LAYOUT.bumps.map(([r, c]) => `${r},${c}`));
  const fingerOf = (ch) => (ch === " " ? "T" : keyOf.has(ch) ? keyOf.get(ch).finger : "T");

  // modifier keys around each row so the board looks like a real one (every row = 15 units)
  const EXTRA = [
    { after: [{ label: "Backspace", w: 2, finger: "RP" }] },
    { before: [{ label: "Tab", w: 1.5, finger: "LP" }], lastW: 1.5 },
    { before: [{ label: "Caps Lock", w: 1.75, finger: "LP" }], after: [{ label: "Enter", w: 2.25, finger: "RP" }] },
    { before: [{ label: "Shift", w: 2.25, mod: "shiftL", finger: "LP" }],
      after: [{ label: "Shift", w: 2.75, mod: "shiftR", finger: "RP" }] },
  ];

  function modKey({ label, w, mod, finger }) {
    const k = el("div", "key mod" + (finger ? " f-" + finger : ""), label);
    if (finger) k.title = "นิ้ว" + FINGERS[finger];
    k.style.setProperty("--w", w);
    if (mod) k.dataset.mod = mod;
    return k;
  }

  // draws a Kedmanee board into `board` (the typing keyboard and the stats heat map share this)
  function buildKeyboard(board) {
    board.replaceChildren();
    LAYOUT.rows.forEach((row, r) => {
      const rowEl = el("div", "krow");
      (EXTRA[r].before || []).forEach((m) => rowEl.appendChild(modKey(m)));
      row.base.forEach((ch, c) => {
        const k = el("div", `key f-${row.fingers[c]}` + (bumps.has(`${r},${c}`) ? " bump" : ""));
        if (EXTRA[r].lastW && c === row.base.length - 1) k.style.setProperty("--w", EXTRA[r].lastW);
        k.dataset.r = r; k.dataset.c = c;
        k.title = "นิ้ว" + FINGERS[row.fingers[c]];
        k.append(el("span", "s", show(row.shift[c])), el("span", "b", show(ch)));
        rowEl.appendChild(k);
      });
      (EXTRA[r].after || []).forEach((m) => rowEl.appendChild(modKey(m)));
      board.appendChild(rowEl);
    });
    const last = el("div", "krow");
    [{ label: "Ctrl", w: 1.5, finger: "LP" }, { label: "Alt", w: 1.5, finger: "T" },
      { label: "", w: 9, mod: "space", finger: "T" },
      { label: "Alt", w: 1.5, finger: "T" }, { label: "Ctrl", w: 1.5, finger: "RP" }].forEach((m) => last.appendChild(modKey(m)));
    board.appendChild(last);
  }
  const charsOfKey = (k) => (k.dataset.mod === "space" ? [" "]
    : k.dataset.r ? [LAYOUT.rows[k.dataset.r].base[k.dataset.c], LAYOUT.rows[k.dataset.r].shift[k.dataset.c]] : []);

  // heat map: each key tinted by its error rate (base + shift chars together); keys never typed fade
  const HEAT_FULL = .25; // an error rate at or above this gets the strongest tint
  const heatData = new WeakMap();
  function paintHeat(board, agg) {
    board.classList.add("heat");
    board.querySelectorAll(".key").forEach((k) => {
      const rows = charsOfKey(k).map((ch) => [ch, agg[ch]]).filter(([, s]) => s && s[0]);
      const n = rows.reduce((a, [, s]) => a + s[0], 0), bad = rows.reduce((a, [, s]) => a + s[1], 0);
      k.classList.toggle("cold", !n);
      if (n) k.style.setProperty("--t", Math.min(1, bad / n / HEAT_FULL).toFixed(3));
      else k.style.removeProperty("--t");
      heatData.set(k, rows);
    });
  }
  function clearHeat(board) {
    board.classList.remove("heat");
    board.querySelectorAll(".key").forEach((k) => { k.classList.remove("cold"); k.style.removeProperty("--t"); });
  }
  const pct = (x) => `${Math.round(x * 100)}%`;
  const secs = (ms) => `${(ms / 1000).toFixed(2)} วิ`;
  function keyTip(rows) {
    if (!rows || !rows.length) return null;
    return rows.map(([ch, [n, bad, timed, ms]]) =>
      [ch === " " ? "เว้นวรรค" : show(ch), `ผิด ${bad} จาก ${n} ครั้ง` + (timed ? ` · เฉลี่ย ${secs(ms / timed)}` : "")]);
  }

  // one floating tooltip for keys and the chart
  const tipEl = $("tip");
  function showTip(x, y, lines) {
    tipEl.replaceChildren(...lines.map(([strong, rest]) => {
      const row = el("div");
      row.append(el("b", null, strong), document.createTextNode(" " + rest));
      return row;
    }));
    tipEl.hidden = false;
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2)) + "px";
    tipEl.style.top = (y - h - 14 < 8 ? y + 18 : y - h - 14) + "px";
  }
  const hideTip = () => { tipEl.hidden = true; };
  function wireHeatTips(board) {
    board.addEventListener("pointermove", (e) => {
      const k = e.target.closest(".key");
      const lines = board.classList.contains("heat") && k && keyTip(heatData.get(k));
      if (lines) showTip(e.clientX, e.clientY, lines); else hideTip();
    });
    board.addEventListener("pointerleave", hideTip);
  }

  function highlightNext() {
    kbEl.querySelectorAll(".next").forEach((e) => e.classList.remove("next"));
    const ch = target[typed.length];
    const k = keyOf.get(ch);
    const off = finished || !$("intro").hidden; // nothing to type yet while the intro card is up
    kbEl.classList.toggle("live", !off && (ch === " " || !!k));
    if (ch === undefined || off) return;
    if (ch === " ") { kbEl.querySelector('[data-mod="space"]').classList.add("next"); return; }
    if (!k) return;
    kbEl.querySelector(`[data-r="${k.r}"][data-c="${k.c}"]`).classList.add("next");
    // Shift is pressed with the opposite hand
    if (k.shift) kbEl.querySelector(`[data-mod="${k.finger.startsWith("L") ? "shiftR" : "shiftL"}"]`).classList.add("next");
  }

  // ---- lessons & pass criteria ----
  const currentLesson = () => DATA.lessons[settings.lesson] || DATA.lessons[0];
  const isPassed = (id) => store.passed(settings.criteria, id);
  // the first lesson not passed yet is the suggested one
  const suggestedLesson = () => DATA.lessons.findIndex((l) => !isPassed(l.id));

  // ---- config bar ----
  function renderConfig() {
    document.querySelectorAll("#modes button").forEach((b) =>
      b.classList.toggle("active", b.dataset.mode === settings.mode));
    const real = $("realWords");
    real.hidden = settings.mode === "lesson" && currentLesson().type === "paragraph";
    real.setAttribute("aria-checked", settings.realWords);
    real.classList.toggle("active", settings.realWords);
    const box = $("amounts");
    box.replaceChildren();
    $("lessonStrip").hidden = settings.mode !== "lesson";
    if (settings.mode === "lesson") renderStrip($("lessonStrip"), true);
    if (settings.mode === "lesson") {
      const sel = el("select");
      sel.setAttribute("aria-label", "บทเรียน");
      const next = suggestedLesson();
      DATA.lessons.forEach((l, i) =>
        sel.add(new Option((isPassed(l.id) ? "✓ " : "") + l.title + (i === next ? " (แนะนำ)" : ""), i)));
      sel.value = settings.lesson;
      sel.addEventListener("change", () => update({ lesson: +sel.value }));
      box.appendChild(sel);
      const crit = el("button", "crit", "เกณฑ์ผ่านบท");
      crit.type = "button";
      crit.addEventListener("click", openCriteria);
      box.appendChild(crit);
      if (currentLesson().type === "paragraph") return; // a paragraph is always one whole item
    }
    if (settings.mode === "weak" && weak.ready) {
      const focus = el("span", "focus", "เน้น ");
      weak.keys.forEach((k) => focus.appendChild(keyChip(k.ch)));
      box.appendChild(focus);
    }
    const key = amountKey();
    const presets = PRESETS[key];
    presets.forEach((n) => {
      const b = el("button", null, n);
      b.type = "button";
      b.classList.toggle("active", settings[key] === n);
      b.addEventListener("click", () => update({ [key]: n }));
      box.appendChild(b);
    });
    const custom = el("button");
    custom.type = "button";
    custom.title = "กำหนดเอง";
    const isCustom = !presets.includes(settings[key]);
    custom.textContent = isCustom ? `✎ ${settings[key]}` : "✎";
    custom.classList.toggle("active", isCustom);
    custom.addEventListener("click", () => openCustom(custom));
    box.appendChild(custom);
  }
  // one box per lesson colored by its level (outline = never typed, grey = typed but not passed,
  // yellow = passed, green = passed with excellence); the level name is only in the label
  const LEVEL_NAMES = { none: "ยังไม่ได้ฝึก", tried: "ฝึกแล้ว ยังไม่ผ่าน", pass: "ผ่านบท", excellent: "ผ่านดีเยี่ยม" };
  function renderStrip(box, clickable) {
    box.replaceChildren(...DATA.lessons.map((l, i) => {
      const { level, best } = store.lessonLevel(settings.criteria, l.id);
      const c = el(clickable ? "button" : "span", `lv lv-${level}`, i + 1);
      c.title = l.title + (best ? `\nดีที่สุด: ความแม่นยำ ${best.acc}% · ${best.wpm} WPM` : "");
      c.setAttribute("aria-label", `${l.title}: ${LEVEL_NAMES[level]}`);
      if (clickable) {
        c.type = "button";
        if (i === settings.lesson) { c.classList.add("current"); c.setAttribute("aria-current", "true"); }
        c.addEventListener("click", () => update({ lesson: i }));
      }
      return c;
    }));
  }
  const amountKey = () => ({ lesson: "lessonCount", weak: "weakCount" })[settings.mode] || settings.mode;
  // a key cap in its finger color, for "new keys" and "focus" chips
  function keyChip(ch) {
    const c = el("span", "chip f-" + fingerOf(ch), show(ch));
    c.title = "นิ้ว" + FINGERS[fingerOf(ch)];
    return c;
  }

  function openCustom(btn) {
    const mode = amountKey();
    const [min, max] = LIMITS[mode];
    const inp = el("input");
    inp.type = "number"; inp.min = min; inp.max = max; inp.value = settings[mode];
    inp.setAttribute("aria-label", mode === "time" ? "จำนวนวินาที" : "จำนวนคำ");
    btn.replaceWith(inp);
    inp.focus(); inp.select();
    let done = false;
    const apply = (ok) => {
      if (done) return;
      done = true;
      const n = Math.round(Number(inp.value));
      if (ok && n) update({ [mode]: Math.min(max, Math.max(min, n)) });
      else { renderConfig(); inputEl.focus(); }
    };
    inp.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") apply(true);
      else if (e.key === "Escape") apply(false);
    });
    inp.addEventListener("blur", () => apply(false));
  }

  function saveSettings() {
    store.save(store.KEYS.settings, settings);
    settingsListeners.forEach((f) => f(settings));
  }
  function update(patch) {
    settings = { ...settings, ...patch };
    saveSettings();
    renderConfig();
    start();
  }

  // ---- text generation ----
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  function words(n, pool = WORD_POOL) {
    const out = [];
    while (out.length < n) {
      const w = pick(pool);
      if (w !== out[out.length - 1] || pool.length === 1) out.push(w);
    }
    return out;
  }
  // characters the learner may see: in a lesson, every key taught up to and including it
  function allowedChars() {
    if (settings.mode !== "lesson" || !currentLesson().keys.length) return ALL_CHARS;
    return new Set(DATA.lessons.slice(0, settings.lesson + 1).flatMap((l) => l.keys));
  }
  const only = (set, allowed) => [...set].filter((c) => allowed.has(c));
  // the keys a round drills: a lesson's new keys, or the weak keys
  const focusKeys = () => (settings.mode === "weak" ? weak.keys.map((k) => k.ch)
    : settings.mode === "lesson" ? currentLesson().keys : []);

  // a made-up syllable, typed in real Thai key order (lead vowel, consonant, vowel, tone, final)
  function syllable(allowed) {
    const cons = only(PARTS.cons, allowed);
    if (!cons.length) return "";
    const p = (k) => only(PARTS[k], allowed);
    const lead = p("lead"), above = p("above"), below = p("below"), tone = p("tone"),
      after = p("after"), final = p("final");
    let s = "";
    if (lead.length && Math.random() < .25) s += pick(lead);
    s += pick(cons);
    const v = Math.random();
    let open = true; // can still take a following vowel
    if (above.length && v < .3) { s += pick(above); open = false; }
    else if (below.length && v < .45) { s += pick(below); open = false; }
    if (tone.length && Math.random() < .35) s += pick(tone);
    let closed = false;
    if (open && after.length && Math.random() < .45) {
      const a = pick(after); s += a; closed = a !== "า";
    }
    if (!closed && final.length && Math.random() < .4) s += pick(final);
    return s;
  }
  // a short string drilling the focus keys (marks get a base letter to sit on)
  function focusString(allowed, keys = focusKeys()) {
    const cons = only(PARTS.cons, allowed);
    let s = "";
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      const k = pick(keys);
      if (COMBINING.test(k) && cons.length) s += pick(cons) + k;
      else if (PARTS.lead.includes(k) && cons.length) s += k + pick(cons);
      else s += k;
    }
    return s;
  }
  function randomWord(allowed, realPool) {
    const r = Math.random();
    if (realPool.length && r < .25) return pick(realPool); // mix in a real word now and then
    const drills = settings.mode === "lesson" ? (currentLesson().drills || []).flatMap((d) => d.split(" ")) : [];
    if (drills.length && r < .45) return pick(drills);
    if (focusKeys().length && r < .6) return focusString(allowed);
    const w = syllable(allowed) + (Math.random() < .4 ? syllable(allowed) : "");
    return w || focusString(allowed);
  }
  // weak mode: real words that contain a weak key (spread across all five keys)
  function weakPool() {
    const keys = focusKeys();
    return ALL_WORDS.filter((w) => keys.some((k) => w.includes(k)));
  }
  // n words for the current settings
  function genWords(n) {
    if (settings.mode === "weak") {
      const pool = weakPool();
      if (settings.realWords && pool.length >= 5) return words(n, pool);
      const out = [];
      while (out.length < n) {
        const w = pool.length && Math.random() < .3 ? pick(pool) : focusString(ALL_CHARS);
        if (w && w !== out[out.length - 1]) out.push(w);
      }
      return out;
    }
    if (settings.realWords && settings.mode !== "lesson") return words(n);
    const allowed = allowedChars();
    const realPool = (settings.mode === "lesson" ? currentLesson().items : WORD_POOL)
      .filter((w) => !w.includes(" ") && [...w].every((c) => allowed.has(c)));
    const out = [];
    while (out.length < n) {
      const w = randomWord(allowed, realPool);
      if (w && w !== out[out.length - 1]) out.push(w);
    }
    return out;
  }

  function makeText() {
    if (settings.mode === "words") return genWords(settings.words).join(" ");
    if (settings.mode === "weak") return genWords(settings.weakCount).join(" ");
    if (settings.mode === "time") return genWords(40).join(" ");
    const lesson = currentLesson();
    if (lesson.type === "paragraph") return pick(lesson.items);
    if (!settings.realWords) return genWords(settings.lessonCount).join(" ");
    // real words only: take whole items (phrases/sentences keep their word order) until exactly lessonCount words
    const out = [];
    let prev;
    while (out.length < settings.lessonCount) {
      const item = pick(lesson.items);
      if (item === prev && lesson.items.length > 1) continue;
      prev = item;
      out.push(...item.split(" "));
    }
    return out.slice(0, settings.lessonCount).join(" ");
  }

  // ---- rendering ----
  function render() {
    // A base letter and its marks (e.g. ว่) are drawn as one glyph cluster and can't be colored
    // separately, so a cluster that is half-typed or has mixed right/wrong code points gets one
    // overlay per typed prefix. Shorter prefixes sit on top, so each code point shows the color
    // of the overlay that ends with it: in ว่ with ว wrong, ว is red and ่ is normal.
    const frag = document.createDocumentFragment();
    let start = 0;
    for (const { segment } of segmenter.segment(target.join(""))) {
      const cps = Array.from(segment);
      const end = start + cps.length;
      const done = Math.min(Math.max(typed.length - start, 0), cps.length);
      const right = cps.slice(0, done).map((ch, k) => typed[start + k] === ch);
      const s = document.createElement("span");
      const cls = [];
      if (segment === " ") cls.push("sp");
      s.textContent = segment;
      const layered = done > 0 && (done < cps.length || new Set(right).size > 1);
      if (layered) {
        cls.push(done < cps.length ? "part" : "layered");
        for (let k = done; k > 0; k--) {
          const ov = document.createElement("span");
          ov.className = "ov" + (right[k - 1] ? "" : " bad") + (k === done && done < cps.length ? " caret" : "");
          ov.textContent = cps.slice(0, k).join("");
          s.appendChild(ov);
        }
      } else if (done > 0) cls.push(right.every(Boolean) ? "ok" : "bad");
      if (!finished && done === 0 && typed.length === start) cls.push("cur");
      if (cls.length) s.className = cls.join(" ");
      frag.appendChild(s);
      // allow line breaks after a word gap
      if (segment === " ") frag.appendChild(document.createElement("wbr"));
      start = end;
    }
    textEl.replaceChildren(frag);
    const cur = textEl.querySelector(".cur, .part");
    if (cur) {
      const lineH = parseFloat(getComputedStyle(textEl).lineHeight);
      textEl.scrollTop = Math.max(0, cur.offsetTop - lineH);
    }
    updateCounter();
    highlightNext();
  }

  function correctCount() { return typed.reduce((n, ch, i) => n + (ch === target[i] ? 1 : 0), 0); }
  function elapsed() { return startedAt ? ((endedAt || Date.now()) - startedAt) / 1000 : 0; }
  function wpm() {
    const t = elapsed();
    return t > 0 ? Math.round((correctCount() / 5) / (t / 60)) : 0;
  }
  function accuracy() { return total ? Math.round(((total - errors) / total) * 100) : 100; }
  function wordsDone() {
    let n = 0;
    for (let i = 0; i < typed.length; i++) if (target[i] === " ") n++;
    return n;
  }

  function updateCounter() {
    if (finished || !target.length) { counterEl.textContent = ""; return; }
    if (settings.mode === "time") counterEl.textContent = Math.max(0, Math.ceil(settings.time - elapsed()));
    else if (settings.mode === "lesson" && currentLesson().type === "paragraph") counterEl.textContent = "";
    else counterEl.textContent = `${wordsDone()}/${target.filter((ch) => ch === " ").length + 1}`;
  }

  // "new keys in this lesson" strip, shown until the first key is typed
  function renderNewKeys() {
    const box = $("newKeys");
    const keys = settings.mode === "lesson" ? currentLesson().keys : [];
    box.replaceChildren();
    box.hidden = !keys.length;
    if (!keys.length) return;
    box.append(el("span", "label", "ปุ่มใหม่ในบทนี้"), ...keys.map(keyChip));
  }

  // ---- session control ----
  // start a round; pass the previous text to type the same set again
  function start(text) {
    clearInterval(timerId);
    finished = false; startedAt = 0; endedAt = 0; total = 0; errors = 0; typed = [];
    keyStats = {}; lastKeyAt = 0;
    inputEl.value = "";
    textEl.classList.remove("typing");
    $("stage").classList.remove("typing");
    advancedFrom = null;
    const dlg = $("resultDlg");
    if (dlg.open) dlg.close();
    $("restart").hidden = false;
    $("weakEmpty").hidden = true;
    if (settings.mode === "weak") {
      weak = store.weakKeys();
      renderConfig();
      if (!weak.ready) {
        target = []; baseText = "";
        textEl.replaceChildren();
        const done = store.rounds().length;
        $("weakEmpty").textContent = done < store.WEAK.rounds
          ? `ฝึกให้ครบ ${store.WEAK.rounds} รอบก่อน แล้วโหมดนี้จะเลือกปุ่มที่คุณพิมพ์ผิดบ่อยหรือช้ามาให้ฝึก (ตอนนี้ ${done} รอบ)`
          : `พิมพ์เพิ่มอีกสักหน่อย ต้องพิมพ์แต่ละตัวอย่างน้อย ${store.WEAK.minAttempts} ครั้งก่อนถึงจะหาปุ่มอ่อนได้`;
        $("weakEmpty").hidden = false;
        $("restart").hidden = true;
        renderNewKeys();
        updateCounter();
        highlightNext();
        return;
      }
    }
    baseText = typeof text === "string" ? text : makeText();
    target = Array.from(baseText);
    renderNewKeys();
    render();
    inputEl.focus();
  }
  const hasNextLesson = () => settings.mode === "lesson" && settings.lesson < DATA.lessons.length - 1;
  // set when a round passed with excellence moved us on: "same set again" goes back to that lesson
  let advancedFrom = null;
  // the three after-round actions (buttons, Enter / Shift+Enter / Ctrl+Enter)
  function again() {
    if (advancedFrom !== null) { settings.lesson = advancedFrom; saveSettings(); renderConfig(); }
    start(baseText);
  }
  const fresh = () => start();
  function goNext() {
    if (advancedFrom !== null) fresh(); // already on the next lesson
    else if (hasNextLesson()) update({ lesson: settings.lesson + 1 });
  }

  function saveRound() {
    if (!total) return null;
    const keys = {};
    for (const [ch, [n, bad, timed, ms]] of Object.entries(keyStats)) keys[ch] = [n, bad, timed, Math.round(ms)];
    const round = {
      id: (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      at: Date.now(),
      mode: settings.mode,
      ...(settings.mode === "lesson" && { lesson: currentLesson().id }),
      wpm: wpm(),
      acc: accuracy(),
      sec: Math.round(elapsed() * 10) / 10,
      keys,
    };
    store.addRound(round);
    return round;
  }

  const clock = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  // a char as a finger-colored chip with a small note after it
  function noteChip(ch, note, title) {
    const wrap = el("span", "noted");
    const c = keyChip(ch);
    if (ch === " ") c.textContent = "เว้นวรรค";
    wrap.title = title;
    wrap.append(c, el("small", null, note));
    return wrap;
  }
  const SLOW = { minTimed: 3, ratio: 1.5 };
  // chars of this round that took longest compared with the round's own median char
  function slowChars(keys) {
    const avg = Object.entries(keys).filter(([, k]) => k[2] > 0).map(([ch, k]) => [ch, k[3] / k[2], k[2]]);
    const sorted = avg.map((a) => a[1]).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] || 0;
    if (!median) return [];
    return avg.filter(([, ms, n]) => n >= SLOW.minTimed && ms / median >= SLOW.ratio)
      .map(([ch, ms]) => ({ ch, ms, ratio: ms / median })).sort((a, b) => b.ratio - a.ratio).slice(0, 3);
  }
  const ruleText = (rule) => [rule.acc.on && `ความแม่นยำ ≥ ${rule.acc.v}%`, rule.wpm.on && `ความเร็ว ≥ ${rule.wpm.v} WPM`]
    .filter(Boolean).join(" และ ");
  // the result popup: numbers, lesson pass, what went wrong or slow, and the round's heat map
  function renderResult(round) {
    $("rWpm").textContent = round.wpm;
    $("rAcc").textContent = round.acc + "%";
    $("rTime").textContent = clock(round.sec);
    const missed = Object.entries(round.keys).filter(([, k]) => k[1] > 0)
      .sort((a, b) => b[1][1] - a[1][1] || b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, 3);
    $("rMissed").replaceChildren(...(missed.length
      ? missed.map(([ch, k]) => noteChip(ch, `${k[1]}/${k[0]}`, `ผิด ${k[1]} จาก ${k[0]} ครั้ง`))
      : [document.createTextNode("ไม่มี")]));
    const slow = slowChars(round.keys);
    $("rSlow").replaceChildren(...(slow.length
      ? slow.map((s) => noteChip(s.ch, `×${s.ratio.toFixed(1)}`, `ช้ากว่าปกติ ${s.ratio.toFixed(1)} เท่า (เฉลี่ย ${secs(s.ms)})`))
      : [document.createTextNode("ไม่มี")]));
    const pass = $("rPass"), hint = $("rHint");
    pass.hidden = hint.hidden = settings.mode !== "lesson";
    if (settings.mode === "lesson") {
      const rule = store.ruleFor(settings.criteria, round.lesson);
      const level = store.roundLevel(round, rule);
      pass.className = "pass lvl-" + level;
      pass.textContent = level === "fail" ? `ยังไม่ผ่านบทนี้ เกณฑ์คือ ${ruleText(rule)}` : "✓ ผ่านบทนี้แล้ว";
      hint.hidden = level !== "pass";
      hint.textContent = `ได้${ruleText(store.excellentRule(rule))} จะเป็นสีเขียว`;
    }
    buildKeyboard($("rKeyboard"));
    paintHeat($("rKeyboard"), round.keys);
  }

  function finish() {
    if (finished) return;
    // freeze the clock so wpm stays fixed after the test ends
    endedAt = settings.mode === "time" ? startedAt + settings.time * 1000 : Date.now();
    finished = true;
    clearInterval(timerId);
    const round = saveRound();
    render();
    // a lesson passed with excellence moves on to the next lesson by itself
    const excellent = round && settings.mode === "lesson"
      && store.roundLevel(round, store.ruleFor(settings.criteria, round.lesson)) === "excellent";
    if (excellent && hasNextLesson()) {
      advancedFrom = settings.lesson;
      settings.lesson += 1;
      saveSettings();
    }
    if (settings.mode === "lesson") renderConfig(); // lesson strip and ✓ in the lesson list
    const moved = $("rAdvanced");
    moved.hidden = advancedFrom === null;
    moved.textContent = `ไปบทถัดไปแล้ว: ${currentLesson().title}`;
    // what next: same set again, a new set, or (in lessons) the next lesson
    const next = $("afterNext");
    next.hidden = advancedFrom !== null || !hasNextLesson();
    if (!next.hidden) next.querySelector("span").textContent = DATA.lessons[settings.lesson + 1].title;
    $("restart").hidden = true;
    if (round) renderResult(round);
    $("resultDlg").showModal();
    $("afterNew").focus();
  }

  function onInput() {
    if (finished || !target.length) { inputEl.value = typed.join(""); return; }
    const now = Array.from(inputEl.value);
    if (!startedAt && now.length) {
      startedAt = Date.now();
      textEl.classList.add("typing");
      $("stage").classList.add("typing");
      timerId = setInterval(() => {
        updateCounter();
        if (settings.mode === "time" && elapsed() >= settings.time) finish();
      }, 100);
    }
    // count only newly added characters toward accuracy and per-key stats; a key's time is the
    // gap since the previous change (typing or Backspace), split across chars added together
    const t = Date.now();
    const added = now.length - typed.length;
    for (let i = typed.length; i < now.length; i++) {
      total++;
      const ok = now[i] === target[i];
      if (!ok) errors++;
      if (target[i] === undefined) continue;
      const st = keyStats[target[i]] || (keyStats[target[i]] = [0, 0, 0, 0]);
      st[0]++;
      if (!ok) st[1]++;
      if (lastKeyAt) { st[2]++; st[3] += (t - lastKeyAt) / added; }
    }
    if (now.length !== typed.length) lastKeyAt = t;
    typed = now;
    // time mode: keep the text from running out
    if (settings.mode === "time" && target.length - typed.length < 80) {
      target.push(...Array.from(" " + genWords(20).join(" ")));
    }
    if (settings.mode !== "time" && typed.length >= target.length) { finish(); return; }
    render();
  }

  // Backspace removes one code point (e.g. just the tone mark), not the whole grapheme cluster
  function onKeyDown(e) {
    // Enter never types a character. After a round: Enter = new set, Shift+Enter = same set again,
    // Ctrl+Enter = next lesson (the shortcuts are printed on the buttons)
    if (e.key === "Enter") {
      e.preventDefault();
      if (!finished) return;
      if (e.shiftKey) again();
      else if (e.ctrlKey || e.metaKey) goNext();
      else fresh();
      return;
    }
    if (e.key !== "Backspace" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    if (finished || !inputEl.value) return;
    inputEl.value = Array.from(inputEl.value).slice(0, -1).join("");
    onInput();
  }

  // ---- pass criteria dialog ----
  let draft = null;
  function ruleInputs(rule, onChange) {
    const wrap = el("div", "rule");
    [["acc", "ความแม่นยำ", "%", 0, 100], ["wpm", "ความเร็ว", "WPM", 1, 300]].forEach(([k, name, unit, min, max]) => {
      const lab = el("label", "check");
      const cb = el("input"); cb.type = "checkbox"; cb.checked = rule[k].on;
      const num = el("input"); num.type = "number"; num.min = min; num.max = max; num.value = rule[k].v;
      num.disabled = !rule[k].on;
      num.setAttribute("aria-label", `${name} ขั้นต่ำ`);
      cb.addEventListener("change", () => { rule[k].on = cb.checked; num.disabled = !cb.checked; onChange && onChange(); });
      num.addEventListener("input", () => {
        const n = Math.round(Number(num.value));
        if (n >= min && n <= max) rule[k].v = n;
      });
      lab.append(cb, document.createTextNode(` ${name}อย่างน้อย `), num, document.createTextNode(` ${unit}`));
      wrap.appendChild(lab);
    });
    return wrap;
  }
  function renderCriteria() {
    const body = $("critBody");
    body.replaceChildren();
    const all = el("label", "check all");
    const cb = el("input"); cb.type = "checkbox"; cb.checked = draft.all;
    cb.addEventListener("change", () => {
      draft.all = cb.checked;
      // per-lesson values are remembered; a lesson set for the first time starts from the shared rule
      if (!draft.all) LESSON_IDS.forEach((id) => { if (!draft.per[id]) draft.per[id] = store.clone(draft.shared); });
      renderCriteria();
    });
    all.append(cb, document.createTextNode(" ใช้เกณฑ์เดียวกันทุกบท"));
    body.appendChild(all);
    if (draft.all) body.appendChild(ruleInputs(draft.shared));
    else {
      const list = el("div", "perLesson");
      DATA.lessons.forEach((l) => {
        const row = el("div", "lessonRule");
        row.append(el("div", "title", l.title), ruleInputs(draft.per[l.id]));
        list.appendChild(row);
      });
      body.appendChild(list);
    }
  }
  function openCriteria() {
    draft = store.clone(settings.criteria);
    renderCriteria();
    $("critDlg").showModal();
  }
  $("critSave").addEventListener("click", () => {
    const next = store.applyCriteria(settings.criteria, draft, LESSON_IDS);
    $("critDlg").close();
    update({ criteria: next });
  });
  $("critCancel").addEventListener("click", () => $("critDlg").close());
  $("critDlg").addEventListener("close", () => inputEl.focus());

  // ---- stats page ----
  const statsView = { range: 30, mode: "all" };
  const DAY = 864e5;
  function statsRounds() {
    const from = statsView.range ? Date.now() - statsView.range * DAY : 0;
    return store.rounds().filter((r) => r.at >= from && (statsView.mode === "all" || r.mode === statsView.mode));
  }
  function segmented(boxId, options, value, onPick) {
    const box = $(boxId);
    box.replaceChildren();
    options.forEach(([v, label]) => {
      const b = el("button", v === value ? "active" : null, label);
      b.type = "button";
      b.setAttribute("aria-pressed", v === value);
      b.addEventListener("click", () => onPick(v));
      box.appendChild(b);
    });
  }
  const dateFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short" });
  const dateTimeFmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  function renderStats() {
    segmented("sRange", [[7, "7 วัน"], [30, "30 วัน"], [0, "ทั้งหมด"]], statsView.range,
      (v) => { statsView.range = v; renderStats(); });
    segmented("sMode", [["all", "ทุกโหมด"], ...Object.entries(MODE_NAMES)], statsView.mode,
      (v) => { statsView.mode = v; renderStats(); });
    renderStrip($("sLessons"), false);
    const list = statsRounds();
    const has = list.length > 0;
    $("sEmpty").hidden = has;
    $("sBody").hidden = !has;
    if (!has) return;
    const avg = (f) => list.reduce((a, r) => a + f(r), 0) / list.length;
    $("sWpm").textContent = Math.round(avg((r) => r.wpm));
    $("sBest").textContent = Math.max(...list.map((r) => r.wpm));
    $("sAcc").textContent = Math.round(avg((r) => r.acc)) + "%";
    $("sRounds").textContent = list.length;
    const mins = Math.round(list.reduce((a, r) => a + r.sec, 0) / 60);
    $("sTime").textContent = mins >= 60 ? `${Math.floor(mins / 60)} ชม. ${mins % 60} นาที` : `${mins} นาที`;
    drawChart(list);
    const agg = store.sumKeys(list);
    buildKeyboard($("sKeyboard"));
    paintHeat($("sKeyboard"), agg);
    renderMissTable(agg);
    renderRoundTable(list);
  }

  // WPM per round (dots) with a 10-round moving average (line); x = round order
  const AVG_N = 10;
  function drawChart(list) {
    const svg = $("sChart");
    const W = Math.max(280, svg.parentElement.clientWidth), H = 220;
    const pad = { l: 36, r: 12, t: 12, b: 26 };
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("width", W); svg.setAttribute("height", H);
    const maxY = Math.max(20, Math.ceil(Math.max(...list.map((r) => r.wpm)) / 10) * 10);
    const n = list.length;
    const x = (i) => pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r));
    const y = (v) => pad.t + (1 - v / maxY) * (H - pad.t - pad.b);
    const avgs = list.map((_, i) => {
      const s = list.slice(Math.max(0, i - AVG_N + 1), i + 1);
      return s.reduce((a, r) => a + r.wpm, 0) / s.length;
    });
    const NS = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs, text) => {
      const e = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
      if (text != null) e.textContent = text;
      return e;
    };
    svg.replaceChildren();
    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = (maxY / ticks) * i;
      svg.append(mk("line", { class: "grid", x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }),
        mk("text", { class: "tick", x: pad.l - 8, y: y(v) + 4, "text-anchor": "end" }, Math.round(v)));
    }
    const lbl = (i, anchor) => svg.append(mk("text", { class: "tick", x: x(i), y: H - 6, "text-anchor": anchor },
      dateFmt.format(list[i].at)));
    lbl(0, n === 1 ? "middle" : "start");
    if (n > 1) lbl(n - 1, "end");
    list.forEach((r, i) => svg.append(mk("circle", { class: "dot", cx: x(i), cy: y(r.wpm), r: 4 })));
    if (n > 1) svg.append(mk("path", { class: "avg",
      d: avgs.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("") }));
    // crosshair + tooltip snapped to the nearest round
    const cross = mk("line", { class: "cross", y1: pad.t, y2: H - pad.b, visibility: "hidden" });
    const hit = mk("rect", { class: "hit", x: pad.l - 6, y: 0, width: W - pad.l - pad.r + 12, height: H });
    svg.append(cross, hit);
    const nearest = (cx) => n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round((cx - pad.l) / (W - pad.l - pad.r) * (n - 1))));
    hit.addEventListener("pointermove", (e) => {
      const box = svg.getBoundingClientRect();
      const i = nearest((e.clientX - box.left) * (W / box.width));
      const r = list[i];
      cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      showTip(box.left + x(i) * (box.width / W), box.top + y(r.wpm) * (box.height / H), [
        [`${r.wpm} WPM`, `ความแม่นยำ ${r.acc}%`],
        [`${Math.round(avgs[i])}`, `เฉลี่ย ${Math.min(AVG_N, i + 1)} รอบล่าสุด`],
        [dateTimeFmt.format(r.at), roundLabel(r)],
      ]);
    });
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
  }
  function roundLabel(r) {
    if (r.mode !== "lesson") return MODE_NAMES[r.mode] || r.mode;
    const l = DATA.lessons.find((x) => x.id === r.lesson);
    return l ? l.title : MODE_NAMES.lesson;
  }
  function tableRow(cells, head) {
    const tr = el("tr");
    cells.forEach((c) => tr.appendChild(el(head ? "th" : "td", null, c)));
    return tr;
  }
  function renderMissTable(agg) {
    const rows = Object.entries(agg).filter(([, k]) => k[1] > 0)
      .sort((a, b) => b[1][1] / b[1][0] - a[1][1] / a[1][0]).slice(0, 10);
    const t = $("sMiss");
    t.replaceChildren(tableRow(["ตัวอักษร", "ผิด", "จากทั้งหมด", "อัตราผิด", "เวลาเฉลี่ย"], true));
    if (!rows.length) { t.appendChild(tableRow(["ไม่มีตัวที่พิมพ์ผิดในช่วงนี้", "", "", "", ""])); return; }
    rows.forEach(([ch, [n, bad, timed, ms]]) =>
      t.appendChild(tableRow([ch === " " ? "เว้นวรรค" : show(ch), bad, n, pct(bad / n), timed ? secs(ms / timed) : "–"])));
  }
  function renderRoundTable(list) {
    const t = $("sRoundsTable");
    t.replaceChildren(tableRow(["เวลา", "โหมด", "WPM", "ความแม่นยำ"], true));
    [...list].reverse().forEach((r) => t.appendChild(tableRow([dateTimeFmt.format(r.at), roundLabel(r), r.wpm, r.acc + "%"])));
  }

  let viewing = "practice";
  function showView(v) {
    viewing = v;
    document.body.dataset.view = v;
    $("practice").hidden = v !== "practice";
    $("statsView").hidden = v !== "stats";
    $("statsBtn").setAttribute("aria-pressed", v === "stats");
    hideTip();
    if (v === "stats") renderStats();
    else { start(); }
  }

  // ---- first visit & small screens ----
  function renderIntro() {
    const row = LAYOUT.rows[2];
    const hands = $("introKeys");
    hands.replaceChildren();
    row.base.slice(0, 10).forEach((ch, c) => {
      if (c === 4 || c === 5) return; // เ and ้ sit between the hands
      const k = el("span", `chip big f-${row.fingers[c]}` + (bumps.has(`2,${c}`) ? " bump" : ""), show(ch));
      k.title = "นิ้ว" + FINGERS[row.fingers[c]];
      hands.appendChild(k);
      if (c === 3) hands.appendChild(el("span", "gap"));
    });
  }
  function closeIntro(goLesson) {
    store.save(store.KEYS.intro, true);
    $("intro").hidden = true;
    if (goLesson) update({ mode: "lesson", lesson: 0 });
    else { highlightNext(); inputEl.focus(); }
  }
  const touchOnly = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;

  // ---- wiring ----
  buildKeyboard(kbEl);
  wireHeatTips(kbEl);
  wireHeatTips($("sKeyboard"));
  $("legend").replaceChildren(...Object.entries(FINGERS).map(([f, name]) => {
    const s = el("span"); s.append(el("i", "f-" + f), document.createTextNode(name)); return s;
  }));
  renderConfig();
  $("realWords").addEventListener("click", () => update({ realWords: !settings.realWords }));
  document.querySelectorAll("#modes button").forEach((b) =>
    b.addEventListener("click", () => update({ mode: b.dataset.mode })));
  $("restart").addEventListener("click", () => start());
  $("afterRepeat").addEventListener("click", again);
  $("afterNew").addEventListener("click", fresh);
  $("afterNext").addEventListener("click", goNext);
  // the result popup closes only through its actions: ×, Esc and Enter start a new set
  $("resultClose").addEventListener("click", fresh);
  $("resultDlg").addEventListener("cancel", (e) => { e.preventDefault(); fresh(); });
  $("resultDlg").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault(); // not a click on the focused button: the modifiers pick the action
    if (e.shiftKey) again(); else if (e.ctrlKey || e.metaKey) goNext(); else fresh();
  });
  $("theme").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    if (viewing === "practice") inputEl.focus();
  });
  $("statsBtn").addEventListener("click", () => showView(viewing === "stats" ? "practice" : "stats"));
  $("statsBack").addEventListener("click", () => showView("practice"));
  window.addEventListener("resize", () => { if (viewing === "stats" && !$("sBody").hidden) drawChart(statsRounds()); });
  $("introStart").addEventListener("click", () => closeIntro(true));
  $("introSkip").addEventListener("click", () => closeIntro(false));
  $("noticeClose").addEventListener("click", () => { $("notice").hidden = true; });
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeyDown);
  inputEl.addEventListener("paste", (e) => e.preventDefault());
  inputEl.addEventListener("focus", () => textEl.classList.remove("blur"));
  inputEl.addEventListener("blur", () => textEl.classList.add("blur"));
  textEl.addEventListener("click", () => inputEl.focus());
  const modal = () => !!document.querySelector("dialog[open]");
  // Tab + Enter starts a new set at any time. Tab is only taken over while typing, so it still
  // moves focus normally through the settings bar.
  let tabArmed = false, tabTimer = 0;
  document.addEventListener("keydown", (e) => {
    if (viewing !== "practice" || modal()) return;
    const typing = document.activeElement === inputEl || document.activeElement === document.body;
    if (e.key === "Tab" && typing) {
      e.preventDefault();
      tabArmed = true;
      clearTimeout(tabTimer);
      return;
    }
    if (e.key === "Enter" && tabArmed) {
      e.preventDefault();
      e.stopPropagation(); // don't let the textarea's Enter handler run too
      tabArmed = false;
      start();
    }
  }, true);
  document.addEventListener("keyup", (e) => {
    // Tab can be held, or tapped just before Enter
    if (e.key === "Tab") tabTimer = setTimeout(() => { tabArmed = false; }, 1000);
  });
  document.addEventListener("keydown", (e) => {
    if (modal()) return;
    if (e.key.length === 1 && touchOnly) $("notice").hidden = true; // a real keyboard is attached
    if (viewing === "stats") { if (e.key === "Escape") showView("practice"); return; }
    if (e.key === "Escape") { e.preventDefault(); start(); return; }
    if (e.key === "Enter" && finished && document.activeElement === document.body) { onKeyDown(e); return; }
    if (!$("intro").hidden) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key.length === 1 && tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT") inputEl.focus();
  });

  $("notice").hidden = !touchOnly;
  if (!store.load(store.KEYS.intro, false)) { renderIntro(); $("intro").hidden = false; }
  start();
  if (!$("intro").hidden) $("introStart").focus();

  // for account.js: settings sync in both directions
  window.TT.app = {
    settings: () => settings,
    onSettings: (f) => settingsListeners.push(f),
    // apply settings from the cloud (theme is per device and never part of them)
    applySettings(s) {
      settings = { ...DEFAULTS, ...s };
      store.save(store.KEYS.settings, settings);
      renderConfig();
      if (viewing === "practice" && !startedAt) start(); else if (viewing === "stats") renderStats();
    },
    resetLocal() {
      settings = { ...DEFAULTS, criteria: store.defaultCriteria() };
      store.save(store.KEYS.settings, settings);
      renderConfig();
      showView("practice");
    },
    refresh() { renderConfig(); if (viewing === "stats") renderStats(); },
  };
})();
