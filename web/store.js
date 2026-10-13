// Local data and the numbers derived from it. No DOM here: app.js draws, account.js syncs.
// Everything (stats page, heat maps, weak keys, lesson passes) is computed from the finished
// rounds in `history.rounds`, so merging two devices is just a union of rounds by id.
(() => {
  const KEYS = {
    settings: "thai-typing-settings", theme: "thai-typing-theme", history: "thai-typing-history",
    intro: "thai-typing-intro", pending: "thai-typing-pending",
  };
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* unavailable */ } };
  const remove = (k) => { try { localStorage.removeItem(k); } catch { /* unavailable */ } };

  // ---- rounds ----
  // round: { id, at, mode, lesson?, wpm, acc, sec, keys: { char: [attempts, errors, timed, ms] } }
  let history = load(KEYS.history, { v: 1, rounds: [] });
  const listeners = [];
  const rounds = () => history.rounds;
  function addRound(r) {
    history.rounds.push(r);
    save(KEYS.history, history);
    listeners.forEach((f) => f(r));
  }
  // union by id, oldest first; returns the rounds that were new to this device
  function mergeRounds(incoming) {
    const have = new Set(history.rounds.map((r) => r.id));
    const added = incoming.filter((r) => r && r.id && !have.has(r.id));
    if (added.length) {
      history.rounds = [...history.rounds, ...added].sort((a, b) => a.at - b.at);
      save(KEYS.history, history);
    }
    return added;
  }
  function clearRounds() { history = { v: 1, rounds: [] }; save(KEYS.history, history); }
  const onRound = (f) => listeners.push(f);

  // ---- per-key numbers ----
  // sum per-char stats over rounds (any order)
  function sumKeys(list) {
    const out = {};
    for (const r of list) for (const [ch, k] of Object.entries(r.keys || {})) {
      const o = out[ch] || (out[ch] = [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) o[i] += k[i];
    }
    return out;
  }

  // Weak keys: per char, look back over the newest rounds until it has ~100 attempts. Score is
  // 70% error rate + 30% slowness (avg time vs the median char of this user), each scaled 0..1
  // against the worst char, so neither unit swamps the other.
  const WEAK = { rounds: 3, minAttempts: 10, window: 100, top: 5 };
  function keyRecent(list) {
    const acc = {};
    for (let i = list.length - 1; i >= 0; i--) {
      for (const [ch, k] of Object.entries(list[i].keys || {})) {
        if (ch === " ") continue;
        const o = acc[ch] || (acc[ch] = [0, 0, 0, 0]);
        if (o[0] >= WEAK.window) continue;
        for (let j = 0; j < 4; j++) o[j] += k[j];
      }
    }
    return acc;
  }
  function weakKeys(list = rounds()) {
    if (list.length < WEAK.rounds) return { ready: false, keys: [] };
    const stats = Object.entries(keyRecent(list))
      .filter(([, k]) => k[0] >= WEAK.minAttempts)
      .map(([ch, [n, bad, timed, ms]]) => ({ ch, n, err: bad / n, ms: timed ? ms / timed : 0 }));
    if (!stats.length) return { ready: false, keys: [] };
    const times = stats.filter((s) => s.ms).map((s) => s.ms).sort((a, b) => a - b);
    const median = times.length ? times[Math.floor(times.length / 2)] : 0;
    stats.forEach((s) => { s.slow = median && s.ms ? Math.max(0, s.ms / median - 1) : 0; });
    const maxErr = Math.max(...stats.map((s) => s.err)) || 1;
    const maxSlow = Math.max(...stats.map((s) => s.slow)) || 1;
    stats.forEach((s) => { s.score = .7 * (s.err / maxErr) + .3 * (s.slow / maxSlow); });
    stats.sort((a, b) => b.score - a.score);
    return { ready: true, keys: stats.slice(0, WEAK.top) };
  }

  // ---- lesson pass criteria ----
  // criteria: { all, shared: {acc:{on,v}, wpm:{on,v}}, per: {lessonId: same}, since: {lessonId: ms} }
  const DEFAULT_RULE = { acc: { on: true, v: 95 }, wpm: { on: false, v: 30 } };
  const defaultCriteria = () => ({ all: true, shared: clone(DEFAULT_RULE), per: {}, since: {} });
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function ruleFor(criteria, lessonId) {
    return (!criteria.all && criteria.per[lessonId]) || criteria.shared;
  }
  // what actually decides a pass; a value whose check is off doesn't matter
  const ruleSig = (r) => JSON.stringify([r.acc.on && r.acc.v, r.wpm.on && r.wpm.v]);
  const meets = (round, rule) => (!rule.acc.on || round.acc >= rule.acc.v) && (!rule.wpm.on || round.wpm >= rule.wpm.v);
  // a pass only counts rounds typed after the lesson's current criteria were set
  function passed(criteria, lessonId, list = rounds()) {
    const rule = ruleFor(criteria, lessonId), since = criteria.since[lessonId] || 0;
    return list.some((r) => r.mode === "lesson" && r.lesson === lessonId && r.at > since && meets(r, rule));
  }
  // saving new criteria: lessons whose effective rule changed lose their pass until re-typed
  function applyCriteria(before, after, lessonIds, now = Date.now()) {
    const next = clone(after);
    next.since = { ...before.since };
    for (const id of lessonIds) {
      if (ruleSig(ruleFor(before, id)) !== ruleSig(ruleFor(next, id))) next.since[id] = now;
    }
    return next;
  }

  window.TT = window.TT || {};
  window.TT.store = {
    KEYS, load, save, remove,
    rounds, addRound, mergeRounds, clearRounds, onRound,
    sumKeys, weakKeys, WEAK,
    DEFAULT_RULE, defaultCriteria, ruleFor, meets, passed, applyCriteria, clone,
  };
})();
