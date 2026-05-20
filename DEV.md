# Implementation details

The goal is to build a tool with basic js and CSS for modern browsers. No
bloated JS frameworks.

- view layer is [Alpine.js](https://alpinejs.dev) (vendored under
  `src/assets/`). A single `x-data="app()"` factory on `<body>` owns the
  reactive state; `<template x-for>` renders the feed list and entry
  list directly in `index.html`. The drag resizer lives in its own small
  `resizer()` factory.
- Miniflux entry bodies contain HTML, which we render inside a sandboxed
  `<iframe sandbox="allow-same-origin">` for isolation. The iframe is
  mounted imperatively (Alpine doesn't help with iframe content windows)
  and resized to its content height via a `ResizeObserver`.
- no build tool, just vanilla html, js and css.
- uses the Miniflux native API: https://miniflux.app/docs/api.html

## UI

Two-panel layout:

- **left panel**: feed list. The `Feeds` header and the `Sign out` button
  stay pinned at the top while the list scrolls below. Each row is
  `favicon · title · unread count`; rows with zero unread are grayed out;
  the active feed gets a left accent stripe. The vertical divider between
  the two panels is draggable and the width persists.
- **right panel**: entry list. A toolbar at the top stays pinned and
  carries: feed name on the left, then `Mark all read` (whole feed, via
  Miniflux's `PUT /v1/feeds/{id}/mark-all-as-read`), `Mark all unread`
  (loaded entries only — no equivalent server endpoint exists), and
  `Unsubscribe` for the active feed. Once
  unsubscribed, the same slot shows a `Subscribe` button that re-creates
  the feed from the cached URL + category to revert the action; selecting
  a different feed dismisses the undo. Below the toolbar, one row per
  entry showing `title · date · ● unread / ○ read` (date is `now` within a minute, `today`, `yesterday`, `N days` up to 30, then `YYYY-MM-DD`).
  Read rows are muted; click the dot to toggle status without expanding.
  Entries load 25 at a time; scrolling near the bottom of the panel
  fetches the next page (`?offset=` + `?limit=`) and appends until
  `entries.length` reaches the feed's `total`.
- **expanded entry**: only one entry can be open at a time (clicking a
  new one closes the previous). The open entry's summary pins to the top
  of the reader pane via `position: sticky` so it's always one click away
  from collapse. The article body renders in a lazy-mounted iframe that
  auto-sizes — no inner scrollbar, the right panel scrolls. Inside the
  open body, a `Fetch full content` button calls Miniflux's
  `/v1/entries/{id}/fetch-content?update_content=true` to scrape the
  original page; the iframe's `srcdoc` is updated in place.
- expanding an unread row also marks it read (optimistic + counter sync).

## Keyboard shortcuts

A single `keydown` listener at window level dispatches by `event.key`.
Modifiers and focused form elements are filtered out at the listener.

A future iteration can inject a forwarder into the iframe `srcdoc` to
bubble keys back to the parent so shortcuts work while focus is inside
an article.

## Reactive state shape

A single Alpine store on `<body>`:

| field | purpose |
|---|---|
| `authed` | drives `x-show` between `#login` and `#app`; initialised from `localStorage` to avoid a flash of the login form on reload |
| `feeds` | array of feed objects; rendered via `x-for` |
| `counts` | `{feedId: unread}`; single source of truth for the unread number and `.zero` gray-out class |
| `iconsById` | `{iconId: data-url-payload}`; persisted via localStorage; drives the favicon `<img src>` |
| `activeFeedId` | which feed's entries are loaded |
| `entries` | array of entry objects (paginated, appended on scroll); rendered via `x-for` |
| `entriesTotal` | server's reported total for the active feed; drives the `hasMoreEntries` getter for infinite scroll |
| `entriesLoading` | in-flight lock for `loadMoreEntries`, prevents double-fetch from rapid scroll events |
| `expandedEntryId` | the single open entry, drives `:open` on each `<details>` |
| `deletedFeed` | snapshot `{feed_url, title, category_id}` of a just-unsubscribed feed; non-null while a one-step undo is offered |
| `feedsWidth` | resizer width; written by `resizer().onEnd`, persisted to localStorage |

Mutations are optimistic: status toggles, mark-all, and counter
adjustments all update reactive state first, then issue the API call,
and revert on failure.

## Feed list composition

The left panel is built from three Miniflux endpoints loaded lazily so
the list renders as soon as the first one returns:

- `GET /v1/feeds` — titles and icon references; populates `feeds`
  immediately so the skeleton appears.
- `GET /v1/feeds/counters` — per-feed unread counts; fills `counts`
  reactively, which updates every row's number and `.zero` class in
  place.
- `GET /v1/icons/{id}` — one request per unique icon (fanned out in
  parallel); cached results from previous sessions appear instantly,
  newly-fetched ones merge into `iconsById` and trigger an in-place
  `<img>` src update.

## Styling

- [modern-normalize](https://github.com/sindresorhus/modern-normalize)
  vendored locally at `src/assets/modern-normalize.css` as the CSS reset.
- a small custom stylesheet on top — no framework.
- UI uses the system sans-serif font stack; article bodies use the
  system serif stack (`ui-serif, Georgia, ...`) for a reader-mode feel.
  Both stacks include native CJK families ordered Chinese > Japanese >
  Korean (`PingFang SC` / `Hiragino Sans GB` for sans, `Songti SC` /
  `STSong` for serif, then JP / KR fallbacks), so Han glyphs render
  with the Chinese variant on macOS.
- single parchment/sepia palette (cream background, warm dark brown
  text), used everywhere — no dark mode in v1.
- article column fills the right panel (no max-width cap in v1).
- compact-ish density in the feed/item lists, roomier line-height in
  the article body.
- the entry-list toolbar and the feeds-panel header both sit outside
  their scrolling containers (the panels are flex columns with the
  scrollable region tucked inside) so they stay put. The open entry's
  summary uses `position: sticky; top: 0` inside the inner scroll
  container so it pins right below the toolbar.
- scrollbars are hidden everywhere — `scrollbar-width: none` plus a
  `::-webkit-scrollbar { display: none }` rule on `.feeds-scroll` /
  `.entry-scroll`, and the same pair injected into the article iframe's
  inline `<style>`. Wheel, trackpad, and keyboard scrolling all still
  work.

## Future plans

### Per-entry CJK language detection

Miniflux's feed and entry models don't expose a `language` field, so we
currently rely on browser per-glyph fallback through the font stack.
That works for the dominant language but draws Han characters with
whichever CJK font appears first in the stack — wrong when a Japanese
feed sits in a Chinese-first stack (e.g. 直 / 骨 / 様 have different
glyph conventions per region).

The plan is to detect the script client-side on the first ~200 chars of
each title/body and tag the DOM with `lang`:

- Hangul (U+AC00–D7AF) present → `lang="ko"`
- Hiragana / Katakana (U+3040–30FF) present → `lang="ja"`
- Han (U+4E00–9FFF) present, no Hangul/Kana → `lang="zh"`
- otherwise no `lang` attribute, default stack applies

`lang` goes on each entry `<li>` (so the title in the list uses the
right font) and on the iframe `<html>` element (so the article body
does too). CSS uses `:lang(zh|ja|ko)` selectors to swap to per-language
font stacks.

Skipped for now because the per-glyph fallback already looks "okay
enough" on a Chinese-dominant set of feeds.
