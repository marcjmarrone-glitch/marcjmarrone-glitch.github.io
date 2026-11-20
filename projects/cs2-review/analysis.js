// ─────────────────────────────────────────────────────────────
//  Round analysis: win probability + swing detection.
//
//  WIN PROBABILITY — baseline model v0 (hand-tuned, not trained yet).
//  Estimates the T side's chance to win the round from the state:
//  players alive, equipment value, bomb status and time left.
//  Phase 2 replaces these coefficients with a model trained on real demos.
// ─────────────────────────────────────────────────────────────
(function (root) {
  const ROUND_TIME = 115;   // seconds of action after freeze time (competitive)
  const BOMB_TIME = 40;     // seconds from plant to explosion
  const TRADE_WINDOW = 5;   // seconds a teammate has to trade a death

  const sigmoid = (z) => 1 / (1 + Math.exp(-z));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const UTILITY = /grenade|flashbang|molotov|incendiary|smoke|decoy|he /i;

  /**
   * s = { tAlive, ctAlive, tEquip, ctEquip, planted, secondsLeft, bombLeft, ctKit }
   * returns P(T wins round), 0..1
   */
  // Each extra player matters more when fewer are left (5v4 ≈ 70%, 2v1 ≈ 80%, 1v2 ≈ 20%).
  const perPlayer = (s) => 0.75 + 0.15 * (5 - Math.min(5, Math.max(1, Math.min(s.tAlive, s.ctAlive))));

  function winProbT(s) {
    if (s.ctAlive === 0) return 1;
    const eq = Math.log((s.tEquip + 800) / (s.ctEquip + 800));
    const k = perPlayer(s);

    if (!s.planted) {
      if (s.tAlive === 0) return 0;
      let z = -0.1 + k * (s.tAlive - s.ctAlive) + 0.9 * eq;
      if (s.secondsLeft < 40) z -= ((40 - s.secondsLeft) / 40) * 2.6;   // Ts running out of time
      if (s.secondsLeft <= 5) z -= 3;
      return clamp(sigmoid(z), 0.005, 0.995);
    }

    const defuse = s.ctKit ? 5 : 10;
    if (s.bombLeft <= defuse - 0.5) return 0.99;                        // too late to defuse
    if (s.tAlive === 0) return s.bombLeft < defuse + 4 ? 0.35 : 0.04;   // CTs just need to defuse
    // slack = seconds CTs have before they must start defusing; the less, the better for T
    const slack = s.bombLeft - defuse;
    let z = 0.75 + k * (s.tAlive - s.ctAlive) + 0.6 * eq;
    z += 1.2 * (1 - clamp(slack / 25, 0, 1)) - 0.3;
    return clamp(sigmoid(z), 0.005, 0.995);
  }

  function nearestFrame(frames, tick) {
    let lo = 0, hi = frames.length - 1;
    if (hi < 0) return null;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (frames[mid].tick <= tick) lo = mid; else hi = mid - 1;
    }
    return frames[lo];
  }

  /** Game state at a tick. `inclusive` = count deaths that happen exactly on this tick. */
  function stateAt(round, tick, tickrate, inclusive) {
    const dead = new Set();
    for (const ev of round.events) {
      if (ev.type !== "kill") continue;
      if (ev.tick < tick || (inclusive && ev.tick === tick)) dead.add(ev.victim); else break;
    }
    const f = nearestFrame(round.frames, tick);
    const byId = {};
    if (f) for (const p of f.p) byId[p.sid] = p;
    let tAlive = 0, ctAlive = 0, tEquip = 0, ctEquip = 0, ctKit = false;
    for (const [sid, team] of Object.entries(round.teams)) {
      if (dead.has(sid)) continue;
      const p = byId[sid];
      const eq = p ? p.equip : 0;
      if (team === "T") { tAlive++; tEquip += eq; }
      else { ctAlive++; ctEquip += eq; if (p && p.kit) ctKit = true; }
    }
    const planted = round.plantTick != null && tick > round.plantTick;
    return {
      tAlive, ctAlive, tEquip, ctEquip, ctKit, planted,
      secondsLeft: ROUND_TIME - (tick - round.freezeEndTick) / tickrate,
      bombLeft: planted ? BOMB_TIME - (tick - round.plantTick) / tickrate : BOMB_TIME,
    };
  }

  /** Win-probability timeline for a round + every kill/plant/defuse scored by its swing. */
  function analyzeRound(round, tickrate) {
    const points = [];
    const t0 = round.freezeEndTick, t1 = round.endTick;
    const keyTicks = new Set();
    for (let t = t0; t <= t1; t += Math.round(tickrate / 4)) keyTicks.add(t);
    for (const ev of round.events) if (ev.tick >= t0 && ev.tick <= t1) { keyTicks.add(ev.tick - 1); keyTicks.add(ev.tick); }
    for (const t of [...keyTicks].sort((a, b) => a - b)) {
      points.push({ tick: t, p: winProbT(stateAt(round, t, tickrate, true)) });
    }
    // final point snaps to the actual result
    if (round.winner) points.push({ tick: t1 + 1, p: round.winner === "T" ? 1 : 0 });

    const scored = [];
    for (const ev of round.events) {
      if (ev.type !== "kill" && ev.type !== "plant" && ev.type !== "defuse") continue;
      const sBefore = stateAt(round, ev.tick, tickrate, false);
      const before = winProbT(sBefore);
      let after;
      if (ev.type === "defuse") after = 0;
      else if (ev.type === "plant") after = winProbT({ ...sBefore, planted: true, bombLeft: BOMB_TIME });
      else after = winProbT(stateAt(round, ev.tick, tickrate, true));
      scored.push({ ...ev, state: sBefore, before, after, deltaT: after - before });
    }
    return { points, scored };
  }

  /**
   * The selected player's costliest moments. Each death gets the swing it caused
   * for their team plus tags that explain why it hurt.
   */
  function findMistakes(match, analyses, sid) {
    const out = [];
    match.rounds.forEach((round, ri) => {
      const a = analyses[ri];
      const team = round.teams[sid];
      if (!a || !team) return;
      const kills = a.scored.filter((e) => e.type === "kill");
      kills.forEach((k, ki) => {
        if (k.victim !== sid) return;
        const sign = team === "T" ? 1 : -1;
        const swing = k.deltaT * sign;
        const my = team === "T" ? k.state.tAlive : k.state.ctAlive;
        const their = team === "T" ? k.state.ctAlive : k.state.tAlive;
        const winBefore = team === "T" ? k.before : 1 - k.before;
        const tags = [];
        if (ki === 0) tags.push("opening death");
        const traded = k.attacker && kills.some((o) => o.victim === k.attacker && o.tick >= k.tick &&
          (o.tick - k.tick) / match.tickrate <= TRADE_WINDOW);
        if (!traded) tags.push("not traded");
        if (my > their) tags.push(`threw a ${my}v${their}`);
        if (winBefore >= 0.7 && my >= their) tags.push(`round was ${Math.round(winBefore * 100)}% yours`);
        const nades = (k.inv || []).filter((w) => UTILITY.test(w)).length;
        if (nades >= 2) tags.push(`${nades} grenades unused`);
        if (k.attackerblind) tags.push("killer was flashed");
        if (k.thrusmoke) tags.push("killed through smoke");
        if (team === "CT" && k.state.planted) tags.push("post-plant retake");
        const lostRound = !!round.winner && round.winner !== team;
        // How much of this is on you: dying last in a 1vN is usually the odds, not a blunder;
        // dying while your team is ahead is usually avoidable.
        const avoid = my === 1 && their >= 2 ? 0.45 : my === 1 ? 0.7 : my < their ? 0.7 : my > their ? 1.25 : 1;
        out.push({ rank: swing * avoid * (lostRound ? 1.15 : 1), clutch: my === 1,
          round: ri, tick: k.tick, swing, winBefore, tags, lostRound, team,
          situation: `${my}v${their}`, weapon: k.weapon, attacker: k.attacker,
        });
      });
    });
    out.sort((a, b) => a.rank - b.rank);
    return out;
  }

  /** Per-player totals: win probability added (kills +, deaths −), K/D, opening duels. */
  function swingStats(match, analyses) {
    const stats = {};
    const get = (sid) => (stats[sid] ||= { wpa: 0, rounds: 0, kills: 0, deaths: 0, openK: 0, openD: 0, plants: 0 });
    match.rounds.forEach((round, ri) => {
      const a = analyses[ri];
      if (!a) return;
      Object.keys(round.teams).forEach((sid) => get(sid).rounds++);
      let first = true;
      for (const e of a.scored) {
        const tSign = (team) => (team === "T" ? 1 : -1);
        if (e.type === "kill") {
          const vTeam = round.teams[e.victim];
          if (e.victim && vTeam) {
            get(e.victim).wpa += e.deltaT * tSign(vTeam); get(e.victim).deaths++;
            if (first) get(e.victim).openD++;
          }
          const aTeam = e.attacker && round.teams[e.attacker];
          if (aTeam && aTeam !== vTeam) {
            get(e.attacker).wpa += e.deltaT * tSign(aTeam); get(e.attacker).kills++;
            if (first) get(e.attacker).openK++;
          }
          first = false;
        } else if ((e.type === "plant" || e.type === "defuse") && e.player && round.teams[e.player]) {
          get(e.player).wpa += e.deltaT * tSign(round.teams[e.player]);
          if (e.type === "plant") get(e.player).plants++;
        }
      }
    });
    return stats;
  }

  root.Analysis = { winProbT, stateAt, analyzeRound, findMistakes, swingStats, nearestFrame, ROUND_TIME, BOMB_TIME };
})(typeof self !== "undefined" ? self : window);
