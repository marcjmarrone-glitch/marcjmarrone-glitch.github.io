// Builds the homepage from projects.js. You shouldn't need to edit this.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const pad = (n, w = 3) => String(n).padStart(w, "0");
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const fmtDate = (d) => {
    if (!d) return "";
    const [y, m] = String(d).split("-");
    return m ? MONTHS[+m - 1] + " " + y : y;
  };

  // ── Site info
  document.title = SITE.handle + " · " + SITE.name;
  const h1 = $("handle");
  h1.textContent = SITE.handle;
  h1.append(el("span", "dot", "."));
  $("logo").firstChild.textContent = SITE.handle;
  $("real-name").textContent = SITE.name;
  $("tagline").textContent = SITE.tagline;
  $("status").textContent = SITE.status;
  $("about-text").textContent = SITE.about;
  $("copyright").textContent = "© " + new Date().getFullYear() + " " + SITE.name;

  const gh = SITE.links.find((l) => /github/i.test(l.label));
  if (gh) $("nav-github").href = gh.url; else $("nav-github").remove();
  SITE.links.forEach((l) => {
    const a = el("a", "", l.label + " ↗");
    a.href = l.url;
    if (!l.url.startsWith("mailto:")) { a.target = "_blank"; a.rel = "noopener"; }
    $("footer-links").append(a);
  });

  // ── Builds (numbered oldest → newest, shown newest first)
  const builds = BUILDS.map((b, i) => ({ ...b, n: i + 1 })).reverse();
  $("stat-count").textContent = pad(builds.length, 2);
  $("stat-latest").textContent = builds.length ? builds[0].title : "—";
  $("stat-since").textContent = SITE.since;

  const hrefOf = (b) => b.url || (b.slug ? "projects/" + b.slug + "/" : "#");

  // Live previews: render each build at 1280×800 and scale it to fit its card
  const scaler = new ResizeObserver((entries) => {
    for (const e of entries) {
      const f = e.target.querySelector("iframe");
      if (f) f.style.transform = "scale(" + e.contentRect.width / 1280 + ")";
    }
  });

  function card(b, i) {
    const a = el("a", "card");
    a.href = hrefOf(b);
    a.style.setProperty("--i", i);
    if (b.url) { a.target = "_blank"; a.rel = "noopener"; }

    const pv = el("div", "preview");
    if (b.image) {
      const img = el("img");
      img.src = b.image; img.alt = ""; img.loading = "lazy";
      pv.append(img);
    } else {
      const f = el("iframe");
      f.src = hrefOf(b);
      f.loading = "lazy";
      f.tabIndex = -1;
      f.title = b.title + " preview";
      f.setAttribute("aria-hidden", "true");
      pv.append(f);
      scaler.observe(pv);
    }
    pv.append(el("span", "open-chip", b.url ? "Open ↗" : "Open →"));
    a.append(pv);

    const info = el("div", "info");
    const top = el("div", "info-top");
    top.append(el("span", "", "#" + pad(b.n)), el("span", "", fmtDate(b.date)));
    info.append(top, el("h3", "", b.title));
    if (b.blurb) info.append(el("p", "", b.blurb));
    if (b.tags && b.tags.length) {
      const t = el("div", "tags");
      b.tags.forEach((tag) => t.append(el("span", "tag", tag)));
      info.append(t);
    }
    a.append(info);
    return a;
  }

  function slot(num, isNext, i) {
    const s = el("div", "slot" + (isNext ? " next" : ""));
    s.style.setProperty("--i", i);
    s.setAttribute("aria-hidden", "true");
    s.append(el("span", "slot-num", "#" + pad(num)));
    s.append(el("span", "slot-mark", isNext ? "→" : "+"));
    const bottom = el("div");
    bottom.append(
      el("div", "slot-label", isNext ? "Next build" : "Open slot"),
      el("div", "slot-sub", isNext ? "in the workshop" : "coming later")
    );
    s.append(bottom);
    return s;
  }

  function render(filter) {
    const grid = $("grid");
    grid.replaceChildren();
    const shown = builds.filter((b) => !filter || (b.tags || []).includes(filter));
    shown.forEach((b, i) => grid.append(card(b, i)));
    if (!filter) {
      const slots = Math.max(1, 3 - builds.length);
      for (let k = 0; k < slots; k++) grid.append(slot(builds.length + k + 1, k === 0, shown.length + k));
    }
  }

  // Tag filters appear once there are at least two different tags
  const tags = [...new Set(builds.flatMap((b) => b.tags || []))].sort();
  if (tags.length > 1) {
    const bar = $("filters");
    ["all", ...tags].forEach((t, i) => {
      const btn = el("button", "", t);
      btn.type = "button";
      btn.setAttribute("aria-pressed", String(i === 0));
      btn.onclick = () => {
        bar.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        render(i === 0 ? null : t);
      };
      bar.append(btn);
    });
  }

  render(null);
})();
