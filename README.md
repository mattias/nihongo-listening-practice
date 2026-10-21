# Nihongo Listening Practice

A small, mobile-first Japanese listening app that loads mature Anki cards, can filter them using known words from Jiten, and supports sentence-audio replay or browser speech synthesis.

## Use the published app

The app is published at **<https://mattias.github.io/nihongo-listening-practice/>**. When using this URL, add its exact origin to AnkiConnect's `webCorsOriginList`:

```json
{
  "webCorsOriginList": ["https://mattias.github.io"]
}
```

The origin is the scheme and host only; do not include the app path or trailing slash. Restart Anki after changing AnkiConnect's configuration. The app uses `http://127.0.0.1:8765` as its default AnkiConnect endpoint, which works when the browser and Anki are on the same computer.

To use the hosted app on a phone, set the AnkiConnect endpoint in Settings to the computer's LAN address, such as `http://192.168.1.50:8765`, and allow the hosted origin above in AnkiConnect. The phone and computer must be on the same network. Some browsers block requests from an HTTPS page to an HTTP LAN address as mixed content; if that happens, use a local HTTPS proxy or open a locally served copy of the app over HTTP instead.

## Run locally for development

Serve this folder from a local web server such as VS Code Live Server. Its origin is often `http://127.0.0.1:5500`; the exact origin shown in the browser address bar must be allowed separately in AnkiConnect:

```json
{
  "webCorsOriginList": ["http://127.0.0.1:5500"]
}
```

`localhost` and `127.0.0.1` are different origins.

## Publish with GitHub Pages

The repository's Pages workflow deploys this static app whenever a commit is pushed to `main`. The site is already configured to deploy from GitHub Actions.

## Settings

- Choose the matching Anki note type preset and check its field mappings.
- To filter by known words, import the `KnownWord.json` vocabulary export from Surasura in Settings. Only entries marked `KNOWN` are used. Jiten's API does not allow browser CORS requests, so the static GitHub Pages app cannot call it directly; the imported word list is stored in this browser.
- The app fetches 25 random mature cards at a time and requests another batch when five remain.
- Playback repeat, delay, and speed settings are saved in the browser.
- The app shell and imported known-word list can be cached for offline use; AnkiConnect still requires network access.
