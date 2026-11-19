# My Projects Homepage

A simple, fast portfolio site hosted for free on GitHub Pages.

## Files

| File | What it is |
|---|---|
| `projects.js` | **The only file you normally edit.** Your name, links, and project list. |
| `index.html` | Page structure |
| `style.css` | Look and feel (light and dark mode follow your system setting) |
| `main.js` | Builds the page from `projects.js` |

## Publish it (one-time setup)

1. Sign in at https://github.com and create a **new repository** named exactly
   `marcjmarrone-glitch.github.io`. Make it **Public**.
2. Upload these files: on the new repo's page, click **"uploading an existing file"**,
   drag in `index.html`, `style.css`, `main.js`, `projects.js`, `README.md`, then **Commit changes**.
3. Go to **Settings → Pages**. Under "Build and deployment", set Source to
   **Deploy from a branch**, Branch to **main** / **(root)**, and click Save.
4. After a minute or two your site is live at `https://marcjmarrone-glitch.github.io`.

Or with git from a terminal:

```bash
git init
git add .
git commit -m "First version of my homepage"
git branch -M main
git remote add origin https://github.com/marcjmarrone-glitch/marcjmarrone-glitch.github.io.git
git push -u origin main
```

## Add a project

Open `projects.js`, copy a `{ ... }` block inside `PROJECTS`, and fill in the
title, description, tags, date, and links. Commit the change and the site updates
itself within a minute or two.

For a screenshot, add an `images/` folder, put the image there, and set
`image: "images/your-file.png"` on the project.

## Preview locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000.
