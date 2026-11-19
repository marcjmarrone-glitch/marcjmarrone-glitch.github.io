# claasic

Marc Marrone's workshop: everything we build, in one place, ready to open in the browser.

Live at **https://marcjmarrone-glitch.github.io**

## How it's organized

```
index.html, style.css, main.js   the homepage (no need to edit)
projects.js                      your info + the list of builds  ← edit this
back.js                          "← claasic" button for build pages
projects/<slug>/index.html       each build lives in its own folder
```

## Adding a build

1. Put the build in `projects/<slug>/` with an `index.html` entry point.
   Add `<script src="../../back.js" defer></script>` so visitors can get back home.
2. Add an entry at the **end** of `BUILDS` in `projects.js` (slug, title, blurb, tags, date).
   The homepage card shows a live preview of the build automatically; set `image` to use a screenshot instead.
3. Commit and push. The site updates in about a minute.

## Preview locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000.
