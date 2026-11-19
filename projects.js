// ─────────────────────────────────────────────────────────────
//  This file runs the homepage. Edit it to change your info or
//  add a build.
//
//  Each build lives in its own folder:  projects/<slug>/index.html
//  Then add an entry to BUILDS below. Oldest first: the order here
//  sets the build numbers (#001, #002, ...). The page shows newest first.
// ─────────────────────────────────────────────────────────────

const SITE = {
  handle: "claasic",
  name: "Marc Marrone",
  tagline: " makes things: apps, games, tools and experiments. Everything here runs in your browser, so click one and try it.",
  status: "Currently building",
  since: "2026",
  about: "This is my workshop: a running log of everything I build. Some of it is useful, some of it is just for fun, and all of it opens right here with nothing to install.",
  links: [
    { label: "GitHub", url: "https://github.com/marcjmarrone-glitch" },
    // { label: "Email", url: "mailto:you@example.com" },
  ],
};

const BUILDS = [
  {
    slug: "cs2-review",
    title: "CS2 Round Review",
    blurb: "Drop in a FACEIT demo and replay every round on a 2D map with a live win-probability line. Your costliest deaths get found and ranked.",
    tags: ["cs2", "tool"],
    date: "2026-11",
  },
  // {
  //   slug: "my-first-build",           // folder name: projects/my-first-build/
  //   title: "My First Build",
  //   blurb: "One or two sentences on what it is and why it's fun.",
  //   tags: ["game"],
  //   date: "2026-11",
  //   // image: "projects/my-first-build/cover.png",  // optional; otherwise a live preview is shown
  //   // url: "https://...",                          // optional; use instead of slug for things hosted elsewhere
  // },
];
