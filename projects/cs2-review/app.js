// CS2 Round Review — UI. Parsing happens in worker.js; scoring in analysis.js + insights.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const pct = (x) => Math.round(x * 100) + "%";
  const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(Math.round(x * 100)) + "%";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  const TAGS = { pug: "PUG", official: "OFFICIAL", ref: "PRO" };

  const S = {
    tag: store.get("cs2r.tag", "pug"),
    match: null, analyses: [], me: null, mistakes: [], highlights: [], baseline: null,
    ri: 0, tick: 0, playing: false, speed: 2, lastTs: 0,
    bounds: null, bg: null, map: null, level: 0, callouts: store.get("cs2r.callouts", true), sideTab: "mistakes",
  };
  const knownMe = () => store.get("cs2r.me", []);

  // ════════════════════ Home: upload ════════════════════
  const segBtns = document.querySelectorAll(".upload-card .seg button");
  function setTag(t) { S.tag = t; store.set("cs2r.tag", t); segBtns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.tag === t))); }
  segBtns.forEach((b) => (b.onclick = () => setTag(b.dataset.tag)));
  setTag(TAGS[S.tag] ? S.tag : "pug");

  const drop = $("drop");
  $("file").onchange = (e) => { enqueue([...e.target.files]); e.target.value = ""; };
  $("folder").onchange = (e) => { enqueue([...e.target.files]); e.target.value = ""; };
  $("pick-files").onclick = () => $("file").click();
  $("pick-folder").onclick = () => $("folder").click();
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", async (e) => enqueue(await filesFromDrop(e.dataTransfer)));
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  // Folders dropped in: walk them for demo files
  async function filesFromDrop(dt) {
    const entries = [...(dt.items || [])].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
    if (!entries.length) return [...dt.files];
    const out = [];
    const walk = async (entry) => {
      if (entry.isFile) { out.push(await new Promise((res, rej) => entry.file(res, rej))); return; }
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res) => reader.readEntries(res, () => res([])));
        if (!batch.length) break;
        for (const x of batch) await walk(x);
      }
    };
    for (const en of entries) await walk(en);
    return out;
  }

  const STEPS = [
    ["read", "Reading file"], ["decompress", "Decompressing"], ["events", "Reading kills, plants, rounds"],
    ["positions", "Reading player positions"], ["build", "Building rounds"],
  ];

  /** Parse one demo in a worker. onStep(name, state, extra) reports progress. */
  function parseFile(file, onStep) {
    return new Promise((resolve, reject) => {
      const w = new Worker("worker.js");
      w.onmessage = (e) => {
        const m = e.data;
        if (m.type === "progress") onStep(m.name, m.state, m.extra);
        else if (m.type === "done") { w.terminate(); resolve(m.match); }
        else if (m.type === "error") { w.terminate(); reject(new Error(m.message)); }
      };
      w.onerror = (e) => { w.terminate(); reject(new Error("The parser crashed: " + (e.message || "unknown error") + ". Very large demos can run out of browser memory; try Chrome or Edge.")); };
      w.postMessage({ file });
    });
  }

  // ── Queue: one demo opens; several are analyzed back to back and saved
  const queue = [];
  let busy = false;
  const isDemo = (f) => /\.(dem|zst|gz|bz2)$/i.test(f.name);

  function enqueue(files) {
    $("error").hidden = true;
    const demos = files.filter(isDemo);
    if (!demos.length) { if (files.length) showError("No demo files found (.dem, .dem.zst, .dem.gz)."); return; }
    const batch = demos.length > 1 || queue.some((j) => j.state === "waiting" || j.state === "parsing");
    for (const f of demos) queue.push({ file: f, tag: S.tag, state: "waiting", openWhenDone: !batch, step: "" });
    renderQueue();
    pump();
  }

  async function pump() {
    if (busy) return;
    const job = queue.find((j) => j.state === "waiting");
    if (!job) { renderLibrary(); return; }
    busy = true; job.state = "parsing";
    const single = job.openWhenDone;
    const prog = $("progress");
    if (single) {
      prog.hidden = false;
      prog.replaceChildren(...STEPS.map(([k, label]) => { const li = el("li"); li.dataset.k = k; li.append(el("span", "lbl", label), el("span", "x", "")); return li; }));
    }
    renderQueue();
    try {
      const match = await parseFile(job.file, (name, state, extra) => {
        if (single) {
          const li = prog.querySelector(`[data-k="${name}"]`);
          if (li) { li.className = state; if (extra) li.querySelector(".x").textContent = extra; }
        } else if (state === "active") { job.step = (STEPS.find((s) => s[0] === name) || [, ""])[1]; renderQueue(); }
      });
      match.tag = job.tag;
      match.fileName = job.file.name;
      const res = processMatch(match);
      await DB.put("matches", res.record);
      await DB.put("data", res.rows);
      job.state = "done"; job.summary = `${match.map.replace(/^de_/, "")} · ${res.record.scoreText}`;
      if (single) { prog.hidden = true; queue.splice(queue.indexOf(job), 1); renderQueue(); await openMatch(match, res.analyses); }
    } catch (err) {
      job.state = "error"; job.msg = err.message;
      if (single) { prog.hidden = true; queue.splice(queue.indexOf(job), 1); showError(err.message); }
    }
    busy = false;
    renderQueue();
    if (!single) renderLibrary();
    pump();
  }

  function renderQueue() {
    const q = $("queue");
    q.hidden = queue.length === 0;
    const done = queue.filter((j) => j.state === "done" || j.state === "error").length;
    const head = el("li", "q-head");
    head.append(el("span", "", `${done} / ${queue.length} analyzed`));
    if (done === queue.length) { const clr = el("button", "link", "Clear"); clr.onclick = () => { queue.length = 0; renderQueue(); }; head.append(clr); }
    q.replaceChildren(head, ...queue.map((j) => {
      const li = el("li", j.state);
      li.append(el("span", "q-name", j.file.name));
      const st = j.state === "parsing" ? (j.step || "starting") + "…" : j.state === "done" ? j.summary : j.state === "error" ? j.msg : "waiting";
      li.append(el("span", "q-state", st));
      if (j.state === "done") {
        const b = el("button", "link", "Open");
        b.onclick = () => { j.state = "waiting"; j.openWhenDone = true; queue.splice(queue.indexOf(j), 1); queue.unshift(j); pump(); };
        li.append(b);
      } else li.append(el("span"));
      return li;
    }));
  }
  function showError(msg) { const e = $("error"); e.textContent = msg; e.hidden = false; }

  /** Everything we compute from a parsed match, independent of the UI. */
  function processMatch(match) {
    const analyses = match.rounds.map((r) => Analysis.analyzeRound(r, match.tickrate));
    const styles = {};
    for (const p of match.players) styles[p.sid] = Insights.styleOf(match, analyses, p.sid);
    const known = knownMe();
    const me = (match.players.find((p) => known.includes(p.sid)) || {}).sid || null;
    const record = makeRecord(match, analyses, styles, me);
    return { analyses, record, rows: Insights.datasetRows(match, analyses) };
  }

  function makeRecord(match, analyses, styles, me) {
    const rec = {
      id: match.id, v: 2, map: match.map, tag: match.tag, savedAt: Date.now(), fileName: match.fileName || "",
      rounds: match.rounds.length, clans: match.clans, score: match.score,
      players: match.players.map((p) => ({ sid: p.sid, name: p.name, clan: p.clan })), styles, me,
      scoreText: match.clans.map((c) => match.score[c]).join(" : "),
    };
    if (me) {
      const mistakes = Insights.enrichMistakes(match, Analysis.findMistakes(match, analyses, me));
      const hl = Insights.findHighlights(match, analyses, me);
      rec.worst = mistakes.slice(0, 5).map((x) => ({ round: x.round + 1, swing: x.swing, tags: x.tags }));
      rec.best = hl.slice(0, 5).map((x) => ({ round: x.round + 1, title: x.title, swing: x.swing, tags: x.tags }));
    }
    return rec;
  }

  // ════════════════════ Library (IndexedDB, this browser only) ════════════════════
  const DB = {
    db: null,
    open() {
      return new Promise((res) => {
        try {
          const r = indexedDB.open("cs2-review", 2);
          r.onupgradeneeded = () => {
            const db = r.result;
            if (!db.objectStoreNames.contains("matches")) db.createObjectStore("matches", { keyPath: "id" });
            if (!db.objectStoreNames.contains("data")) db.createObjectStore("data", { keyPath: "id" });
          };
          r.onsuccess = () => { this.db = r.result; res(); };
          r.onerror = () => res();
        } catch { res(); }
      });
    },
    tx(name, mode) { return this.db && this.db.transaction(name, mode).objectStore(name); },
    all(name = "matches") { return new Promise((res) => { const s = this.tx(name, "readonly"); if (!s) return res([]); const q = s.getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); },
    put(name, v) { return new Promise((res) => { const s = this.tx(name, "readwrite"); if (!s) return res(); const q = s.put(v); q.onsuccess = q.onerror = () => res(); }); },
    del(id) { for (const n of ["matches", "data"]) { const s = this.tx(n, "readwrite"); if (s) s.delete(id); } },
  };
  let libFilter = "all";
  document.querySelectorAll("#lib-filter button").forEach((b) => (b.onclick = () => {
    libFilter = b.dataset.f;
    document.querySelectorAll("#lib-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderLibrary();
  }));

  /** Which player in a saved match is you (any steamid you've picked before). */
  const meIn = (rec) => { const k = knownMe(); return (rec.players || []).find((p) => k.includes(p.sid)) || (rec.me && rec.me.sid ? { sid: rec.me.sid, name: rec.me.name } : null); };

  /** Benchmarks: pro/reference demos first, else everyone else in your saved demos. */
  function baselineFrom(all) {
    const k = knownMe();
    const others = (list) => list.flatMap((r) => Object.entries(r.styles || {}).filter(([sid, s]) => !k.includes(sid) && s.rounds >= 8).map(([, s]) => s));
    const pro = others(all.filter((r) => r.tag === "ref"));
    if (pro.length >= 30) { const b = Insights.baselinesFrom(pro); b.source = "pro / reference demos"; return b; }
    return Insights.baselinesFrom(others(all));
  }

  async function renderLibrary() {
    const all = (await DB.all()).sort((a, b) => b.savedAt - a.savedAt);
    $("library-wrap").hidden = all.length === 0;
    const list = all.filter((m) => libFilter === "all" ? m.tag !== "ref" : m.tag === libFilter);
    const mine = list.map((r) => ({ r, me: meIn(r) })).filter((x) => x.me && x.r.styles && x.r.styles[x.me.sid]);
    const st = Insights.mergeStyles(mine.map((x) => x.r.styles[x.me.sid]));
    const rt = Insights.rates(st);
    const has = mine.length > 0;
    const stats = [
      ["Matches", list.length],
      ["Win prob. added / round", has ? signed(rt.wpa) : "—"],
      ["K / D", has ? (st.kills / Math.max(1, st.deaths)).toFixed(2) : "—"],
      ["Damage / round", has ? Math.round(rt.adr) : "—"],
      ["Opening duels won", has && rt.openWin != null ? pct(rt.openWin) : "—"],
    ];
    $("lib-stats").replaceChildren(...stats.map(([k, v]) => { const d = el("div", "stat"); d.append(el("div", "k", k), el("div", "v", String(v))); return d; }));
    renderStyle(st, mine.length, baselineFrom(all));

    $("library").replaceChildren(...list.map((m) => {
      const li = el("li");
      li.append(el("span", "tag", TAGS[m.tag] || "PUG"));
      const me = meIn(m);
      const mid = el("span");
      mid.append(el("b", "", m.map.replace(/^de_/, "")), document.createTextNode("  " + new Date(m.savedAt).toLocaleDateString() + (me ? " · " + me.name : "")));
      li.append(mid);
      let scoreText = m.scoreText, cls = "";
      const myClan = me && ((m.players || []).find((p) => p.sid === me.sid) || {}).clan;
      if (myClan && m.score) {
        const other = m.clans.find((c) => c !== myClan);
        scoreText = `${m.score[myClan] ?? "?"} : ${m.score[other] ?? "?"}`;
        cls = m.score[myClan] > m.score[other] ? "res-w" : m.score[myClan] < m.score[other] ? "res-l" : "";
      } else if (m.result) cls = m.result === "W" ? "res-w" : m.result === "L" ? "res-l" : "";
      li.append(el("span", "mono " + cls, scoreText));
      const del = el("button", "del", "×"); del.title = "Remove from history";
      del.onclick = () => { DB.del(m.id); renderLibrary(); };
      li.append(del);
      return li;
    }));
  }

  // ── Playstyle panel (home)
  const STYLE_KEYS = [
    ["adr", "Damage / round", (x) => Math.round(x), true],
    ["openPerRound", "Takes first fight", pct, null],
    ["openWin", "First fights won", pct, true],
    ["untraded", "Deaths not traded", pct, false],
    ["isolated", "Deaths far from team", pct, false],
    ["moving", "Died while running", pct, false],
    ["still", "Kills while stopped", pct, true],
    ["nades", "Grenades / round", (x) => x.toFixed(1), true],
    ["utilLeft", "Grenades left at death", (x) => x.toFixed(1), false],
    ["survival", "Rounds survived", pct, null],
  ];
  function styleCell(r, base, [k, label, fmt, higherBetter]) {
    const d = el("div", "stat style-stat");
    const v = r[k], b = base[k];
    d.append(el("div", "k", label), el("div", "v", v == null ? "—" : fmt(v)));
    if (v != null && b != null) {
      const better = higherBetter == null ? null : (higherBetter ? v >= b : v <= b);
      d.append(el("div", "bench " + (better == null ? "" : better ? "good" : "bad"), "benchmark " + fmt(b)));
    }
    return d;
  }
  function renderTodo(ol, items, emptyText) {
    ol.replaceChildren(...(items.length ? items.map((x) => {
      const li = el("li");
      li.append(el("b", "", x.title), el("p", "saw", x.saw), el("p", "do", x.todo));
      return li;
    }) : [el("p", "empty-note", emptyText)]));
  }
  function renderKeep(ul, items, emptyText) {
    ul.replaceChildren(...(items.length ? items.map((x) => { const li = el("li"); li.append(el("b", "", x.title), document.createTextNode(" — " + x.saw)); return li; }) : [el("li", "empty-note", emptyText)]));
  }
  function renderStyle(st, n, baseline) {
    $("style-wrap").hidden = n === 0;
    if (!n) return;
    const r = Insights.rates(st);
    const res = Insights.actionItems(st, baseline);
    $("style-sub").textContent = `${n} match${n > 1 ? "es" : ""} · ${st.rounds} rounds · benchmark: ${baseline.source === "default" ? "rough starting values (add pro demos to sharpen)" : baseline.source + ` (${baseline.n} player-games)`}`;
    $("style-grid").replaceChildren(...STYLE_KEYS.map((k) => styleCell(r, baseline.base, k)));
    renderTodo($("style-fix"), res.fix, n < 3 ? "Add a few more matches to get reliable action items." : "Nothing stands out against the benchmark. Nice.");
    renderKeep($("style-keep"), res.keep, "Shows up once there's enough data.");
    const places = Object.entries(st.deathPlaces || {}).sort((a, b) => b[1] - a[1]).slice(0, 4);
    $("style-places").replaceChildren(...(places.length ? places.map(([k, c]) => { const [sd, p] = k.split("·"); const li = el("li"); li.append(el("b", sd.toLowerCase(), sd), document.createTextNode(` ${p} — ${c} death${c > 1 ? "s" : ""}`)); return li; }) : [el("li", "empty-note", "Needs a demo parsed with this version.")]));
  }

  $("export").onclick = async () => {
    const [matches, data] = await Promise.all([DB.all("matches"), DB.all("data")]);
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), schema: Insights.SCHEMA, me: knownMe(), matches, data })], { type: "application/json" });
    const a = el("a"); a.href = URL.createObjectURL(blob); a.download = `cs2-review-dataset-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };

  // ════════════════════ Match view ════════════════════
  const nameOf = (sid) => (S.match.players.find((p) => p.sid === sid) || {}).name || "?";
  const round = () => S.match.rounds[S.ri];

  async function openMatch(match, analyses) {
    S.match = match;
    S.analyses = analyses || match.rounds.map((r) => Analysis.analyzeRound(r, match.tickrate));
    S.map = await loadMap(match.map);
    S.level = 0;
    S.baseline = baselineFrom(await DB.all());
    computeBounds();
    $("home").hidden = true; $("match").hidden = false;
    $("topbar-match").textContent = `${match.map} · ${match.rounds.length} rounds · ${match.tag === "official" ? "Official / LAN" : match.tag === "ref" ? "Pro / reference" : "PUG"} · parsed in ${match.parseSeconds}s`;
    $("level").hidden = !(S.map && S.map.levels.length > 1);
    $("level").textContent = "Upper";

    const sel = $("me");
    sel.replaceChildren(el("option", "", "Pick yourself…"));
    sel.firstChild.value = "";
    for (const c of match.clans) {
      const g = el("optgroup"); g.label = c.replace(/^team_/, "Team ");
      match.players.filter((p) => p.clan === c).forEach((p) => { const o = el("option", "", p.name); o.value = p.sid; g.append(o); });
      sel.append(g);
    }
    const auto = match.players.find((p) => knownMe().includes(p.sid));
    S.me = auto ? auto.sid : null;
    sel.value = S.me || "";
    sel.onchange = () => {
      S.me = sel.value || null;
      if (S.me) { const k = knownMe(); if (!k.includes(S.me)) { k.push(S.me); store.set("cs2r.me", k); } }
      refreshMe(true);
    };
    refreshMe(false);
    selectRound(0);
    window.scrollTo(0, 0);
  }

  function refreshMe(save) {
    const m = S.match;
    S.mistakes = S.me ? Insights.enrichMistakes(m, Analysis.findMistakes(m, S.analyses, S.me)) : [];
    S.highlights = S.me ? Insights.findHighlights(m, S.analyses, S.me) : [];
    const myClan = S.me && (m.players.find((p) => p.sid === S.me) || {}).clan;
    const [a, b] = myClan ? [myClan, m.clans.find((c) => c !== myClan)] : m.clans;
    $("team-a").textContent = (a || "Team A").replace(/^team_/, "");
    $("team-b").textContent = (b || "Team B").replace(/^team_/, "");
    $("team-a").className = "team" + (myClan ? " mine" : "");
    $("team-b").className = "team";
    $("score").textContent = `${m.score[a] ?? 0} : ${m.score[b] ?? 0}`;
    $("match-meta").textContent = m.map.replace(/^de_/, "").toUpperCase();
    renderRounds(); renderSide(); renderNextGame(); renderBoard(); renderFeed(); renderChart(); draw();
    if (save) {
      const styles = {};
      for (const p of m.players) styles[p.sid] = Insights.styleOf(m, S.analyses, p.sid);
      DB.put("matches", makeRecord(m, S.analyses, styles, S.me));
    }
  }

  function renderRounds() {
    const wrap = $("rounds");
    wrap.replaceChildren();
    const flagged = new Set(S.mistakes.filter((x) => x.swing <= -0.2).map((x) => x.round));
    const good = new Set(S.highlights.filter((x) => x.score >= 0.18).map((x) => x.round));
    S.match.rounds.forEach((r, i) => {
      if (i === 12) wrap.append(el("span", "half"));
      const myTeam = S.me && r.teams[S.me];
      const b = el("button", "rchip");
      if (myTeam && r.winner) b.classList.add(r.winner === myTeam ? "win" : "loss");
      if (i === S.ri) b.classList.add("cur");
      b.append(el("span", "rn", String(i + 1)), el("small", "", myTeam || r.winner || ""));
      b.title = `Round ${i + 1}: ${r.winner ? r.winner + " won (" + reasonText(r.reason) + ")" : "no result"}`;
      if (flagged.has(i)) { b.append(el("span", "flag")); b.title += " · costly death"; }
      if (good.has(i)) { b.append(el("span", "flag good")); b.title += " · highlight"; }
      b.onclick = () => selectRound(i);
      wrap.append(b);
    });
  }

  function selectRound(i, tick) {
    S.ri = i;
    const r = round();
    S.tick = tick ?? r.freezeEndTick - S.match.tickrate;
    document.querySelectorAll(".rchip").forEach((c, k) => c.classList.toggle("cur", k === i));
    renderFeed(); renderChart(); draw(); updateScrub();
  }

  // ── Side panel: costly moments / highlights
  document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => {
    S.sideTab = b.dataset.tab;
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    renderSide();
  }));
  function renderSide() {
    const ol = $("mistakes");
    ol.classList.toggle("good", S.sideTab === "highlights");
    if (!S.me) { ol.replaceChildren(el("p", "empty-note", "Pick yourself in “You are” above to see your costliest moments and best plays.")); return; }
    if (S.sideTab === "highlights") return renderHighlights(ol);
    const top = S.mistakes.filter((x) => x.swing < -0.04).slice(0, 10);
    if (!top.length) { ol.replaceChildren(el("p", "empty-note", "No costly deaths found. Clean game.")); return; }
    ol.replaceChildren(...top.map((x) => {
      const li = el("li");
      const r = S.match.rounds[x.round];
      const tl = (x.tick - r.freezeEndTick) / S.match.tickrate;
      const head = el("div", "m-top");
      head.append(el("span", "", `R${x.round + 1} · ${clockText(tl)} · ${x.team}${x.place ? " · " + x.place : ""}${x.lostRound ? " · round lost" : ""}`), el("span", "m-swing", signed(x.swing)));
      const desc = el("div", "m-desc", `Died in a ${x.situation} to ${nameOf(x.attacker)} (${prettyWeapon(x.weapon)}). Win chance ${pct(x.winBefore)} → ${pct(Math.max(0, x.winBefore + x.swing))}.`);
      const chips = el("div", "chips");
      x.tags.forEach((t) => chips.append(el("span", "chip", t)));
      li.append(head, desc, chips);
      li.onclick = () => { selectRound(x.round, x.tick - S.match.tickrate * 5); play(true); };
      return li;
    }));
  }
  function renderHighlights(ol) {
    const top = S.highlights.slice(0, 12);
    if (!top.length) { ol.replaceChildren(el("p", "empty-note", "No standout plays found this match.")); return; }
    ol.replaceChildren(...top.map((x) => {
      const li = el("li");
      const r = S.match.rounds[x.round];
      const head = el("div", "m-top");
      head.append(el("span", "", `R${x.round + 1} · ${clockText((x.tick - r.freezeEndTick) / S.match.tickrate)} · ${x.team}${x.won ? " · round won" : ""}`),
        el("span", "m-swing", x.swing > 0.005 ? signed(x.swing) : "★"));
      const desc = el("div", "m-desc");
      desc.append(el("b", "", x.title + ". "), document.createTextNode(x.desc));
      const chips = el("div", "chips");
      x.tags.forEach((t) => chips.append(el("span", "chip", t)));
      li.append(head, desc, chips);
      li.onclick = () => { selectRound(x.round, x.tick - S.match.tickrate * 5); play(true); };
      return li;
    }));
  }

  // ── Take into your next game (this match vs benchmark)
  function renderNextGame() {
    $("next-game").hidden = !S.me;
    if (!S.me) return;
    const st = Insights.styleOf(S.match, S.analyses, S.me);
    const res = Insights.actionItems(st, S.baseline || Insights.baselinesFrom([]));
    $("next-sub").textContent = `· from this match${S.baseline && S.baseline.source !== "default" ? ", vs " + S.baseline.source : ""}`;
    renderTodo($("next-fix"), res.fix, "Nothing stands out this match. Keep it up.");
    renderKeep($("next-keep"), res.keep, "Nothing above benchmark this match.");
  }

  // ── Round feed
  function renderFeed() {
    const r = round();
    const a = S.analyses[S.ri];
    const ul = $("feed");
    const myTeam = S.me && r.teams[S.me];
    ul.replaceChildren(...a.scored.map((e) => {
      const li = el("li");
      li.dataset.tick = e.tick;
      li.append(el("span", "ft", clockText((e.tick - r.freezeEndTick) / S.match.tickrate)));
      const body = el("span");
      const nm = (sid) => el("span", (r.teams[sid] || "").toLowerCase() + (sid === S.me ? " me-name" : ""), nameOf(sid));
      if (e.type === "kill") {
        if (e.attacker && e.attacker !== e.victim) body.append(nm(e.attacker), document.createTextNode(" "));
        body.append(el("span", "wep", prettyWeapon(e.weapon) + (e.headshot ? " ◎" : "") + " "), nm(e.victim));
      } else if (e.type === "plant") body.append(nm(e.player), document.createTextNode(" planted the bomb"));
      else if (e.type === "defuse") body.append(nm(e.player), document.createTextNode(" defused the bomb"));
      li.append(body);
      const view = myTeam || "CT";
      const d = e.deltaT * (view === "T" ? 1 : -1);
      li.append(el("span", "delta " + (d > 0.005 ? "pos" : d < -0.005 ? "neg" : ""), signed(d)));
      li.onclick = () => { S.tick = e.tick - S.match.tickrate * 3; draw(); updateScrub(); };
      return li;
    }));
    if (r.winner) {
      const li = el("li");
      li.append(el("span", "ft", ""), el("span", r.winner.toLowerCase(), `${r.winner} win · ${reasonText(r.reason)}`), el("span", ""));
      ul.append(li);
    }
  }

  // ── Scoreboard
  function renderBoard() {
    const st = Analysis.swingStats(S.match, S.analyses);
    const t = $("board");
    t.replaceChildren();
    const head = el("tr");
    ["Player", "K", "D", "ADR", "Opening K–D", "Win prob. added", "Per round"].forEach((h) => head.append(el("th", "", h)));
    t.append(head);
    for (const c of S.match.clans) {
      const tr = el("tr", "teamrow"); const td = el("td", "", c.replace(/^team_/, "Team ") + " · " + (S.match.score[c] ?? 0)); td.colSpan = 7; tr.append(td); t.append(tr);
      S.match.players.filter((p) => p.clan === c)
        .sort((a, b) => ((st[b.sid] || {}).wpa || 0) - ((st[a.sid] || {}).wpa || 0))
        .forEach((p) => {
          const s = st[p.sid] || { kills: 0, deaths: 0, openK: 0, openD: 0, wpa: 0, rounds: 1 };
          const ins = Insights.styleOf(S.match, S.analyses, p.sid);
          const row = el("tr", p.sid === S.me ? "me" : "");
          [p.name, s.kills, s.deaths, Math.round(ins.dmg / Math.max(1, ins.rounds)), `${s.openK}–${s.openD}`, signed(s.wpa), signed(s.wpa / Math.max(1, s.rounds))]
            .forEach((v) => row.append(el("td", "", String(v))));
          t.append(row);
        });
    }
  }

  // ── Win probability chart
  function chartRange() { const r = round(); return [r.freezeEndTick, r.endTick + S.match.tickrate * 2]; }
  function renderChart() {
    const svg = $("wp-chart");
    const r = round(), a = S.analyses[S.ri];
    const view = (S.me && r.teams[S.me]) || "CT";
    $("wp-side").textContent = S.me && r.teams[S.me] ? `your team (${view})` : "CT";
    const [t0, t1] = chartRange();
    const X = (t) => ((t - t0) / (t1 - t0)) * 1000;
    const Y = (p) => 8 + (1 - p) * 144;
    const pv = (p) => (view === "T" ? p : 1 - p);
    const pts = a.points.filter((q) => q.tick >= t0);
    let line = "";
    pts.forEach((q, i) => { line += (i ? "L" : "M") + X(q.tick).toFixed(1) + " " + Y(pv(q.p)).toFixed(1) + " "; });
    const area = line + `L${X(pts[pts.length - 1].tick).toFixed(1)} 152 L${X(pts[0].tick).toFixed(1)} 152 Z`;
    const ns = "http://www.w3.org/2000/svg";
    const mk = (tag, attrs) => { const n = document.createElementNS(ns, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };
    svg.replaceChildren(
      mk("rect", { x: 0, y: 0, width: 1000, height: 160, fill: "transparent" }),
      mk("line", { x1: 0, x2: 1000, y1: Y(0.5), y2: Y(0.5), stroke: "#2a2924", "stroke-dasharray": "4 6", "vector-effect": "non-scaling-stroke" }),
      mk("path", { d: area, fill: "rgba(215,255,61,0.08)" }),
      mk("path", { d: line, fill: "none", stroke: "#d7ff3d", "stroke-width": 2, "vector-effect": "non-scaling-stroke" }),
    );
    if (r.plantTick) svg.append(mk("line", { x1: X(r.plantTick), x2: X(r.plantTick), y1: 0, y2: 160, stroke: "#ff5a4f", "stroke-opacity": .35, "vector-effect": "non-scaling-stroke" }));
    for (const e of a.scored) {
      if (e.type !== "kill") continue;
      const mine = e.victim === S.me;
      const vTeam = r.teams[e.victim];
      svg.append(mk("circle", {
        cx: X(e.tick), cy: Y(pv(e.after)), r: mine ? 5 : 3.2,
        fill: mine ? "#ff5a4f" : vTeam === "T" ? "#f0a63a" : "#5aa7ff", stroke: "#151512", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke",
      }));
    }
    svg.append(mk("line", { id: "playhead", x1: 0, x2: 0, y1: 0, y2: 160, stroke: "#f3f0e7", "stroke-opacity": .7, "vector-effect": "non-scaling-stroke" }));
    svg.onclick = (ev) => {
      const b = svg.getBoundingClientRect();
      S.tick = t0 + ((ev.clientX - b.left) / b.width) * (t1 - t0);
      draw(); updateScrub();
    };
  }
  function updateChartHead() {
    const r = round(), a = S.analyses[S.ri];
    const [t0, t1] = chartRange();
    const ph = document.getElementById("playhead");
    const x = Math.max(0, Math.min(1000, ((S.tick - t0) / (t1 - t0)) * 1000));
    if (ph) { ph.setAttribute("x1", x); ph.setAttribute("x2", x); }
    const view = (S.me && r.teams[S.me]) || "CT";
    const q = Analysis.nearestFrame(a.points, Math.max(S.tick, r.freezeEndTick));
    if (q) $("wp-now").textContent = pct(view === "T" ? q.p : 1 - q.p);
  }

  // ════════════════════ Replay rendering ════════════════════
  const cv = $("map");
  const ctx = cv.getContext("2d");
  const W = 900, H = 900, PAD = 28;
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  cv.width = W * DPR; cv.height = H * DPR;

  const MAPS = {};
  async function loadMap(name) {
    if (name in MAPS) return MAPS[name];
    try { const r = await fetch(`maps/${name}.json`); MAPS[name] = r.ok ? await r.json() : null; } catch { MAPS[name] = null; }
    return MAPS[name];
  }

  function computeBounds() {
    let minX, maxX, minY, maxY;
    if (S.map) [minX, minY, maxX, maxY] = S.map.bounds;
    else {
      minX = minY = Infinity; maxX = maxY = -Infinity;
      for (const r of S.match.rounds) for (const f of r.frames) for (const p of f.p) {
        if (!p.alive) continue;
        if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      }
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    S.bounds = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, scale: (W - PAD * 2) / span };
    S.placePos = calloutPositions();
    buildBackground();
  }
  const toX = (x) => W / 2 + (x - S.bounds.cx) * S.bounds.scale;
  const toY = (y) => H / 2 - (y - S.bounds.cy) * S.bounds.scale;
  const levelOf = (z) => (S.map && S.map.split != null && z < S.map.split ? 1 : 0);

  // Where each callout is: the middle of every position players stood while the game showed that name
  function calloutPositions() {
    const places = S.match.places || [];
    if (!places.length) return [];
    const acc = places.map(() => ({ xs: [], ys: [], zs: [] }));
    for (const r of S.match.rounds) for (let i = 0; i < r.frames.length; i += 4) for (const p of r.frames[i].p) {
      if (!p.alive || p.pl == null || p.pl < 0) continue;
      const a = acc[p.pl]; if (a.xs.length < 400) { a.xs.push(p.x); a.ys.push(p.y); a.zs.push(p.z); }
    }
    const med = (v) => { const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
    return places.map((name, i) => acc[i].xs.length >= 6 ? { name, x: med(acc[i].xs), y: med(acc[i].ys), z: med(acc[i].zs) } : null).filter(Boolean);
  }

  function buildBackground() {
    const bg = document.createElement("canvas"); bg.width = W * DPR; bg.height = H * DPR;
    const b = bg.getContext("2d");
    b.setTransform(DPR, 0, 0, DPR, 0, 0);
    b.fillStyle = "#0a0a09"; b.fillRect(0, 0, W, H);
    if (S.map) drawVectorMap(b); else drawDensityMap(b);
    // bomb sites
    const sites = S.map ? Object.entries(S.map.sites).filter(([, v]) => v).map(([k, v]) => ({ k, x: v[0], y: v[1] }))
      : clusterPlants().map((s, i) => ({ k: "", x: s.x, y: s.y }));
    for (const s of sites) {
      const x = toX(s.x), y = toY(s.y);
      b.fillStyle = "rgba(255,90,79,0.07)"; b.strokeStyle = "rgba(255,90,79,0.4)"; b.setLineDash([4, 5]); b.lineWidth = 1.2;
      b.beginPath(); b.arc(x, y, 34, 0, Math.PI * 2); b.fill(); b.stroke(); b.setLineDash([]);
      if (s.k) { b.fillStyle = "rgba(255,90,79,0.75)"; b.font = "800 26px JetBrains Mono, monospace"; b.textAlign = "center"; b.textBaseline = "middle"; b.fillText(s.k, x, y); }
    }
    // callout names
    if (S.callouts) {
      b.font = "600 9.5px JetBrains Mono, monospace"; b.textAlign = "center"; b.textBaseline = "middle";
      for (const p of S.placePos) {
        if (S.map && levelOf(p.z) !== S.level) continue;
        const x = toX(p.x), y = toY(p.y), t = p.name.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
        b.fillStyle = "rgba(10,10,9,.55)"; const w = b.measureText(t).width + 6; b.fillRect(x - w / 2, y - 6, w, 12);
        b.fillStyle = "rgba(243,240,231,.42)"; b.fillText(t, x, y);
      }
    }
    S.bg = bg;
  }

  function pathShapes(g, shapes) {
    g.beginPath();
    for (const s of shapes) for (const ring of s) {
      ring.forEach(([x, y], i) => (i ? g.lineTo(toX(x), toY(y)) : g.moveTo(toX(x), toY(y))));
      g.closePath();
    }
  }
  function drawVectorMap(b) {
    const levels = S.map.levels;
    // the other level, faint, for context
    levels.forEach((L, i) => {
      if (i === S.level) return;
      pathShapes(b, L.outline); b.fillStyle = "rgba(255,255,255,.025)"; b.fill("evenodd");
      b.strokeStyle = "rgba(200,205,170,.12)"; b.lineWidth = 1; b.stroke();
    });
    const L = levels[S.level];
    pathShapes(b, L.outline); b.fillStyle = "#1b1c18"; b.fill("evenodd");
    for (const band of L.bands) {           // higher ground = lighter floor
      const k = band.k;
      pathShapes(b, band.shapes);
      b.fillStyle = `rgb(${Math.round(27 + 26 * k)},${Math.round(28 + 27 * k)},${Math.round(24 + 19 * k)})`;
      b.fill("evenodd");
    }
    pathShapes(b, L.outline);
    b.lineJoin = "miter"; b.strokeStyle = "rgba(205,210,175,.7)"; b.lineWidth = 1.4; b.stroke();
  }
  // fallback for maps we don't have geometry for: floor from where players walked
  function drawDensityMap(b) {
    const dens = document.createElement("canvas"); dens.width = W; dens.height = H;
    const d = dens.getContext("2d");
    d.fillStyle = "rgba(255,255,255,0.18)";
    for (const r of S.match.rounds) for (const f of r.frames) for (const p of f.p) {
      if (!p.alive) continue;
      d.beginPath(); d.arc(toX(p.x), toY(p.y), 4.5, 0, Math.PI * 2); d.fill();
    }
    const A = d.getImageData(0, 0, W, H).data;
    const out = new ImageData(W, H), O = out.data;
    for (let i = 0; i < W * H; i++) {
      const on = A[i * 4 + 3] > 20;
      O[i * 4] = on ? 33 : 10; O[i * 4 + 1] = on ? 34 : 10; O[i * 4 + 2] = on ? 29 : 9; O[i * 4 + 3] = 255;
    }
    d.putImageData(out, 0, 0);
    b.drawImage(dens, 0, 0, W, H);
  }
  function clusterPlants() {
    const pts = S.match.rounds.filter((r) => r.plantPos).map((r) => ({ x: r.plantPos[0], y: r.plantPos[1] }));
    const cl = [];
    for (const p of pts) {
      const c = cl.find((c) => Math.hypot(c.x - p.x, c.y - p.y) < 900);
      if (c) { c.x = (c.x * c.n + p.x) / (c.n + 1); c.y = (c.y * c.n + p.y) / (c.n + 1); c.n++; } else cl.push({ ...p, n: 1 });
    }
    return cl;
  }

  $("level").onclick = () => { S.level = S.level ? 0 : 1; $("level").textContent = S.level ? "Lower" : "Upper"; buildBackground(); draw(); };
  $("callouts").setAttribute("aria-pressed", String(S.callouts));
  $("callouts").onclick = () => { S.callouts = !S.callouts; store.set("cs2r.callouts", S.callouts); $("callouts").setAttribute("aria-pressed", String(S.callouts)); buildBackground(); draw(); };

  function interp(r, tick) {
    const fr = r.frames;
    if (!fr.length) return [];
    let lo = 0, hi = fr.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (fr[mid].tick <= tick) lo = mid; else hi = mid - 1; }
    const a = fr[lo], b = fr[Math.min(lo + 1, fr.length - 1)];
    const t = b.tick > a.tick ? Math.max(0, Math.min(1, (tick - a.tick) / (b.tick - a.tick))) : 0;
    const bm = {}; for (const p of b.p) bm[p.sid] = p;
    return a.p.map((p) => {
      const q = bm[p.sid] || p;
      let dy = q.yaw - p.yaw; if (dy > 180) dy -= 360; if (dy < -180) dy += 360;
      return { ...p, x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t, yaw: p.yaw + dy * t };
    });
  }

  // grenade effects on the map: smoke ~18s, molotov ~7s, flash/HE a short burst
  const NADE_FX = { smoke: { dur: 18, r: 144 }, molotov: { dur: 7, r: 110 }, he: { dur: 0.5, r: 160 }, flash: { dur: 0.4, r: 120 } };
  function drawNades(r, tr) {
    for (const n of r.nades || []) {
      const fx = NADE_FX[n.type]; if (!fx) continue;
      const age = (S.tick - n.tick) / tr;
      if (age < 0 || age > fx.dur) continue;
      const x = toX(n.x), y = toY(n.y), rad = fx.r * S.bounds.scale;
      const fade = n.type === "smoke" ? Math.min(1, (fx.dur - age) / 1.5) : 1 - age / fx.dur;
      ctx.beginPath(); ctx.arc(x, y, n.type === "he" || n.type === "flash" ? rad * (0.4 + age / fx.dur) : rad, 0, Math.PI * 2);
      if (n.type === "smoke") { ctx.fillStyle = `rgba(190,195,200,${0.38 * fade})`; ctx.fill(); ctx.strokeStyle = `rgba(220,225,230,${0.5 * fade})`; ctx.lineWidth = 1; ctx.stroke(); }
      else if (n.type === "molotov") { ctx.fillStyle = `rgba(255,110,40,${0.3 * fade})`; ctx.fill(); ctx.strokeStyle = `rgba(255,140,60,${0.6 * fade})`; ctx.lineWidth = 1; ctx.stroke(); }
      else { ctx.strokeStyle = n.type === "flash" ? `rgba(255,255,255,${0.8 * fade})` : `rgba(255,90,79,${0.8 * fade})`; ctx.lineWidth = 2; ctx.stroke(); }
    }
  }

  function draw() {
    if (!S.match) return;
    const r = round(), tr = S.match.tickrate;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(S.bg, 0, 0);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    const dead = new Map();
    for (const e of r.events) if (e.type === "kill" && e.tick <= S.tick) dead.set(e.victim, e);

    drawNades(r, tr);
    // bomb
    if (r.plantTick && S.tick >= r.plantTick && r.plantPos) {
      const on = Math.floor(S.tick / (tr / 2)) % 2 === 0;
      const x = toX(r.plantPos[0]), y = toY(r.plantPos[1]);
      ctx.fillStyle = on ? "#ff5a4f" : "#7a2a25";
      ctx.beginPath(); ctx.moveTo(x, y - 10); ctx.lineTo(x + 10, y); ctx.lineTo(x, y + 10); ctx.lineTo(x - 10, y); ctx.closePath(); ctx.fill();
    }
    // death markers
    for (const [sid, e] of dead) {
      const x = toX(e.vx), y = toY(e.vy);
      ctx.strokeStyle = r.teams[sid] === "T" ? "rgba(240,166,58,.55)" : "rgba(90,167,255,.55)";
      if (sid === S.me) ctx.strokeStyle = "#ff5a4f";
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y + 6); ctx.moveTo(x + 6, y - 6); ctx.lineTo(x - 6, y + 6); ctx.stroke();
    }
    // recent kill lines
    for (const e of r.events) {
      if (e.type !== "kill" || !e.attacker || e.tick > S.tick || S.tick - e.tick > tr * 1.5 || e.ax == null) continue;
      const fade = 1 - (S.tick - e.tick) / (tr * 1.5);
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * fade})`; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(toX(e.ax), toY(e.ay)); ctx.lineTo(toX(e.vx), toY(e.vy)); ctx.stroke();
    }
    // players
    const ps = interp(r, S.tick);
    let tAlive = 0, ctAlive = 0;
    ctx.font = "600 11px JetBrains Mono, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    for (const p of ps) {
      if (dead.has(p.sid) || !r.teams[p.sid]) continue;
      if (S.tick >= r.freezeEndTick && !p.alive && S.tick > r.freezeEndTick + tr) continue;
      if (p.team === "T") tAlive++; else ctAlive++;
      ctx.globalAlpha = S.map && levelOf(p.z) !== S.level ? 0.3 : 1;
      const x = toX(p.x), y = toY(p.y);
      const col = p.team === "T" ? "#f0a63a" : "#5aa7ff";
      const a = (-p.yaw * Math.PI) / 180;
      ctx.strokeStyle = col; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 18, y + Math.sin(a) * 18); ctx.stroke();
      if (p.sid === S.me) { ctx.fillStyle = "#d7ff3d"; ctx.beginPath(); ctx.arc(x, y, 11.5, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = "#0a0a09"; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = "#0a0a09"; ctx.fillRect(x - 12, y + 12, 24, 3.5);
      ctx.fillStyle = p.hp > 50 ? "#7be07b" : p.hp > 20 ? "#f0d13a" : "#ff5a4f"; ctx.fillRect(x - 12, y + 12, 24 * Math.max(0, p.hp) / 100, 3.5);
      ctx.fillStyle = p.sid === S.me ? "#d7ff3d" : "rgba(243,240,231,.85)";
      ctx.fillText(nameOf(p.sid).slice(0, 12), x, y - 12);
      ctx.globalAlpha = 1;
    }
    // header
    $("round-label").textContent = `Round ${S.ri + 1}${r.winner ? " · " + r.winner + " won" : ""}`;
    $("alive-label").innerHTML = `<b class="ct">${ctAlive}</b> CT  vs  T <b class="t">${tAlive}</b>`;
    const clock = $("clock");
    if (r.plantTick && S.tick >= r.plantTick) {
      clock.textContent = "BOMB " + clockText(Math.max(0, 40 - (S.tick - r.plantTick) / tr), true); clock.className = "bomb";
    } else {
      clock.textContent = S.tick < r.freezeEndTick ? "FREEZE" : clockText(Math.max(0, 115 - (S.tick - r.freezeEndTick) / tr), true); clock.className = "";
    }
    document.querySelectorAll("#feed li[data-tick]").forEach((li) => li.classList.toggle("past", +li.dataset.tick > S.tick));
    updateChartHead();
  }

  // ── Playback
  const scrub = $("scrub");
  const scrubRange = () => { const r = round(); return [r.freezeEndTick - S.match.tickrate, r.endTick + S.match.tickrate * 3]; };
  function updateScrub() { const [a, b] = scrubRange(); scrub.value = String(Math.round(((S.tick - a) / (b - a)) * 1000)); }
  scrub.oninput = () => { const [a, b] = scrubRange(); S.tick = a + (scrub.value / 1000) * (b - a); draw(); updateChartHead(); };
  $("speed").onchange = (e) => (S.speed = +e.target.value);
  $("play").onclick = () => play(!S.playing);
  function play(on) {
    S.playing = on;
    $("play").textContent = on ? "❚❚" : "▶";
    if (on) { const [, b] = scrubRange(); if (S.tick >= b) S.tick = scrubRange()[0]; S.lastTs = performance.now(); requestAnimationFrame(loop); }
  }
  function loop(ts) {
    if (!S.playing) return;
    const dt = (ts - S.lastTs) / 1000; S.lastTs = ts;
    S.tick += dt * S.match.tickrate * S.speed;
    const [, b] = scrubRange();
    if (S.tick >= b) { S.tick = b; play(false); }
    draw(); updateScrub();
    requestAnimationFrame(loop);
  }
  document.addEventListener("keydown", (e) => {
    if (!S.match || $("match").hidden || e.target.tagName === "SELECT" || e.target.tagName === "INPUT" && e.target.type !== "range") return;
    if (e.code === "Space") { e.preventDefault(); play(!S.playing); }
    if (e.code === "ArrowRight" && e.shiftKey) { if (S.ri < S.match.rounds.length - 1) selectRound(S.ri + 1); }
    else if (e.code === "ArrowLeft" && e.shiftKey) { if (S.ri > 0) selectRound(S.ri - 1); }
    else if (e.code === "ArrowRight") { S.tick += S.match.tickrate * 5; draw(); updateScrub(); }
    else if (e.code === "ArrowLeft") { S.tick -= S.match.tickrate * 5; draw(); updateScrub(); }
  });

  $("back-home").onclick = () => { play(false); $("match").hidden = true; $("home").hidden = false; $("progress").hidden = true; $("topbar-match").textContent = ""; renderLibrary(); window.scrollTo(0, 0); };

  // ── helpers
  function clockText(sec, countdown) { sec = Math.max(0, countdown ? Math.ceil(sec) : Math.floor(sec)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); }
  function prettyWeapon(w) { return (w || "").replace(/^weapon_/, "").replace(/_/g, " ").replace(/^knife.*/, "knife"); }
  function reasonText(r) { return ({ 1: "bomb exploded", 7: "bomb defused", 8: "Ts eliminated", 9: "CTs eliminated", 12: "time ran out", 17: "surrender" })[r] || "round over"; }

  DB.open().then(renderLibrary);
})();
