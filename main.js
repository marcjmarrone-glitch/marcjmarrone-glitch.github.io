// Renders the page from projects.js — you shouldn't need to edit this.
(function () {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  };

  // Header
  $("site-name").textContent = SITE.name;
  $("site-tagline").textContent = SITE.tagline;
  document.title = SITE.name + " · Projects";
  SITE.links.forEach((l) => {
    const a = el("a", "", l.label);
    a.href = l.url;
    if (!l.url.startsWith("mailto:")) { a.target = "_blank"; a.rel = "noopener"; }
    $("site-links").append(a);
  });
  $("year").textContent = "© " + new Date().getFullYear() + " " + SITE.name;

  // Newest first
  const projects = [...PROJECTS].sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  function card(p) {
    const c = el("article", "card");
    if (p.image) {
      const img = el("img");
      img.src = p.image;
      img.alt = p.title + " screenshot";
      img.loading = "lazy";
      c.append(img);
    } else {
      c.append(el("div", "thumb", p.emoji || "✨"));
    }
    const body = el("div", "card-body");
    body.append(el("h3", "", p.title));
    if (p.date) body.append(el("span", "meta", p.date));
    if (p.description) body.append(el("p", "", p.description));
    if (p.tags && p.tags.length) {
      const t = el("div", "tags");
      p.tags.forEach((tag) => t.append(el("span", "tag", tag)));
      body.append(t);
    }
    const links = el("div", "card-links");
    [["Live demo →", p.demo], ["Code", p.code]].forEach(([label, url]) => {
      if (!url) return;
      const a = el("a", "", label);
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      links.append(a);
    });
    if (links.children.length) body.append(links);
    c.append(body);
    return c;
  }

  function render(filter) {
    const grid = $("projects");
    grid.replaceChildren();
    const shown = projects.filter((p) => !filter || (p.tags || []).includes(filter));
    shown.forEach((p) => grid.append(card(p)));
    $("empty").hidden = shown.length > 0;
  }

  // Tag filters (only shown when there are 2+ tags)
  const tags = [...new Set(projects.flatMap((p) => p.tags || []))].sort();
  if (tags.length > 1) {
    const bar = $("filters");
    ["All", ...tags].forEach((t, i) => {
      const b = el("button", "", t);
      b.type = "button";
      b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
      b.onclick = () => {
        bar.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", "false"));
        b.setAttribute("aria-pressed", "true");
        render(i === 0 ? null : t);
      };
      bar.append(b);
    });
  }

  render(null);
})();
