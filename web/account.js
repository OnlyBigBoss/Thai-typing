// Sign-in and sync through Supabase (docs/adr/0002-supabase-local-first.md). The page never
// depends on this: rounds and settings are always written locally first, and pushed up when
// signed in and online. Does nothing unless web/config.js has a Supabase project.
(() => {
  const cfg = window.TT_CONFIG || {};
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) return;
  const store = window.TT.store, app = window.TT.app;
  const $ = (id) => document.getElementById(id);
  const SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js";
  const BATCH = 500;
  let db = null, user = null, lastSync = 0, view = "main", message = null, busy = false;

  const pending = () => store.load(store.KEYS.pending, []);
  const setPending = (ids) => store.save(store.KEYS.pending, ids);

  // ---- sync ----
  const toRow = (r) => ({ id: r.id, at: new Date(r.at).toISOString(), data: r });
  async function pushRounds(list) {
    for (let i = 0; i < list.length; i += BATCH) {
      const { error } = await db.from("rounds").upsert(list.slice(i, i + BATCH).map(toRow), { ignoreDuplicates: true });
      if (error) throw error;
    }
  }
  async function pullRounds() {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from("rounds").select("data").order("at").range(from, from + 999);
      if (error) throw error;
      out.push(...data.map((d) => d.data));
      if (data.length < 1000) return out;
    }
  }
  async function pushSettings() {
    const { error } = await db.from("user_settings").upsert({ user_id: user.id, settings: app.settings(),
      updated_at: new Date().toISOString() });
    if (error) throw error;
  }
  // first sync after signing in on this device: union of rounds both ways; settings from the
  // cloud win when the account already has some
  async function initialSync() {
    const cloud = await pullRounds();
    const cloudIds = new Set(cloud.map((r) => r.id));
    store.mergeRounds(cloud);
    await pushRounds(store.rounds().filter((r) => !cloudIds.has(r.id)));
    setPending([]);
    const { data, error } = await db.from("user_settings").select("settings").maybeSingle();
    if (error) throw error;
    if (data && data.settings) app.applySettings(data.settings); else await pushSettings();
    lastSync = Date.now();
    app.refresh();
  }
  // upload rounds finished while signed in; returns true when nothing is left waiting
  async function flush() {
    const ids = new Set(pending());
    if (!user || !ids.size) return !ids.size;
    try {
      await pushRounds(store.rounds().filter((r) => ids.has(r.id)));
      setPending(pending().filter((id) => !ids.has(id)));
      lastSync = Date.now();
      return pending().length === 0;
    } catch { return false; } finally { renderIfOpen(); }
  }
  let settingsTimer = 0, settingsDirty = false;
  function queueSettings() {
    if (!user) return;
    settingsDirty = true;
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(async () => {
      try { await pushSettings(); settingsDirty = false; } catch { /* retried on the next change or sign-out */ }
    }, 1000);
  }

  // ---- messages ----
  const ERRORS = [
    [/invalid login credentials/i, "อีเมลหรือรหัสผ่านไม่ถูกต้อง"],
    [/email not confirmed/i, "ยังไม่ได้ยืนยันอีเมล เปิดลิงก์ในอีเมลที่เราส่งไปก่อน แล้วค่อยเข้าสู่ระบบ"],
    [/already registered/i, "อีเมลนี้สมัครไว้แล้ว ลองเข้าสู่ระบบแทน"],
    [/password should be at least/i, "รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร"],
    [/rate limit|too many/i, "ลองบ่อยเกินไป รอสักครู่แล้วลองใหม่"],
    [/fetch|network/i, "เชื่อมต่ออินเทอร์เน็ตไม่ได้ ลองใหม่อีกครั้ง"],
  ];
  const explain = (e) => (ERRORS.find(([re]) => re.test(e && e.message)) || [0, `ทำรายการไม่สำเร็จ (${e && e.message})`])[1];
  const say = (text, ok) => { message = { text, ok }; render(); };

  // ---- dialog ----
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  function button(text, onClick, cls) {
    const b = el("button", cls, text);
    b.type = "button";
    b.disabled = busy;
    b.addEventListener("click", onClick);
    return b;
  }
  function field(type, label, autocomplete) {
    const lab = el("label", "field");
    const inp = el("input");
    inp.type = type; inp.autocomplete = autocomplete; inp.required = true;
    lab.append(el("span", null, label), inp);
    return [lab, inp];
  }
  const privacyLink = () => {
    const a = el("a", "privacy", "นโยบายความเป็นส่วนตัว");
    a.href = "privacy.html"; a.target = "_blank"; a.rel = "noopener";
    return a;
  };
  async function run(fn) {
    busy = true; message = null; render();
    try { await fn(); } catch (e) { message = { text: explain(e) }; }
    busy = false; render();
  }
  const here = () => location.origin + location.pathname;

  function render() {
    const body = $("accountBody");
    body.replaceChildren();
    const add = (...n) => body.append(...n);
    if (view === "recovery") {
      const [lab, pass] = field("password", "รหัสผ่านใหม่", "new-password");
      add(el("p", "hint", "ตั้งรหัสผ่านใหม่สำหรับบัญชีนี้"), lab, button("ตั้งรหัสผ่านใหม่", () => run(async () => {
        const { error } = await db.auth.updateUser({ password: pass.value });
        if (error) throw error;
        view = "main"; message = { text: "ตั้งรหัสผ่านใหม่แล้ว", ok: true };
      }), "primary"));
    } else if (view === "deleting") {
      add(el("p", null, "ลบบัญชีและข้อมูลการฝึกทั้งหมดทั้งบนคลาวด์และในเครื่องนี้ ลบแล้วกู้คืนไม่ได้"),
        el("div", "rowActions"));
      body.lastChild.append(button("ยกเลิก", () => { view = "main"; render(); }),
        button("ลบบัญชีถาวร", () => run(async () => {
          const { error } = await db.rpc("delete_account");
          if (error) throw error;
          await db.auth.signOut({ scope: "local" });
          clearDevice();
          view = "main"; message = { text: "ลบบัญชีและข้อมูลทั้งหมดแล้ว", ok: true };
        }), "danger"));
    } else if (view === "leaving") {
      add(el("p", null, `ยังส่งข้อมูล ${pending().length} รอบขึ้นคลาวด์ไม่ได้ (อาจเพราะออฟไลน์อยู่) ถ้าออกจากระบบตอนนี้ รอบเหล่านี้จะหายไป`),
        el("div", "rowActions"));
      body.lastChild.append(button("ลองส่งอีกครั้ง", () => signOut()),
        button("ออกจากระบบเลย", () => signOut(true), "danger"));
    } else if (user) {
      const waiting = pending().length;
      add(el("p", null, `เข้าสู่ระบบด้วย ${user.email}`),
        el("p", "hint", waiting ? `รอส่งขึ้นคลาวด์ ${waiting} รอบ จะส่งให้เองเมื่อออนไลน์`
          : lastSync ? `ซิงก์ล่าสุด ${new Date(lastSync).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}` : "ซิงก์แล้ว"),
        el("div", "rowActions"));
      body.lastChild.append(button("ออกจากระบบ", () => signOut()),
        button("ลบบัญชี", () => { view = "deleting"; message = null; render(); }, "danger"));
      add(privacyLink());
    } else {
      const google = button("ล็อกอินด้วย Google", () => run(async () => {
        const { error } = await db.auth.signInWithOAuth({ provider: "google", options: { redirectTo: here() } });
        if (error) throw error;
      }), "primary wide");
      const form = el("form", "emailForm");
      const [eLab, email] = field("email", "อีเมล", "email");
      const [pLab, pass] = field("password", "รหัสผ่าน", "current-password");
      form.append(eLab, pLab, el("div", "rowActions"));
      form.lastChild.append(
        button("เข้าสู่ระบบ", () => form.requestSubmit(), "primary"),
        button("สมัครสมาชิก", () => {
          if (!form.reportValidity()) return;
          run(async () => {
            const { data, error } = await db.auth.signUp({ email: email.value, password: pass.value,
              options: { emailRedirectTo: here() } });
            if (error) throw error;
            // an address that already has an account comes back with no identities
            if (data.user && data.user.identities && !data.user.identities.length) throw new Error("already registered");
            if (!data.session) message = { text: `ส่งอีเมลยืนยันไปที่ ${email.value} แล้ว เปิดลิงก์ในอีเมลเพื่อเริ่มใช้บัญชี`, ok: true };
          });
        }));
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        run(async () => {
          const { error } = await db.auth.signInWithPassword({ email: email.value, password: pass.value });
          if (error) throw error;
        });
      });
      const forgot = button("ลืมรหัสผ่าน", () => {
        if (!email.value) { email.focus(); say("ใส่อีเมลก่อน แล้วกดลืมรหัสผ่านอีกครั้ง"); return; }
        run(async () => {
          const { error } = await db.auth.resetPasswordForEmail(email.value, { redirectTo: here() });
          if (error) throw error;
          message = { text: `ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${email.value} แล้ว`, ok: true };
        });
      }, "link");
      add(el("p", "hint", "ไม่ล็อกอินก็ใช้ได้ครบทุกอย่าง ล็อกอินเพื่อใช้ความคืบหน้าเดียวกันได้ทุกเครื่อง"),
        google, el("p", "or", "หรือใช้อีเมล"), form, forgot, privacyLink());
    }
    if (message) add(el("p", "msg" + (message.ok ? " ok" : ""), message.text));
  }
  const renderIfOpen = () => { if ($("accountDlg").open) render(); };

  function clearDevice() {
    user = null;
    store.clearRounds();
    store.remove(store.KEYS.pending);
    app.resetLocal(); // theme and the first-visit card stay as they are
    $("accountBtn").classList.remove("signed");
  }
  // wait for uploads first; if they can't go, warn before losing them (unless forced)
  async function signOut(force) {
    busy = true; render();
    const clean = (await flush()) && (!settingsDirty || await pushSettings().then(() => true, () => false));
    busy = false;
    if (!clean && !force) { view = "leaving"; render(); return; }
    await db.auth.signOut({ scope: "local" });
    clearDevice();
    view = "main"; message = { text: "ออกจากระบบแล้ว", ok: true };
    render();
  }

  // ---- start ----
  function onSignedIn(session) {
    if (user && user.id === session.user.id) return;
    user = session.user;
    $("accountBtn").classList.add("signed");
    $("accountBtn").title = "บัญชี: " + user.email;
    initialSync().catch(() => { /* stays local; rounds are uploaded on the next sync */ }).finally(renderIfOpen);
  }
  function boot() {
    db = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
    $("accountBtn").hidden = false;
    $("accountBtn").addEventListener("click", () => { message = null; view = view === "recovery" ? view : "main"; render(); $("accountDlg").showModal(); });
    $("accountClose").addEventListener("click", () => $("accountDlg").close());
    store.onRound((r) => { if (user) { setPending([...pending(), r.id]); flush(); } });
    app.onSettings(queueSettings);
    window.addEventListener("online", flush);
    db.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") { view = "recovery"; render(); $("accountDlg").showModal(); }
      if (session && session.user) setTimeout(() => onSignedIn(session)); // outside the auth callback
    });
  }
  if (window.supabase) { boot(); return; }
  const s = document.createElement("script");
  s.src = SDK;
  s.onload = boot;
  document.head.appendChild(s);
})();
