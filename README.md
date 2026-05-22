
# Ridge

A classic looking web UI for reading RSS feeds, inspired by Google Reader.
Talks to a Miniflux server and runs without a backend.

Built with AI.

See [DEV.md](DEV.md) for implementation details.

## Features

- reading: render feeds and entries, expand to view article body.
- read/unread state: mark-as-read on expand, status indicator click to
  toggle, bulk `Mark all read` (whole feed via the dedicated Miniflux
  endpoint), bulk `Mark all unread` (loaded entries only).
- full-content fetch: per-entry button calls Miniflux's
  `fetch-content?update_content=true` endpoint and updates the iframe in
  place (also persists on the server side).
- subscribe / unsubscribe: per-feed `Unsubscribe` button with a confirm
  prompt; on success the button slot is replaced by `Subscribe`, which
  re-creates the feed from the cached `feed_url` + `category_id` to undo
  in one click. Selecting another feed dismisses the undo.

## Keyboard shortcuts

Modifiers `Ctrl` / `Cmd` / `Alt` and focus inside `<input>` /
`<textarea>` / `<select>` suppress the shortcut so it doesn't clash with
browser hotkeys or the login form.

| Key | Action |
|---|---|
| `j` | Open the next entry. If nothing is open, opens the first. No-op at the end of the loaded list (does not trigger `loadMoreEntries`). |
| `k` | Open the previous entry. No-op if the first entry is already open or nothing is open. |
| `Shift+A` | Mark the entire active feed as read (whole feed, same endpoint as the toolbar button). |
| `Shift+G` | Fetch full content for the currently open entry (same as the `Fetch full content` button). No-op if nothing is open. |

Caveat: when focus is inside an article iframe (e.g. you selected text
to copy), keypresses go to the iframe document and the window listener
doesn't fire — click outside the article first.

## Deployment

The app is served as static files from the same origin as the Miniflux
server, mounted at `/ui/` (e.g. `https://miniflux.example.org/ui/`). The
Miniflux API is therefore reached via the relative path `/v1/`, which
sidesteps CORS entirely.

## Deploy

1. Run `scripts/fetch-assets.sh` to download the vendored Alpine.js and
   modern-normalize files into `src/assets/` (versions are pinned at the
   top of the script).
2. Copy `src/` to the host that fronts your Miniflux server, e.g.
   `/var/www/ridge/`.
3. Point your reverse proxy at it: serve `/var/www/ridge/` under `/ui/`,
   and proxy everything else to the Miniflux backend on the same
   hostname.
4. Visit `https://<your-miniflux-host>/ui/` and sign in with your
   Miniflux username and password.

Caddy example:

```
miniflux.example.org {
    handle_path /ui/* {
        root * /var/www/ridge/src
        file_server
    }
    reverse_proxy localhost:8080
}
```

nginx example:

```
location /ui/ {
    alias /var/www/ridge/src/;
}
location / {
    proxy_pass http://localhost:8080;
}
```

No build step — updates are a file copy.

### Hosting on a different domain

The same-origin layout above is the simplest, but Ridge can also run on a
separate host from Miniflux (e.g. `https://reader.example.com/` talking to
`https://miniflux.example.org/`). Miniflux's API ships permissive CORS
headers by default (`Access-Control-Allow-Origin: *`, `Authorization` in
`Access-Control-Allow-Headers`), and Ridge authenticates with HTTP Basic,
so cross-origin calls work without cookies.

To enable it:

1. Edit `API_BASE` at the top of `src/app.js` from `'/v1'` to the absolute
   Miniflux API URL, e.g. `'https://miniflux.example.org/v1'`.
2. Serve Ridge over HTTPS if Miniflux is on HTTPS — browsers block mixed
   content.
3. Make sure no reverse proxy in front of Miniflux strips the CORS
   response headers; if it does, the first API call fails with an opaque
   CORS error in the browser console.

## Credentials & session

- the user types their Miniflux username and password at startup; we send
  HTTP Basic Auth (`Authorization: Basic <base64(user:password)>`) on
  every request.
- the encoded credential lives in `localStorage` so it survives reloads
  and browser restarts; sign out clears it.
- favicons are cached in `localStorage` keyed by Miniflux `icon_id` so we
  skip the per-icon round-trip on subsequent loads. Miniflux re-keys the
  ID when an icon's content changes, so the cache never goes stale; sign
  out clears it.
- the feeds-panel width is remembered in `localStorage` (drag the divider
  between the two panels to resize).
- nothing else is cached locally — feed list, counts, and entries come
  fresh from the server each session, relying on standard HTTP cache
  headers.
