# Nihongo Listening Practice

A small, mobile-first Japanese listening app that loads mature Anki cards, can filter them using known words from Jiten, and supports sentence-audio replay or browser speech synthesis.

## Run locally

Serve this folder from a local web server such as VS Code Live Server. For example, open `index.html` at `http://127.0.0.1:5500`.

The app connects to AnkiConnect at `http://127.0.0.1:8765` by default. In AnkiConnect's add-on configuration, allow the exact origin serving the app in `webCorsOriginList`, then restart Anki. For local development that may be:

```json
"webCorsOriginList": ["http://127.0.0.1:5500"]
```

`localhost` and `127.0.0.1` are different origins. For mobile use, enter the desktop computer's LAN address in the app settings and allow the app's origin in AnkiConnect.

## Publish with GitHub Pages

The repository's Pages workflow deploys this static app whenever a commit is pushed to `main`. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

When serving from GitHub Pages, add the deployed site origin (for example, `https://OWNER.github.io`) to AnkiConnect's `webCorsOriginList`. The browser still needs network access to the computer running Anki.

## Settings

- Choose the matching Anki note type preset and check its field mappings.
- Add a Jiten API key to filter to words with a known card state. The app uses Jiten's vocabulary cards API; states 5 and higher are treated as known.
- The app fetches 25 random mature cards at a time and requests another batch when five remain.
- Playback repeat, delay, and speed settings are saved in the browser.
- The app shell can be cached for offline use; Anki and Jiten integrations still require network access.
