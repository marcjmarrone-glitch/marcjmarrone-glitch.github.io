// Runs off the main thread: decompress → parse with demoparser2 (WASM) → compact match object.
importScripts("https://cdn.jsdelivr.net/npm/fzstd@0.1.1/umd/index.js", "vendor/demoparser2.js");

const TICKRATE = 64;
const FRAME_STEP = 8;                 // 8 samples per second for the replay
const step = (name, state, extra) => postMessage({ type: "progress", name, state, extra });

// demoparser2 returns JS Maps; turn them into plain objects/arrays
const norm = (x) => x instanceof Map
  ? Object.fromEntries([...x].map(([k, v]) => [k, norm(v)]))
  : Array.isArray(x) ? x.map(norm) : x;

async function decompress(bytes) {
  const b = bytes;
  if (b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd) return fzstd.decompress(b);
  if (b[0] === 0x1f && b[1] === 0x8b) {
    const ds = new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(ds).arrayBuffer());
  }
  if (b[0] === 0x42 && b[1] === 0x5a && b[2] === 0x68) throw new Error("This is a .bz2 file. Please extract it first (7-Zip works) and drop the .dem inside.");
  return b;
}

const NADES = { smokegrenade_detonate: "smoke", flashbang_detonate: "flash", hegrenade_detonate: "he", inferno_startburn: "molotov" };
const side = (n) => (n === 2 ? "T" : n === 3 ? "CT" : null);

