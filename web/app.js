(() => {
  const DATA = window.TH_DATA;
  const LAYOUT = DATA.layout;
  const $ = (id) => document.getElementById(id);
  const textEl = $("text"), inputEl = $("input"), kbEl = $("keyboard"), counterEl = $("counter");
  const COMBINING = /[ัิ-ฺ็-๎]/;
  const KEYS = { settings: "thai-typing-settings", theme: "thai-typing-theme" };
  const PRESETS = { time: [15, 30, 60, 120], words: [10, 25, 50, 100], lessonCount: [5, 10, 15, 25] };
  const LIMITS = { time: [5, 600], words: [1, 500], lessonCount: [1, 200] };
  const segmenter = new Intl.Segmenter("th", { granularity: "grapheme" });
  const FINGERS = { LP: "ก้อยซ้าย", LR: "นางซ้าย", LM: "กลางซ้าย", LI: "ชี้ซ้าย",
    RI: "ชี้ขวา", RM: "กลางขวา", RR: "นางขวา", RP: "ก้อยขวา", T: "โป้ง" };
  // single words (no spaces) for time/words modes
  const WORD_POOL = DATA.lessons.filter((l) => ["words", "clusters", "tones"].includes(l.id))
    .flatMap((l) => l.items).filter((w) => !w.includes(" "));

  // pieces for made-up syllables when "real words" is off
  const PARTS = {
    cons: "กขคฆงจฉชซญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ",
    lead: "เแโใไ", above: "ัิีึื", below: "ุู", tone: "่้๊๋", after: "าะำ", final: "กงดนบมยวร",
  };
  const ALL_CHARS = new Set(LAYOUT.rows.flatMap((r) => [...r.base, ...r.shift]));

  let settings = { mode: "time", time: 30, words: 25, lesson: 0, lessonCount: 10, realWords: true };
  let target = [];           // code points of the target text
  let typed = [];            // code points typed so far
  let total = 0, errors = 0; // keystroke counters (errors stay counted after backspace)
  let startedAt = 0, endedAt = 0, timerId = 0, finished = false;
  let baseText = "";          // text the round started with (for "same set again")

  // ---- storage ----
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* unavailable */ } };
  settings = { ...settings, ...load(KEYS.settings, {}) };

  // ---- theme ----
  function setTheme(t) { document.documentElement.dataset.theme = t; save(KEYS.theme, t); }
  setTheme(load(KEYS.theme, "dark"));

  // ---- keyboard ----
  const show = (ch) => (COMBINING.test(ch) ? "◌" + ch : ch);
  const keyOf = new Map(); // char -> { r, c, shift, finger }
  LAYOUT.rows.forEach((row, r) => ["base", "shift"].forEach((layer) =>
    row[layer].forEach((ch, c) => {
      if (!keyOf.has(ch)) keyOf.set(ch, { r, c, shift: layer === "shift", finger: row.fingers[c] });
    })));
  const bumps = new Set(LAYOUT.bumps.map(([r, c]) => `${r},${c}`));

  // modifier keys around each row so the board looks like a real one (every row = 15 units)
  const EXTRA = [
    { after: [{ label: "Backspace", w: 2, finger: "RP" }] },
    { before: [{ label: "Tab", w: 1.5, finger: "LP" }], lastW: 1.5 },
    { before: [{ label: "Caps Lock", w: 1.75, finger: "LP" }], after: [{ label: "Enter", w: 2.25, finger: "RP" }] },
    { before: [{ label: "Shift", w: 2.25, id: "shiftL", finger: "LP" }],
      after: [{ label: "Shift", w: 2.75, id: "shiftR", finger: "RP" }] },
  ];

  function modKey({ label, w, id, finger }) {
    const k = document.createElement("div");
    k.className = "key mod" + (finger ? " f-" + finger : "");
    if (finger) k.title = "นิ้ว" + FINGERS[finger];
    k.style.setProperty("--w", w);
    k.textContent = label;
    if (id) k.id = id;
    return k;
  }

  function buildKeyboard() {
    kbEl.replaceChildren();
    LAYOUT.rows.forEach((row, r) => {
      const rowEl = document.createElement("div");
      rowEl.className = "krow";
      (EXTRA[r].before || []).forEach((m) => rowEl.appendChild(modKey(m)));
      row.base.forEach((ch, c) => {
        const k = document.createElement("div");
        k.className = `key f-${row.fingers[c]}` + (bumps.has(`${r},${c}`) ? " bump" : "");
        if (EXTRA[r].lastW && c === row.base.length - 1) k.style.setProperty("--w", EXTRA[r].lastW);
        k.dataset.r = r; k.dataset.c = c;
        k.title = "นิ้ว" + FINGERS[row.fingers[c]];
        const s = document.createElement("span"); s.className = "s"; s.textContent = show(row.shift[c]);
        const b = document.createElement("span"); b.className = "b"; b.textContent = show(ch);
        k.append(s, b);
        rowEl.appendChild(k);
      });
      (EXTRA[r].after || []).forEach((m) => rowEl.appendChild(modKey(m)));
      kbEl.appendChild(rowEl);
    });
    const last = document.createElement("div");
    last.className = "krow";
    [{ label: "Ctrl", w: 1.5, finger: "LP" }, { label: "Alt", w: 1.5, finger: "T" },
      { label: "", w: 9, id: "space", finger: "T" },
      { label: "Alt", w: 1.5, finger: "T" }, { label: "Ctrl", w: 1.5, finger: "RP" }].forEach((m) => last.appendChild(modKey(m)));
    kbEl.appendChild(last);

    $("legend").innerHTML = Object.entries(FINGERS).map(([f, name]) =>
      `<span><i class="f-${f}"></i>${name}</span>`).join("");
  }

  function highlightNext() {
    kbEl.querySelectorAll(".next").forEach((e) => e.classList.remove("next"));
    const ch = target[typed.length];
    const k = keyOf.get(ch);
    kbEl.classList.toggle("live", !finished && (ch === " " || !!k));
    if (ch === undefined || finished) return;
    if (ch === " ") { $("space").classList.add("next"); return; }
    if (!k) return;
    kbEl.querySelector(`[data-r="${k.r}"][data-c="${k.c}"]`).classList.add("next");
    // Shift is pressed with the opposite hand
    if (k.shift) $(k.finger.startsWith("L") ? "shiftR" : "shiftL").classList.add("next");
  }

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
    if (settings.mode === "lesson") {
      const sel = document.createElement("select");
      sel.setAttribute("aria-label", "บทเรียน");
      DATA.lessons.forEach((l, i) => sel.add(new Option(l.title, i)));
      sel.value = settings.lesson;
      sel.addEventListener("change", () => update({ lesson: +sel.value }));
      box.appendChild(sel);
      if (currentLesson().type === "paragraph") return; // a paragraph is always one whole item
    }
    const key = amountKey();
    const presets = PRESETS[key];
    presets.forEach((n) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = n;
      b.classList.toggle("active", settings[key] === n);
      b.addEventListener("click", () => update({ [key]: n }));
      box.appendChild(b);
    });
    const custom = document.createElement("button");
    custom.type = "button";
    custom.title = "กำหนดเอง";
    const isCustom = !presets.includes(settings[key]);
    custom.textContent = isCustom ? `✎ ${settings[key]}` : "✎";
    custom.classList.toggle("active", isCustom);
    custom.addEventListener("click", () => openCustom(custom));
    box.appendChild(custom);
  }
  const amountKey = () => (settings.mode === "lesson" ? "lessonCount" : settings.mode);
  const currentLesson = () => DATA.lessons[settings.lesson] || DATA.lessons[0];

  function openCustom(btn) {
    const mode = amountKey();
    const [min, max] = LIMITS[mode];
    const inp = document.createElement("input");
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

  function update(patch) {
    settings = { ...settings, ...patch };
    save(KEYS.settings, settings);
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
  // a short string drilling just this lesson's new keys (marks get a base letter to sit on)
  function focusString(allowed) {
    const keys = currentLesson().keys;
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
    if (settings.mode === "lesson" && currentLesson().keys.length && r < .6) return focusString(allowed);
    const w = syllable(allowed) + (Math.random() < .4 ? syllable(allowed) : "");
    return w || focusString(allowed);
  }
  // n words for the current settings
  function genWords(n) {
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
    if (settings.mode === "time") return genWords(40).join(" ");
    const lesson = currentLesson();
    if (lesson.type === "paragraph") return pick(lesson.items);
    if (!settings.realWords) return genWords(settings.lessonCount).join(" ");
    // take whole items (drills/sentences keep their word order) until exactly lessonCount words
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
    // Color per grapheme cluster (e.g. ว่): the browser draws a base letter and its tone mark
    // as one glyph and can't color them separately, so a half-typed cluster gets an overlay.
    const frag = document.createDocumentFragment();
    let start = 0;
    for (const { segment } of segmenter.segment(target.join(""))) {
      const cps = Array.from(segment);
      const end = start + cps.length;
      const done = Math.min(Math.max(typed.length - start, 0), cps.length);
      const s = document.createElement("span");
      const cls = [];
      if (segment === " ") cls.push("sp");
      s.textContent = segment;
      if (done > 0) {
        const wrong = cps.slice(0, done).some((ch, k) => typed[start + k] !== ch);
        cls.push(wrong ? "bad" : done === cps.length ? "ok" : "part");
      }
      if (!finished && done === 0 && typed.length === start) cls.push("cur");
      if (cls.includes("part")) {
        const ov = document.createElement("span");
        ov.className = "ov";
        ov.textContent = cps.slice(0, done).join("");
        s.appendChild(ov);
      }
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
    if (finished) { counterEl.textContent = `${wpm()} wpm · ${accuracy()}%`; return; }
    if (settings.mode === "time") counterEl.textContent = Math.max(0, Math.ceil(settings.time - elapsed()));
    else if (settings.mode === "lesson" && currentLesson().type === "paragraph") counterEl.textContent = "";
    else counterEl.textContent = `${wordsDone()}/${target.filter((ch) => ch === " ").length + 1}`;
  }

  // ---- session control ----
  // start a round; pass the previous text to type the same set again
  function start(text) {
    clearInterval(timerId);
    finished = false; startedAt = 0; endedAt = 0; total = 0; errors = 0; typed = [];
    inputEl.value = "";
    textEl.classList.remove("typing");
    baseText = typeof text === "string" ? text : makeText();
    target = Array.from(baseText);
    $("after").hidden = true;
    $("restart").hidden = false;
    render();
    inputEl.focus();
  }
  const hasNextLesson = () => settings.mode === "lesson" && settings.lesson < DATA.lessons.length - 1;
  function nextLesson() { if (hasNextLesson()) update({ lesson: settings.lesson + 1 }); }

  function finish() {
    if (finished) return;
    // freeze the clock so wpm stays fixed after the test ends
    endedAt = settings.mode === "time" ? startedAt + settings.time * 1000 : Date.now();
    finished = true;
    clearInterval(timerId);
    render();
    // what next: same set again, a new set, or (in lessons) the next lesson
    const next = $("afterNext");
    next.hidden = !hasNextLesson();
    if (hasNextLesson()) next.querySelector("span").textContent = DATA.lessons[settings.lesson + 1].title;
    $("restart").hidden = true;
    $("after").hidden = false;
  }

  function onInput() {
    if (finished) { inputEl.value = typed.join(""); return; }
    const now = Array.from(inputEl.value);
    if (!startedAt && now.length) {
      startedAt = Date.now();
      textEl.classList.add("typing");
      timerId = setInterval(() => {
        updateCounter();
        if (settings.mode === "time" && elapsed() >= settings.time) finish();
      }, 100);
    }
    // count only newly added characters toward accuracy
    for (let i = typed.length; i < now.length; i++) {
      total++;
      if (now[i] !== target[i]) errors++;
    }
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
    // Enter never types a character; after a round it starts a new set
    if (e.key === "Enter") { e.preventDefault(); if (finished) start(); return; }
    if (e.key !== "Backspace" || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault();
    if (finished || !inputEl.value) return;
    inputEl.value = Array.from(inputEl.value).slice(0, -1).join("");
    onInput();
  }

  // ---- wiring ----
  buildKeyboard();
  renderConfig();
  $("realWords").addEventListener("click", () => update({ realWords: !settings.realWords }));
  document.querySelectorAll("#modes button").forEach((b) =>
    b.addEventListener("click", () => update({ mode: b.dataset.mode })));
  $("restart").addEventListener("click", () => start());
  $("afterRepeat").addEventListener("click", () => start(baseText));
  $("afterNew").addEventListener("click", () => start());
  $("afterNext").addEventListener("click", nextLesson);
  $("theme").addEventListener("click", () => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
    inputEl.focus();
  });
  inputEl.addEventListener("input", onInput);
  inputEl.addEventListener("keydown", onKeyDown);
  inputEl.addEventListener("paste", (e) => e.preventDefault());
  inputEl.addEventListener("focus", () => textEl.classList.remove("blur"));
  inputEl.addEventListener("blur", () => textEl.classList.add("blur"));
  textEl.addEventListener("click", () => inputEl.focus());
  // Tab + Enter starts a new set at any time. Tab is only taken over while typing, so it still
  // moves focus normally through the settings bar.
  let tabArmed = false, tabTimer = 0;
  document.addEventListener("keydown", (e) => {
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
    if (e.key === "Escape") { e.preventDefault(); start(); return; }
    const tag = document.activeElement && document.activeElement.tagName;
    if (e.key.length === 1 && tag !== "TEXTAREA" && tag !== "INPUT" && tag !== "SELECT") inputEl.focus();
  });
  start();
})();
