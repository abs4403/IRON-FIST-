# IRONFIST

A static website for a gym + yoga studio, with a built-in calorie calculator
and daily food log. Plain HTML/CSS/JS — no build step, no server, no
dependencies to install. Works as-is on **GitHub Pages**.

## Files

```
index.html        Home page
gym.html          Gym programs and weekly split
yoga.html         Yoga styles and a sample flow
calculator.html   Calorie calculator + food log
style.css         Shared styling for every page
script.js         Shared behaviour (mobile menu)
calculator.js     Calculator + food log logic (uses localStorage)
```

## Run it locally (optional, to preview before uploading)

You don't need this step to deploy, but if you want to preview it first:

- **Easiest:** just double-click `index.html` to open it in a browser.
- **Or**, from a terminal in this folder: `python3 -m http.server 8000`,
  then visit `http://localhost:8000`.

## Deploy on GitHub Pages

1. Create a new repository on GitHub (e.g. `ironfist`).
2. Upload all the files in this folder to the repository, keeping them at
   the **root** of the repo (not inside a subfolder) — `index.html` should
   sit next to `style.css`, `script.js`, etc.
   - Easiest way: on the repo page, click **Add file → Upload files**, drag
     in every file from this folder, and commit.
3. Go to the repo's **Settings → Pages**.
4. Under **Build and deployment → Source**, choose **Deploy from a branch**.
5. Under **Branch**, choose `main` (or `master`) and folder `/ (root)`, then
   **Save**.
6. Wait about a minute, then refresh the Pages settings page — it will show
   your live URL, something like:
   `https://YOUR-USERNAME.github.io/ironfist/`

That's it — no build tools, no `npm install`, nothing else to configure.

## Notes

- The calorie calculator and food log store data with the browser's
  `localStorage`, on the visitor's own device only. Nothing is sent to a
  server, so there's no backend to host or pay for.
- The food log resets automatically each new calendar day (each day's
  entries are stored under their own date), but your calculated calorie
  target is remembered until you recalculate it.
- All pages are responsive and use a shared `style.css`/`script.js`, so if
  you want to change the color palette or fonts, you only need to edit
  `style.css` in one place.
- Fonts (Anton, Work Sans) load from Google Fonts over `https://` — this
  requires the site's visitors to have normal internet access, which they
  will on GitHub Pages. No local font files needed.
