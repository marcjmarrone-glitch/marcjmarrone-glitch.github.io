// CS2 Round Review — UI. Parsing happens in worker.js; scoring in analysis.js.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
  const pct = (x) => Math.round(x * 100) + "%";
  const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(Math.round(x * 100)) + "%";
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };

  const S = {
    tag: store.get("cs2r.tag", "pug"),
    match: null, analyses: [], me: null, mistakes: [],
    ri: 0, tick: 0, playing: false, speed: 2, lastTs: 0,
    bounds: null, bg: null,
  };

  // ════════════════════ Home: upload ════════════════════
  const segBtns = document.querySelectorAll(".upload-card .seg button");
  function setTag(t) { S.tag = t; store.set("cs2r.tag", t); segBtns.forEach((b) => b.setAttribute("aria-checked", String(b.dataset.tag === t))); }
  segBtns.forEach((b) => (b.onclick = () => setTag(b.dataset.tag)));
  setTag(S.tag);

  const drop = $("drop");
  $("file").onchange = (e) => e.target.files[0] && load(e.target.files[0]);
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) load(f); });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => e.preventDefault());

  const STEPS = [
    ["read", "Reading file"], ["decompress", "Decompressing"], ["events", "Reading kills, plants, rounds"],
    ["positions", "Reading player positions"], ["build", "Building rounds"],
  ];

  function load(file) {
    $("error").hidden = true;
    const prog = $("progress");
    prog.hidden = false;
    prog.replaceChildren(...STEPS.map(([k, label]) => { const li = el("li"); li.dataset.k = k; li.append(el("span", "lbl", label), el("span", "x", "")); return li; }));
    drop.style.pointerEvents = "none"; drop.style.opacity = ".5";
    const w = new Worker("worker.js");
    w.onmessage = (e) => {
      const m = e.data;
      if (m.type === "progress") {
        const li = prog.querySelector(`[data-k="${m.name}"]`);
        if (li) { li.className = m.state; if (m.extra) li.querySelector(".x").textContent = m.extra; }
      } else if (m.type === "done") {
        w.terminate(); resetDrop();
        m.match.tag = S.tag;
        m.match.fileName = file.name;
        openMatch(m.match);
      } else if (m.type === "error") {
        w.terminate(); resetDrop(); showError(m.message);
      }
    };
    w.onerror = (e) => { w.terminate(); resetDrop(); showError("The parser crashed: " + (e.message || "unknown error") + ". Very large demos can run out of browser memory; try Chrome or Edge."); };
    w.postMessage({ file });
  }
  function resetDrop() { drop.style.pointerEvents = ""; drop.style.opacity = ""; $("file").value = ""; }
  function showError(msg) { const e = $("error"); e.textContent = msg; e.hidden = false; }

  // ════════════════════ Library (IndexedDB, this browser only) ════════════════════
  const DB = {
    db: null,
    open() {
      return new Promise((res) => {
        try {
          const r = indexedDB.open("cs2-review", 1);
          r.onupgradeneeded = () => r.result.createObjectStore("matches", { keyPath: "id" });
          r.onsuccess = () => { this.db = r.result; res(); };
          r.onerror = () => res();
        } catch { res(); }
      });
    },
    tx(mode) { return this.db && this.db.transaction("matches", mode).objectStore("matches"); },
    all() { return new Promise((res) => { const s = this.tx("readonly"); if (!s) return res([]); const q = s.getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => res([]); }); },
    put(v) { const s = this.tx("readwrite"); if (s) s.put(v); },
    del(id) { const s = this.tx("readwrite"); if (s) s.delete(id); },
  };
  let libFilter = "all";
  document.querySelectorAll("#lib-filter button").forEach((b) => (b.onclick = () => {
    libFilter = b.dataset.f;
    document.querySelectorAll("#lib-filter button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    renderLibrary();
  }));

  async function renderLibrary() {
    const all = (await DB.all()).sort((a, b) => b.savedAt - a.savedAt);
    $("library-wrap").hidden = all.length === 0;
    const list = all.filter((m) => libFilter === "all" || m.tag === libFilter);
    const withMe = list.filter((m) => m.me);
    const sum = (f) => withMe.reduce((a, m) => a + f(m), 0);
    const rounds = sum((m) => m.me.rounds) || 1;
    const deaths = sum((m) => m.me.deaths) || 1;
    const opens = sum((m) => m.me.openK + m.me.openD) || 1;
    const stats = [
      ["Matches", list.length],
      ["Win prob. added / round", withMe.length ? signed(sum((m) => m.me.wpa) / rounds) : "—"],
      ["K / D", withMe.length ? (sum((m) => m.me.kills) / deaths).toFixed(2) : "—"],
      ["Opening duels won", withMe.length ? pct(sum((m) => m.me.openK) / opens) : "—"],
      ["Deaths not traded", withMe.length ? pct(sum((m) => m.me.untraded) / deaths) : "—"],
    ];
    $("lib-stats").replaceChildren(...stats.map(([k, v]) => { const d = el("div", "stat"); d.append(el("div", "k", k), el("div", "v", String(v))); return d; }));
    $("library").replaceChildren(...list.map((m) => {
      const li = el("li");
      li.append(el("span", "tag", m.tag === "official" ? "OFFICIAL" : "PUG"));
      const mid = el("span");
      mid.append(el("b", "", m.map.replace(/^de_/, "")), document.createTextNode("  " + new Date(m.savedAt).toLocaleDateString() + (m.me ? " · " + m.me.name : "")));
      li.append(mid);
      const res = el("span", "mono " + (m.result === "W" ? "res-w" : m.result === "L" ? "res-l" : ""), m.scoreText);
      li.append(res);
      const del = el("button", "del", "×"); del.title = "Remove from history";
      del.onclick = () => { DB.del(m.id); renderLibrary(); };
      li.append(del);
      return li;
    }));
  }

  function saveToLibrary() {
    const m = S.match;
    if (!m) return;
    const rec = { id: m.id, map: m.map, tag: m.tag, savedAt: Date.now(), rounds: m.rounds.length, scoreText: m.clans.map((c) => m.score[c]).join(" : ") };
    if (S.me) {
      const st = Analysis.swingStats(m, S.analyses)[S.me] || {};
      const myClan = (m.players.find((p) => p.sid === S.me) || {}).clan;
      const other = m.clans.find((c) => c !== myClan);
      rec.scoreText = `${m.score[myClan] ?? "?"} : ${m.score[other] ?? "?"}`;
      rec.result = m.score[myClan] > m.score[other] ? "W" : m.score[myClan] < m.score[other] ? "L" : "D";
      rec.me = {
        sid: S.me, name: nameOf(S.me), rounds: st.rounds || 0, wpa: st.wpa || 0, kills: st.kills || 0, deaths: st.deaths || 0,
        openK: st.openK || 0, openD: st.openD || 0,
        untraded: S.mistakes.filter((x) => x.tags.includes("not traded")).length,
        worst: S.mistakes.slice(0, 5).map((x) => ({ round: x.round + 1, swing: x.swing, tags: x.tags })),
      };
    }
    DB.put(rec);
  }

  // ════════════════════ Match view ════════════════════
  const nameOf = (sid) => (S.match.players.find((p) => p.sid === sid) || {}).name || "?";
  const round = () => S.match.rounds[S.ri];

  function openMatch(match) {
    S.match = match;
    S.analyses = match.rounds.map((r) => Analysis.analyzeRound(r, match.tickrate));
    computeBounds();
    $("home").hidden = true; $("match").hidden = false;
    $("topbar-match").textContent = `${match.map} · ${match.rounds.length} rounds · ${match.tag === "official" ? "Official / LAN" : "PUG"} · parsed in ${match.parseSeconds}s`;

    const sel = $("me");
    sel.replaceChildren(el("option", "", "Pick yourself…"));
    sel.firstChild.value = "";
    for (const c of match.clans) {
      const g = el("optgroup"); g.label = c.replace(/^team_/, "Team ");
      match.players.filter((p) => p.clan === c).forEach((p) => { const o = el("option", "", p.name); o.value = p.sid; g.append(o); });
      sel.append(g);
    }
    const known = store.get("cs2r.me", []);
    const auto = match.players.find((p) => known.includes(p.sid));
    S.me = auto ? auto.sid : null;
    sel.value = S.me || "";
    sel.onchange = () => {
      S.me = sel.value || null;
      if (S.me) { const k = store.get("cs2r.me", []); if (!k.includes(S.me)) { k.push(S.me); store.set("cs2r.me", k); } }
      refreshMe();
    };
    refreshMe();
    selectRound(0);
    window.scrollTo(0, 0);
  }

  function refreshMe() {
    const m = S.match;
    S.mistakes = S.me ? Analysis.findMistakes(m, S.analyses, S.me) : [];
    const myClan = S.me && (m.players.find((p) => p.sid === S.me) || {}).clan;
    const [a, b] = myClan ? [myClan, m.clans.find((c) => c !== myClan)] : m.clans;
    $("team-a").textContent = (a || "Team A").replace(/^team_/, "");
    $("team-b").textContent = (b || "Team B").replace(/^team_/, "");
    $("team-a").className = "team" + (myClan ? " mine" : "");
    $("team-b").className = "team";
    $("score").textContent = `${m.score[a] ?? 0} : ${m.score[b] ?? 0}`;
    $("match-meta").textContent = m.map.replace(/^de_/, "").toUpperCase();
    renderRounds(); renderMistakes(); renderBoard(); renderFeed(); renderChart(); draw();
    saveToLibrary();
  }

  function renderRounds() {
    const wrap = $("rounds");
    wrap.replaceChildren();
    const flagged = new Set(S.mistakes.filter((x) => x.swing <= -0.2).map((x) => x.round));
    S.match.rounds.forEach((r, i) => {
      if (i === 12) wrap.append(el("span", "half"));
      const myTeam = S.me && r.teams[S.me];
      const b = el("button", "rchip");
      if (myTeam && r.winner) b.classList.add(r.winner === myTeam ? "win" : "loss");
      if (i === S.ri) b.classList.add("cur");
      b.append(el("span", "rn", String(i + 1)), el("small", "", myTeam || r.winner || ""));
      b.title = `Round ${i + 1}: ${r.winner ? r.winner + " won (" + reasonText(r.reason) + ")" : "no result"}`;
      if (flagged.has(i)) { const f = el("span", "flag"); b.append(f); b.title = "You had a costly death this round"; }
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

  // ── Mistakes panel
  function renderMistakes() {
    const ol = $("mistakes");
    if (!S.me) { ol.replaceChildren(el("p", "empty-note", "Pick yourself in “You are” above to see the deaths that cost your team the most.")); return; }
    const top = S.mistakes.filter((x) => x.swing < -0.04).slice(0, 10);
    if (!top.length) { ol.replaceChildren(el("p", "empty-note", "No costly deaths found. Clean game.")); return; }
    ol.replaceChildren(...top.map((x) => {
      const li = el("li");
      const r = S.match.rounds[x.round];
      const tl = (x.tick - r.freezeEndTick) / S.match.tickrate;
      const head = el("div", "m-top");
      head.append(el("span", "", `R${x.round + 1} · ${clockText(tl)} · ${x.team}${x.lostRound ? " · round lost" : ""}`), el("span", "m-swing", signed(x.swing)));
      const desc = el("div", "m-desc", `Died in a ${x.situation} to ${nameOf(x.attacker)} (${prettyWeapon(x.weapon)}). Win chance ${pct(x.winBefore)} → ${pct(Math.max(0, x.winBefore + x.swing))}.`);
      const chips = el("div", "chips");
      x.tags.forEach((t) => chips.append(el("span", "chip", t)));
      li.append(head, desc, chips);
      li.onclick = () => { selectRound(x.round, x.tick - S.match.tickrate * 5); play(true); };
      return li;
    }));
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
      const nm = (sid) => { const s = el("span", (r.teams[sid] || "").toLowerCase() + (sid === S.me ? " me-name" : ""), nameOf(sid)); return s; };
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
    const r2 = round();
    if (r2.winner) {
      const li = el("li");
      li.append(el("span", "ft", ""), el("span", r2.winner.toLowerCase(), `${r2.winner} win · ${reasonText(r2.reason)}`), el("span", ""));
      ul.append(li);
    }
  }

  // ── Scoreboard
  function renderBoard() {
    const st = Analysis.swingStats(S.match, S.analyses);
    const t = $("board");
    t.replaceChildren();
    const head = el("tr");
    ["Player", "K", "D", "Opening K–D", "Win prob. added", "Per round"].forEach((h) => head.append(el("th", "", h)));
    t.append(head);
    for (const c of S.match.clans) {
      const tr = el("tr", "teamrow"); const td = el("td", "", c.replace(/^team_/, "Team ") + " · " + (S.match.score[c] ?? 0)); td.colSpan = 6; tr.append(td); t.append(tr);
      S.match.players.filter((p) => p.clan === c)
        .sort((a, b) => ((st[b.sid] || {}).wpa || 0) - ((st[a.sid] || {}).wpa || 0))
        .forEach((p) => {
          const s = st[p.sid] || { kills: 0, deaths: 0, openK: 0, openD: 0, wpa: 0, rounds: 1 };
          const row = el("tr", p.sid === S.me ? "me" : "");
          [p.name, s.kills, s.deaths, `${s.openK}–${s.openD}`, signed(s.wpa), signed(s.wpa / Math.max(1, s.rounds))]
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

  // ── Replay rendering
  const cv = $("map");
  const ctx = cv.getContext("2d");
  const W = cv.width, H = cv.height, PAD = 36;

  function computeBounds() {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const r of S.match.rounds) for (const f of r.frames) for (const p of f.p) {
      if (!p.alive) continue;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    const span = Math.max(maxX - minX, maxY - minY) || 1;
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    S.bounds = { cx, cy, scale: (W - PAD * 2) / span };
    buildBackground();
  }
  const toX = (x) => W / 2 + (x - S.bounds.cx) * S.bounds.scale;
  const toY = (y) => H / 2 - (y - S.bounds.cy) * S.bounds.scale;

  // The map is drawn from where players actually walked: every position sample becomes floor.
  function buildBackground() {
    // 1) density of every alive-player sample
    const dens = document.createElement("canvas"); dens.width = W; dens.height = H;
    const d = dens.getContext("2d");
    d.fillStyle = "rgba(255,255,255,0.18)";
    for (const r of S.match.rounds) for (const f of r.frames) for (const p of f.p) {
      if (!p.alive) continue;
      d.beginPath(); d.arc(toX(p.x), toY(p.y), 4.5, 0, Math.PI * 2); d.fill();
    }
    const A = d.getImageData(0, 0, W, H).data;
    const floor = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) floor[i] = A[i * 4 + 3] > 20 ? 1 : 0;
    // 2) floor + crisp outline (a floor pixel next to empty space is wall)
    const out = new ImageData(W, H);
    const O = out.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, o = i * 4;
      if (floor[i]) {
        const edge = x < 2 || y < 2 || x >= W - 2 || y >= H - 2 ||
          !floor[i - 2] || !floor[i + 2] || !floor[i - 2 * W] || !floor[i + 2 * W];
        const heat = Math.min(1, A[i * 4 + 3] / 255);
        if (edge) { O[o] = 92; O[o + 1] = 96; O[o + 2] = 78; }
        else { O[o] = 33 + heat * 10; O[o + 1] = 34 + heat * 11; O[o + 2] = 29 + heat * 6; }
        O[o + 3] = 255;
      } else { O[o] = 10; O[o + 1] = 10; O[o + 2] = 9; O[o + 3] = 255; }
    }
    const bg = document.createElement("canvas"); bg.width = W; bg.height = H;
    const b = bg.getContext("2d");
    b.putImageData(out, 0, 0);
    // 3) bomb sites, located from where the bomb was planted
    for (const s of clusterPlants()) {
      b.fillStyle = "rgba(255,90,79,0.10)"; b.strokeStyle = "rgba(255,90,79,0.35)"; b.setLineDash([5, 6]);
      b.beginPath(); b.arc(toX(s.x), toY(s.y), 44, 0, Math.PI * 2); b.fill(); b.stroke(); b.setLineDash([]);
    }
    S.bg = bg;
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

  function draw() {
    if (!S.match) return;
    const r = round(), tr = S.match.tickrate;
    ctx.drawImage(S.bg, 0, 0);
    const dead = new Map();
    for (const e of r.events) if (e.type === "kill" && e.tick <= S.tick) dead.set(e.victim, e);

    // bomb
    if (r.plantTick && S.tick >= r.plantTick && r.plantPos) {
      const on = Math.floor(S.tick / (tr / 2)) % 2 === 0;
      const x = toX(r.plantPos[0]), y = toY(r.plantPos[1]);
      ctx.fillStyle = on ? "#ff5a4f" : "#7a2a25";
      ctx.beginPath(); ctx.moveTo(x, y - 11); ctx.lineTo(x + 11, y); ctx.lineTo(x, y + 11); ctx.lineTo(x - 11, y); ctx.closePath(); ctx.fill();
    }
    // death markers
    for (const [sid, e] of dead) {
      const x = toX(e.vx), y = toY(e.vy);
      ctx.strokeStyle = r.teams[sid] === "T" ? "rgba(240,166,58,.55)" : "rgba(90,167,255,.55)";
      if (sid === S.me) ctx.strokeStyle = "#ff5a4f";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(x - 7, y - 7); ctx.lineTo(x + 7, y + 7); ctx.moveTo(x + 7, y - 7); ctx.lineTo(x - 7, y + 7); ctx.stroke();
    }
    // recent kill lines
    for (const e of r.events) {
      if (e.type !== "kill" || !e.attacker || e.tick > S.tick || S.tick - e.tick > tr * 1.5 || e.ax == null) continue;
      const fade = 1 - (S.tick - e.tick) / (tr * 1.5);
      ctx.strokeStyle = `rgba(255,255,255,${0.7 * fade})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(toX(e.ax), toY(e.ay)); ctx.lineTo(toX(e.vx), toY(e.vy)); ctx.stroke();
    }
    // players
    const ps = interp(r, S.tick);
    let tAlive = 0, ctAlive = 0;
    ctx.font = "600 13px JetBrains Mono, monospace"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    for (const p of ps) {
      if (dead.has(p.sid) || !r.teams[p.sid]) continue;
      if (S.tick >= r.freezeEndTick && !p.alive && S.tick > r.freezeEndTick + tr) continue;
      if (p.team === "T") tAlive++; else ctAlive++;
      const x = toX(p.x), y = toY(p.y);
      const col = p.team === "T" ? "#f0a63a" : "#5aa7ff";
      const a = (-p.yaw * Math.PI) / 180;
      ctx.strokeStyle = col; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * 22, y + Math.sin(a) * 22); ctx.stroke();
      if (p.sid === S.me) { ctx.fillStyle = "#d7ff3d"; ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0a0a09"; ctx.fillRect(x - 14, y + 14, 28, 4);
      ctx.fillStyle = p.hp > 50 ? "#7be07b" : p.hp > 20 ? "#f0d13a" : "#ff5a4f"; ctx.fillRect(x - 14, y + 14, 28 * Math.max(0, p.hp) / 100, 4);
      ctx.fillStyle = p.sid === S.me ? "#d7ff3d" : "rgba(243,240,231,.85)";
      ctx.fillText(nameOf(p.sid).slice(0, 12), x, y - 14);
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
    // feed highlight
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
