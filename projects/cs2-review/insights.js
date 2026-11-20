// ─────────────────────────────────────────────────────────────
//  Insights: highlights, death context, playstyle and action items,
//  plus the dataset rows saved for training the phase 2 model.
//  Depends on analysis.js (Analysis.*).
// ─────────────────────────────────────────────────────────────
(function (root) {
  const A = root.Analysis;
  const TRADE = 5;              // seconds
  const MOVING = 140;           // u/s: faster than this when dying = caught running (walk ≈ 130, run ≈ 215–250)
  const STILL = 60;             // u/s: slower than this when killing = stopped to shoot
  const ISOLATED = 900;         // units to the nearest living teammate (hard to trade from further)
  const UTIL = /grenade|flashbang|molotov|incendiary|smoke|decoy/i;
  const SCHEMA = 1;             // bump when dataset rows change shape

  const tickSec = (m, t) => t / m.tickrate;
  const frameAt = (round, tick) => A.nearestFrame(round.frames, tick);
  const pOf = (f, sid) => f && f.p.find((p) => p.sid === sid);

  function speedAt(round, sid, tick) {
    const i = round.frames.indexOf(frameAt(round, tick - 1));
    if (i < 1) return null;
    const a = pOf(round.frames[i - 1], sid), b = pOf(round.frames[i], sid);
    if (!a || !b) return null;
    const dt = (round.frames[i].tick - round.frames[i - 1].tick) / 64;
    return dt > 0 ? Math.hypot(b.x - a.x, b.y - a.y) / dt : null;
  }

  /** Who is alive right before `tick` (kills strictly earlier). */
  function aliveBefore(round, tick) {
    const dead = new Set();
    for (const e of round.events) { if (e.type !== "kill") continue; if (e.tick < tick) dead.add(e.victim); else break; }
    return Object.keys(round.teams).filter((s) => !dead.has(s));
  }

  function mateDistance(round, sid, tick) {
    const f = frameAt(round, tick - 1), me = pOf(f, sid);
    if (!me) return null;
    let best = Infinity;
    for (const s of aliveBefore(round, tick)) {
      if (s === sid || round.teams[s] !== round.teams[sid]) continue;
      const p = pOf(f, s);
      if (p) best = Math.min(best, Math.hypot(p.x - me.x, p.y - me.y));
    }
    return best === Infinity ? null : Math.round(best);
  }

  const prettyPlace = (n) => (n || "").replace(/([a-z])([A-Z0-9])/g, "$1 $2");
  const placeName = (match, round, sid, tick) => {
    const p = pOf(frameAt(round, tick - 1), sid);
    return p && p.pl >= 0 && match.places ? prettyPlace(match.places[p.pl]) : "";
  };

  /** Context for every death in a round: moving?, isolated?, where, traded? */
  function deathContext(match, round, kill, kills) {
    const sp = speedAt(round, kill.victim, kill.tick);
    const md = mateDistance(round, kill.victim, kill.tick);
    const traded = !!kill.attacker && kills.some((o) => o.victim === kill.attacker && o.tick >= kill.tick && tickSec(match, o.tick - kill.tick) <= TRADE);
    return {
      speed: sp == null ? null : Math.round(sp), moving: sp != null && sp > MOVING,
      mateDist: md, isolated: md != null && md > ISOLATED, traded,
      place: placeName(match, round, kill.victim, kill.tick),
      utilLeft: (kill.inv || []).filter((w) => UTIL.test(w)).length,
      sec: Math.round(tickSec(match, kill.tick - round.freezeEndTick)),
    };
  }

  /** Add positioning tags to the mistakes list from analysis.js. */
  function enrichMistakes(match, mistakes) {
    for (const x of mistakes) {
      const r = match.rounds[x.round];
      const k = r.events.find((e) => e.type === "kill" && e.tick === x.tick);
      if (!k) continue;
      const c = deathContext(match, r, k, r.events.filter((e) => e.type === "kill"));
      x.ctx = c;
      if (c.isolated && !x.tags.includes("isolated")) x.tags.push(`isolated (${Math.round(c.mateDist / 52)}m from team)`);
      if (c.moving) x.tags.push("caught moving");
      if (c.place) x.place = c.place;
    }
    return mistakes;
  }

  // ═══════════ Highlights: what you did well ═══════════
  function findHighlights(match, analyses, sid) {
    const out = [];
    const nm = (x) => (match.players.find((p) => p.sid === x) || {}).name || "?";
    const wep = (w) => (w || "").replace(/^weapon_/, "").replace(/_/g, " ");
    match.rounds.forEach((round, ri) => {
      const a = analyses[ri], team = round.teams[sid];
      if (!a || !team) return;
      const sign = team === "T" ? 1 : -1;
      const kills = a.scored.filter((e) => e.type === "kill");
      const won = round.winner === team;
      const myKills = kills.filter((k) => k.attacker === sid && round.teams[k.victim] && round.teams[k.victim] !== team);

      // individual kills that swung the round
      myKills.forEach((k) => {
        const swing = k.deltaT * sign;
        const tags = [];
        if (kills[0] === k) tags.push("opening kill");
        const avenged = kills.find((o) => o.attacker === k.victim && round.teams[o.victim] === team && o.tick <= k.tick && tickSec(match, k.tick - o.tick) <= TRADE);
        if (avenged) tags.push("traded a teammate");
        const sp = speedAt(round, sid, k.tick);
        if (sp != null && sp < STILL) tags.push("stopped to shoot");
        if (k.headshot) tags.push("headshot");
        const my = team === "T" ? k.state.tAlive : k.state.ctAlive, their = team === "T" ? k.state.ctAlive : k.state.tAlive;
        if (my < their) tags.push(`down ${my}v${their}`);
        if (swing >= 0.12 || (kills[0] === k)) {
          out.push({ kind: "kill", round: ri, tick: k.tick, score: swing, swing, won, team,
            title: kills[0] === k ? "Opening kill" : avenged ? "Trade kill" : "Big kill",
            desc: `Killed ${nm(k.victim)} (${wep(k.weapon)}). Win chance ${Math.round((team === "T" ? k.before : 1 - k.before) * 100)}% → ${Math.round((team === "T" ? k.after : 1 - k.after) * 100)}%.`,
            victim: k.victim, weapon: k.weapon, tags });
        }
      });

      // fast multi-kills (aim)
      for (let i = 0; i < myKills.length; i++) {
        let j = i;
        while (j + 1 < myKills.length && tickSec(match, myKills[j + 1].tick - myKills[i].tick) <= 6) j++;
        const n = j - i + 1;
        if (n >= 2) {
          const span = tickSec(match, myKills[j].tick - myKills[i].tick);
          const swing = myKills.slice(i, j + 1).reduce((s, k) => s + k.deltaT * sign, 0);
          const hs = myKills.slice(i, j + 1).filter((k) => k.headshot).length;
          out.push({ kind: "multi", round: ri, tick: myKills[i].tick, score: swing + 0.05 * n, swing, won, team,
            title: `${n}K in ${span.toFixed(1)}s`, desc: `${n} kills in quick succession${hs ? `, ${hs} headshot${hs > 1 ? "s" : ""}` : ""}.`,
            tags: ["aim", ...(hs === n ? ["all headshots"] : [])] });
          i = j;
        }
      }

      // clutches: you were the last one alive on your team and still won
      let lastTick = null, vs = 0;
      for (const k of kills) {
        const alive = aliveBefore(round, k.tick + 1);
        const mates = alive.filter((s) => round.teams[s] === team);
        if (mates.length === 1 && mates[0] === sid && lastTick == null) {
          lastTick = k.tick; vs = alive.filter((s) => round.teams[s] !== team).length;
        }
      }
      if (lastTick != null && vs >= 1) {
        const q = A.nearestFrame(a.points, lastTick + 1);
        const pWin = q ? (team === "T" ? q.p : 1 - q.p) : 0.2;
        if (won) out.push({ kind: "clutch", round: ri, tick: lastTick, score: (1 - pWin) + 0.1 * vs, swing: 1 - pWin, won, team,
          title: `Won a 1v${vs}`, desc: `Last one alive with a ${Math.round(pWin * 100)}% chance, and you closed it out.`, tags: ["clutch", "decision making"] });
      }

      // smart saves: round was gone, you stayed alive and kept your gear
      const died = kills.some((k) => k.victim === sid);
      if (!won && round.winner && !died) {
        const endF = frameAt(round, round.endTick), me = pOf(endF, sid);
        const q = A.nearestFrame(a.points, round.endTick - 64);
        const pWin = q ? (team === "T" ? q.p : 1 - q.p) : 0;
        if (me && me.alive && me.equip >= 2500 && pWin < 0.2) {
          out.push({ kind: "save", round: ri, tick: round.endTick - 64 * 3, score: Math.min(0.3, me.equip / 20000), swing: 0, won, team,
            title: `Saved $${me.equip.toLocaleString()} of gear`, desc: "The round was lost; you stayed alive and carried your weapons into the next buy.", tags: ["staying alive", "decision making"] });
        }
      }

      // bomb plays
      for (const e of a.scored) {
        if ((e.type === "plant" || e.type === "defuse") && e.player === sid) {
          const swing = e.deltaT * sign;
          if (swing >= 0.08) out.push({ kind: e.type, round: ri, tick: e.tick, score: swing, swing, won, team,
            title: e.type === "plant" ? "Got the plant" : "Defused", desc: `Win chance moved ${Math.round(swing * 100)}% your way.`, tags: ["objective"] });
        }
      }

      // utility that set up kills
      const fa = round.events.filter((k) => k.type === "kill" && k.assister === sid && k.flashAssist && round.teams[k.victim] !== team);
      const blinded = round.blinds.filter((b) => b.attacker === sid && round.teams[b.victim] && round.teams[b.victim] !== team && b.dur >= 1.5);
      if (fa.length || blinded.length >= 2) {
        out.push({ kind: "utility", round: ri, tick: (fa[0] || blinded[0]).tick, score: 0.06 * fa.length + 0.03 * blinded.length, swing: 0, won, team,
          title: fa.length ? `Flash assist${fa.length > 1 ? " ×" + fa.length : ""}` : `Blinded ${blinded.length} enemies`,
          desc: `${blinded.length} enemies flashed for 1.5s+${fa.length ? `, ${fa.length} died while blind` : ""}.`, tags: ["utility"] });
      }
    });
    out.sort((x, y) => y.score - x.score);
    return out;
  }

  // ═══════════ Playstyle: one set of numbers per player per match ═══════════
  function styleOf(match, analyses, sid) {
    const s = { rounds: 0, kills: 0, deaths: 0, dmg: 0, openK: 0, openD: 0, untraded: 0, isolatedD: 0, movingD: 0, speedKnown: 0,
      stillK: 0, speedKnownK: 0, tradeK: 0, deathSec: 0, survived: 0, nades: 0, utilLeft: 0, flashAssists: 0, flashed: 0,
      clutchTry: 0, clutchWon: 0, throws: 0, deathPlaces: {}, side: { T: { rounds: 0, wpa: 0 }, CT: { rounds: 0, wpa: 0 } }, wpa: 0 };
    match.rounds.forEach((round, ri) => {
      const a = analyses[ri], team = round.teams[sid];
      if (!a || !team) return;
      const sign = team === "T" ? 1 : -1;
      s.rounds++; s.side[team].rounds++;
      const kills = a.scored.filter((e) => e.type === "kill");
      let died = false;
      kills.forEach((k, i) => {
        if (k.attacker === sid && round.teams[k.victim] !== team) {
          s.kills++; s.wpa += k.deltaT * sign; s.side[team].wpa += k.deltaT * sign;
          if (i === 0) s.openK++;
          if (kills.some((o) => o.attacker === k.victim && round.teams[o.victim] === team && o.tick <= k.tick && tickSec(match, k.tick - o.tick) <= TRADE)) s.tradeK++;
          const sp = speedAt(round, sid, k.tick);
          if (sp != null) { s.speedKnownK++; if (sp < STILL) s.stillK++; }
        }
        if (k.victim === sid) {
          died = true; s.deaths++; s.wpa += k.deltaT * sign; s.side[team].wpa += k.deltaT * sign;
          if (i === 0) s.openD++;
          const c = deathContext(match, round, k, kills);
          if (!c.traded) s.untraded++;
          if (c.isolated) s.isolatedD++;
          if (c.speed != null) { s.speedKnown++; if (c.moving) s.movingD++; }
          s.deathSec += c.sec; s.utilLeft += c.utilLeft;
          if (c.place) { const key = team + "·" + c.place; s.deathPlaces[key] = (s.deathPlaces[key] || 0) + 1; }
          const my = team === "T" ? k.state.tAlive : k.state.ctAlive, their = team === "T" ? k.state.ctAlive : k.state.tAlive;
          if (my > their) s.throws++;
        }
      });
      for (const e of a.scored) if ((e.type === "plant" || e.type === "defuse") && e.player === sid) { s.wpa += e.deltaT * sign; s.side[team].wpa += e.deltaT * sign; }
      if (!died) s.survived++;
      const hpLeft = {};
      for (const h of round.hurts) {
        if (h.attacker !== sid || round.teams[h.victim] === team) continue;
        const left = hpLeft[h.victim] ?? 100;
        const d = Math.min(left, h.dmg); hpLeft[h.victim] = left - d; s.dmg += d;
      }
      s.nades += round.nades.filter((n) => n.player === sid).length;
      s.flashed += round.blinds.filter((b) => b.attacker === sid && round.teams[b.victim] && round.teams[b.victim] !== team && b.dur >= 1).length;
      s.flashAssists += round.events.filter((k) => k.type === "kill" && k.assister === sid && k.flashAssist).length;
      // clutch attempts
      for (const k of kills) {
        const alive = aliveBefore(round, k.tick + 1);
        const mates = alive.filter((x) => round.teams[x] === team);
        if (mates.length === 1 && mates[0] === sid && alive.some((x) => round.teams[x] !== team)) { s.clutchTry++; if (round.winner === team) s.clutchWon++; break; }
      }
    });
    return s;
  }

  /** Add up many per-match style objects. */
  function mergeStyles(list) {
    const out = { deathPlaces: {}, side: { T: { rounds: 0, wpa: 0 }, CT: { rounds: 0, wpa: 0 } } };
    for (const s of list) for (const k in s) {
      if (k === "deathPlaces") for (const p in s[k]) out.deathPlaces[p] = (out.deathPlaces[p] || 0) + s[k][p];
      else if (k === "side") for (const sd of ["T", "CT"]) { out.side[sd].rounds += s.side[sd].rounds; out.side[sd].wpa += s.side[sd].wpa; }
      else out[k] = (out[k] || 0) + s[k];
    }
    return out;
  }

  /** Rates used for comparison + action items. */
  function rates(s) {
    const r = (a, b) => (b > 0 ? a / b : null);
    return {
      adr: r(s.dmg, s.rounds), kpr: r(s.kills, s.rounds), survival: r(s.survived, s.rounds), wpa: r(s.wpa, s.rounds),
      openPerRound: r(s.openK + s.openD, s.rounds), openWin: r(s.openK, s.openK + s.openD),
      untraded: r(s.untraded, s.deaths), isolated: r(s.isolatedD, s.deaths), moving: r(s.movingD, s.speedKnown),
      still: r(s.stillK, s.speedKnownK), tradeK: r(s.tradeK, s.rounds), utilLeft: r(s.utilLeft, s.deaths),
      nades: r(s.nades, s.rounds), flashed: r(s.flashed, s.rounds), clutch: r(s.clutchWon, s.clutchTry), deathTime: r(s.deathSec, s.deaths),
    };
  }

  // Rough starting benchmarks. Replaced by real baselines (median of other players in your saved
  // demos) once there are enough of them — see baselinesFrom().
  const DEFAULT_BASE = { adr: 75, kpr: 0.68, survival: 0.32, untraded: 0.45, isolated: 0.3, moving: 0.35, still: 0.6,
    utilLeft: 1.0, nades: 1.6, openPerRound: 0.2, openWin: 0.5, flashed: 0.35, tradeK: 0.12 };

  function baselinesFrom(otherStyles) {
    if (otherStyles.length < 30) return { base: DEFAULT_BASE, source: "default", n: otherStyles.length };
    const base = {};
    const rs = otherStyles.map(rates);
    for (const k of Object.keys(DEFAULT_BASE)) {
      const v = rs.map((r) => r[k]).filter((x) => x != null).sort((a, b) => a - b);
      base[k] = v.length ? v[Math.floor(v.length / 2)] : DEFAULT_BASE[k];
    }
    return { base, source: "your saved demos", n: otherStyles.length };
  }

  const P = (x) => Math.round(x * 100) + "%";

  /**
   * Turn a player's style into 3 things to work on and things to keep doing.
   * Each item says what we saw, why it costs rounds, and one concrete thing to try next game.
   */
  function actionItems(style, baseline) {
    const r = rates(style), b = baseline.base;
    const fix = [], keep = [];
    const add = (list, weight, title, saw, why, todo) => list.push({ weight, title, saw, why, todo });
    if (style.deaths >= 5) {
      if (r.untraded > b.untraded + 0.08) add(fix, (r.untraded - b.untraded) * style.deaths, "Die where you can be traded",
        `${P(r.untraded)} of your deaths weren't traded (benchmark ${P(b.untraded)}).`, "An untraded death is a free 5v4 for the enemy.",
        "Before you peek, check a teammate is close enough to swing right after you. If nobody is, wait or fall back.");
      if (r.isolated > b.isolated + 0.08) add(fix, (r.isolated - b.isolated) * style.deaths, "Stay within trade distance",
        `${P(r.isolated)} of your deaths happened 17m+ from the nearest teammate.`, "Far from your team, even a won duel often can't be followed up.",
        "Keep one teammate within a few seconds' reach. On CT, play a spot where a rotator can help.");
      if (r.moving != null && r.moving > b.moving + 0.08) add(fix, (r.moving - b.moving) * style.deaths, "Stop before you shoot",
        `${P(r.moving)} of your deaths came while you were running.`, "Running shots are inaccurate, and running into an angle loses to someone holding it.",
        "Counter-strafe on every peek: tap the opposite key and fire when you're stopped. Jiggle-peek for info instead of wide-swinging.");
      if (r.utilLeft > b.utilLeft + 0.4) add(fix, (r.utilLeft - b.utilLeft) * style.deaths * 0.7, "Use your grenades before you die",
        `You died with ${r.utilLeft.toFixed(1)} grenades on average.`, "Unused utility is money and rounds thrown away.",
        "Every round, decide where your flash or smoke goes before you take a fight. If you're about to die, throw it.");
      const top = Object.entries(style.deathPlaces).sort((a, c) => c[1] - a[1])[0];
      if (top && top[1] >= 4 && top[1] / style.deaths >= 0.2) {
        const [sd, place] = top[0].split("·");
        add(fix, top[1] * 0.25, `Rethink ${place} on ${sd}`, `${top[1]} of your ${style.deaths} deaths were at ${place} on ${sd} side.`,
          "Dying in the same spot means the enemy has a read on you.", `Next ${sd} half: change your angle or timing at ${place}, or ask for a flash before you take it.`);
      }
    }
    if (style.throws >= 2) add(fix, style.throws * 0.5, "Close out your advantages",
      `You died ${style.throws} times while your team had more players alive.`, "Advantage rounds are lost by taking unnecessary duels.",
      "When your team is up a player, slow down: hold angles, play for time and trades, let them come to you.");
    if (r.openPerRound != null && r.openPerRound > b.openPerRound + 0.08 && r.openWin < b.openWin - 0.05 && style.rounds >= 10)
      add(fix, (r.openPerRound - b.openPerRound) * style.rounds, "Take fewer dry opening duels",
        `You took the first fight ${P(r.openPerRound)} of rounds and won ${P(r.openWin)} of them.`, "A lost opening duel makes the whole round 4v5.",
        "Only take the first fight with a flash, a trade partner, or a strong off-angle. Otherwise let the entry go first.");
    if (r.nades != null && r.nades < b.nades - 0.5 && style.rounds >= 10) add(fix, (b.nades - r.nades) * 4, "Throw more utility",
      `You threw ${r.nades.toFixed(1)} grenades per round (benchmark ${b.nades.toFixed(1)}).`, "Utility wins fights before they start.",
      "Learn one smoke and one flash for each site you play. Throw at least one grenade every round you buy.");

    if (r.still != null && style.kills >= 5 && r.still >= b.still + 0.05) add(keep, r.still, "Stopping to shoot", `${P(r.still)} of your kills came while you were stopped.`, "", "");
    if (r.openWin != null && style.openK + style.openD >= 5 && r.openWin >= b.openWin + 0.08) add(keep, r.openWin, "Winning opening duels", `You won ${P(r.openWin)} of first fights.`, "", "");
    if (r.tradeK != null && r.tradeK >= b.tradeK + 0.04) add(keep, r.tradeK * 4, "Trading teammates", `${style.tradeK} trade kills.`, "", "");
    if (r.adr != null && style.rounds >= 10 && r.adr >= b.adr + 8) add(keep, r.adr / 100, "Damage output", `${Math.round(r.adr)} damage per round.`, "", "");
    if (style.clutchWon >= 1) add(keep, style.clutchWon, "Clutching", `Won ${style.clutchWon} of ${style.clutchTry} clutch${style.clutchTry > 1 ? "es" : ""}.`, "", "");
    if (r.flashed != null && r.flashed >= b.flashed + 0.1) add(keep, r.flashed, "Flashes", `${style.flashed} enemies blinded, ${style.flashAssists} flash assists.`, "", "");
    if (r.survival != null && style.rounds >= 10 && r.survival >= b.survival + 0.08) add(keep, r.survival, "Staying alive", `Survived ${P(r.survival)} of rounds.`, "", "");

    fix.sort((x, y) => y.weight - x.weight);
    keep.sort((x, y) => y.weight - x.weight);
    return { fix: fix.slice(0, 3), keep: keep.slice(0, 3), rates: r, baseline };
  }

  // ═══════════ Dataset rows (groundwork for the trained model) ═══════════
  /**
   * states: one row per second of every round, with the result as the label.
   * deaths: one row per death (every player), with the context the model and coaching need.
   */
  function datasetRows(match, analyses) {
    const states = [], deaths = [];
    match.rounds.forEach((round, ri) => {
      if (!round.winner) return;
      const tr = match.tickrate;
      for (let t = round.freezeEndTick; t <= round.endTick; t += tr) {
        const s = A.stateAt(round, t, tr, true);
        const f = frameAt(round, t);
        let tHp = 0, ctHp = 0;
        const dead = new Set(round.events.filter((e) => e.type === "kill" && e.tick <= t).map((e) => e.victim));
        if (f) for (const p of f.p) if (!dead.has(p.sid) && round.teams[p.sid]) { if (round.teams[p.sid] === "T") tHp += p.hp; else ctHp += p.hp; }
        states.push([ri, Math.round((t - round.freezeEndTick) / tr), s.tAlive, s.ctAlive, s.tEquip, s.ctEquip, tHp, ctHp,
          s.planted ? 1 : 0, s.planted ? Math.round(s.bombLeft) : 40, s.ctKit ? 1 : 0, round.winner === "T" ? 1 : 0]);
      }
      const a = analyses[ri];
      const kills = a.scored.filter((e) => e.type === "kill");
      for (const k of kills) {
        const team = round.teams[k.victim];
        if (!team) continue;
        const c = deathContext(match, round, k, kills);
        const sign = team === "T" ? 1 : -1;
        deaths.push({ r: ri, sid: k.victim, team, sec: c.sec,
          my: team === "T" ? k.state.tAlive : k.state.ctAlive, their: team === "T" ? k.state.ctAlive : k.state.tAlive,
          winBefore: +(team === "T" ? k.before : 1 - k.before).toFixed(3), swing: +(k.deltaT * sign).toFixed(3),
          traded: c.traded, speed: c.speed, mateDist: c.mateDist, place: c.place, utilLeft: c.utilLeft,
          weapon: k.weapon, attacker: k.attacker, won: round.winner === team, planted: k.state.planted });
      }
    });
    return {
      schema: SCHEMA, id: match.id, map: match.map, tag: match.tag,
      stateCols: ["round", "sec", "tAlive", "ctAlive", "tEquip", "ctEquip", "tHp", "ctHp", "planted", "bombLeft", "ctKit", "tWon"],
      states, deaths,
    };
  }

  root.Insights = { findHighlights, enrichMistakes, styleOf, mergeStyles, rates, actionItems, baselinesFrom, datasetRows, deathContext, DEFAULT_BASE, SCHEMA };
})(typeof self !== "undefined" ? self : window);