onmessage = async (e) => {
  try {
    const t0 = performance.now();
    step("read", "active");
    let bytes = new Uint8Array(await e.data.file.arrayBuffer());
    step("read", "done", (bytes.length / 1e6).toFixed(0) + " MB");

    step("decompress", "active");
    bytes = await decompress(bytes);
    const magic = String.fromCharCode(...bytes.slice(0, 7));
    if (magic !== "PBDEMS2") throw new Error("That doesn't look like a CS2 demo (.dem). CS:GO demos aren't supported.");
    step("decompress", "done", (bytes.length / 1e6).toFixed(0) + " MB");

    step("events", "active");
    await wasm_bindgen("vendor/demoparser2_bg.wasm");
    const P = wasm_bindgen;
    const header = norm(P.parseHeader(bytes));
    const evs = norm(P.parseEvents(bytes,
      ["round_freeze_end", "round_officially_ended", "player_death", "bomb_planted", "bomb_defused",
        "bomb_exploded", "begin_new_match", "cs_win_panel_match", "round_prestart", "player_hurt", "player_blind",
        "smokegrenade_detonate", "flashbang_detonate", "hegrenade_detonate", "inferno_startburn"],
      ["X", "Y", "team_num"],
      ["is_warmup_period", "total_rounds_played", "round_win_status", "round_win_reason"]));
    evs.sort((a, b) => a.tick - b.tick);
    step("events", "done", evs.length + " events");

    // ── Rounds: live play starts at the last begin_new_match
    const start = Math.max(0, ...evs.filter((x) => x.event_name === "begin_new_match").map((x) => x.tick));
    const live = evs.filter((x) => x.tick >= start && !x.is_warmup_period);
    const freezeEnds = live.filter((x) => x.event_name === "round_freeze_end").map((x) => x.tick);
    // winner of round N comes from the first round_officially_ended with total_rounds_played = N (status 2=T, 3=CT)
    const results = {};
    for (const x of live) {
      if (x.event_name === "round_officially_ended" && x.round_win_status && !results[x.total_rounds_played]) {
        results[x.total_rounds_played] = { tick: x.tick, status: x.round_win_status, reason: x.round_win_reason };
      }
      if (x.event_name === "cs_win_panel_match" && !results[x.total_rounds_played]) {
        results[x.total_rounds_played] = { tick: x.tick, status: x.round_win_status, reason: x.round_win_reason };
      }
    }
    // keep only freeze-ends that are followed by a result (drops restarts / tech pauses re-freezes)
    const rounds = [];
    for (let i = 0; i < freezeEnds.length; i++) {
      const fe = freezeEnds[i];
      const next = freezeEnds[i + 1] ?? Infinity;
      if (next - fe < TICKRATE * 3) continue;
      const n = rounds.length + 1;
      const r = results[n];
      const officialEnd = r ? r.tick : Math.min(next, fe + TICKRATE * 160);
      rounds.push({
        n, freezeEndTick: fe, officialEndTick: Math.min(officialEnd, next),
        winner: r ? side(r.status) : null, reason: r ? r.reason : null,
        events: [], hurts: [], nades: [], blinds: [], plantTick: null, plantPos: null,
      });
    }
    if (!rounds.length) throw new Error("Couldn't find any rounds in this demo.");

    const roundOf = (tick) => {
      for (let i = rounds.length - 1; i >= 0; i--) if (tick >= rounds[i].freezeEndTick - TICKRATE * 20) return tick <= rounds[i].officialEndTick ? rounds[i] : null;
      return null;
    };
    for (const x of live) {
      const r = roundOf(x.tick);
      if (!r || x.tick < r.freezeEndTick) continue;
      if (x.event_name === "player_death") {
        r.events.push({
          type: "kill", tick: x.tick, victim: x.user_steamid, attacker: x.attacker_steamid || null,
          assister: x.assister_steamid || null, weapon: x.weapon, headshot: !!x.headshot,
          vx: x.user_X, vy: x.user_Y, ax: x.attacker_X, ay: x.attacker_Y,
          thrusmoke: !!x.thrusmoke, attackerblind: !!x.attackerblind, flashAssist: !!x.assistedflash,
        });
      } else if (x.event_name === "bomb_planted" && r.plantTick == null) {
        r.plantTick = x.tick; r.plantPos = [x.user_X, x.user_Y]; r.planter = x.user_steamid;
        r.events.push({ type: "plant", tick: x.tick, player: x.user_steamid, x: x.user_X, y: x.user_Y });
      } else if (x.event_name === "bomb_defused") {
        r.events.push({ type: "defuse", tick: x.tick, player: x.user_steamid, x: x.user_X, y: x.user_Y });
      } else if (x.event_name === "bomb_exploded") {
        r.events.push({ type: "explode", tick: x.tick });
      } else if (x.event_name === "player_hurt") {
        if (x.attacker_steamid && x.attacker_steamid !== x.user_steamid) r.hurts.push({ tick: x.tick, attacker: x.attacker_steamid, victim: x.user_steamid, dmg: x.dmg_health || 0, weapon: x.weapon || "" });
      } else if (x.event_name === "player_blind") {
        if (x.attacker_steamid) r.blinds.push({ tick: x.tick, attacker: x.attacker_steamid, victim: x.user_steamid, dur: Math.round((x.blind_duration || 0) * 10) / 10 });
      } else if (NADES[x.event_name]) {
        r.nades.push({ type: NADES[x.event_name], tick: x.tick, player: x.user_steamid, x: Math.round(x.x ?? x.user_X ?? 0), y: Math.round(x.y ?? x.user_Y ?? 0) });
      }
    }

    // ── Player positions for every round, 8× per second
    step("positions", "active");
    const wanted = [];
    for (const r of rounds) for (let t = r.freezeEndTick - TICKRATE * 2; t <= r.officialEndTick; t += FRAME_STEP) wanted.push(t);
    const deathTicks = rounds.flatMap((r) => r.events.filter((x) => x.type === "kill").map((x) => x.tick - 1));
    const tk = norm(P.parseTicks(bytes,
      ["X", "Y", "Z", "yaw", "health", "is_alive", "team_num", "current_equip_value", "has_defuser", "active_weapon_name", "team_clan_name", "balance", "last_place_name"],
      wanted, null, true));
    const inv = norm(P.parseTicks(bytes, ["inventory", "team_num"], deathTicks, null, true));
    bytes = null;
    step("positions", "done", (tk.tick ? tk.tick.length : 0).toLocaleString() + " samples");

    step("build", "active");
    const players = {};
    const frameMap = new Map();
    const places = [], placeIdx = new Map();
    const placeOf = (name) => {
      if (!name) return -1;
      let i = placeIdx.get(name);
      if (i == null) { i = places.length; places.push(name); placeIdx.set(name, i); }
      return i;
    };
    const N = tk.tick ? tk.tick.length : 0;
    for (let i = 0; i < N; i++) {
      const team = side(tk.team_num[i]);
      if (!team) continue;                               // spectators / casters
      const sid = tk.steamid[i];
      if (!players[sid]) players[sid] = { sid, name: tk.name[i], clan: tk.team_clan_name[i] || "" };
      let f = frameMap.get(tk.tick[i]);
      if (!f) { f = { tick: tk.tick[i], p: [] }; frameMap.set(tk.tick[i], f); }
      f.p.push({
        sid, team, alive: !!tk.is_alive[i], hp: tk.health[i] || 0,
        x: Math.round(tk.X[i]), y: Math.round(tk.Y[i]), z: Math.round(tk.Z[i]), yaw: Math.round(tk.yaw[i]),
        equip: tk.current_equip_value[i] || 0, kit: !!tk.has_defuser[i], wep: tk.active_weapon_name[i] || "", money: tk.balance[i] || 0,
        pl: placeOf(tk.last_place_name[i]),
      });
    }
    const frames = [...frameMap.values()].sort((a, b) => a.tick - b.tick);

    // inventory at the moment of each death (for "died with unused utility")
    const invAt = {};
    for (let i = 0; i < (inv.tick ? inv.tick.length : 0); i++) invAt[inv.tick[i] + 1 + ":" + inv.steamid[i]] = inv.inventory[i] || [];

    for (const r of rounds) {
      r.frames = frames.filter((f) => f.tick >= r.freezeEndTick - TICKRATE * 2 && f.tick <= r.officialEndTick);
      const f0 = r.frames.find((f) => f.tick >= r.freezeEndTick) || r.frames[0];
      r.teams = {};
      r.clanSide = {};
      if (f0) for (const p of f0.p) { r.teams[p.sid] = p.team; const c = players[p.sid] && players[p.sid].clan; if (c) r.clanSide[c] = p.team; }
      r.buy = {};
      if (f0) for (const p of f0.p) r.buy[p.team] = (r.buy[p.team] || 0) + p.equip;
      for (const ev of r.events) if (ev.type === "kill") ev.inv = invAt[ev.tick + ":" + ev.victim] || null;
      // when the action actually ended: last team wiped, bomb resolved, or the clock ran out
      r.endTick = actionEnd(r);
    }

    // teams by clan name (FACEIT uses team_<captain>)
    const clans = [...new Set(Object.values(players).map((p) => p.clan).filter(Boolean))];
    const score = {};
    for (const c of clans) score[c] = 0;
    for (const r of rounds) for (const c of clans) if (r.winner && r.clanSide[c] === r.winner) score[c]++;

    const match = {
      id: hashId(header, rounds),
      map: header.map_name || "unknown",
      server: header.server_name || "",
      tickrate: TICKRATE,
      version: 2,
      players: Object.values(players),
      places,
      clans, score,
      rounds,
      parseSeconds: Math.round((performance.now() - t0) / 100) / 10,
    };
    step("build", "done");
    postMessage({ type: "done", match });
  } catch (err) {
    postMessage({ type: "error", message: String((err && err.message) || err) });
  }
};

function actionEnd(r) {
  const T = 64;
  const alive = { T: new Set(), CT: new Set() };
  for (const [sid, team] of Object.entries(r.teams)) alive[team].add(sid);
  let end = Math.min(r.officialEndTick, (r.plantTick ? r.plantTick + 41 * T : r.freezeEndTick + 116 * T));
  for (const ev of r.events) {
    if (ev.type === "kill") {
      const team = r.teams[ev.victim];
      if (team) alive[team].delete(ev.victim);
      if (alive.CT.size === 0 || (alive.T.size === 0 && !(r.plantTick && ev.tick >= r.plantTick))) return ev.tick;
    }
    if (ev.type === "defuse" || ev.type === "explode") return ev.tick;
  }
  return end;
}

function hashId(header, rounds) {
  const s = (header.map_name || "") + rounds.map((r) => r.freezeEndTick).join(",");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}
