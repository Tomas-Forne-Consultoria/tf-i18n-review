# i18n Review (Chrome extension)

Review and edit an app's translations next to the UI that shows them. A side
panel lists every translated string on the page you have open, in reading
order, with all languages editable inline. Hover a row and the element lights
up on the page; hover the page and its row lights up in the panel.

- **Edit** any language inline. The page shows plain-text edits live.
  **Save to files** writes them into your translation files, changing only
  the edited lines and keeping each file's indentation.
- **Done** marks a string as reviewed, with a timestamp, and folds the row.
  The extension keeps every language's text as it was at that moment. If any
  of it changes later (a save, a `git pull`, someone else's edit), the row
  reopens in amber as **Changed — review**, showing the old text crossed out.
  Ticking it again accepts the new text.
- **Viewed** is set automatically once you have looked at a string in
  context (hovered it, or clicked into it).
- **Filters**: All, Not done, Not viewed, Changed since done, Done, and
  Issues (missing text, text identical to the base language, `{placeholders}`
  that don't match the base language). **Show on page** outlines every
  string in its review colour.

Unsaved edits and review marks live in the extension's IndexedDB, keyed by
translations folder. They survive closing the panel or the browser, and every
site that uses the same folder shares them.

## Install

```sh
pnpm install
pnpm build                 # or pnpm watch while working on it
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick this repo's `dist/` folder.
2. Pin **i18n Review**. Clicking its icon opens the side panel.

Works in Chromium browsers (Chrome, Edge, Arc, Brave). It runs on `localhost`
and `127.0.0.1` out of the box. On any other site the panel offers **Enable
on this site**, which asks Chrome for access to that site only.

## Add markers to an app

The [`i18n-review-markers`](skills/i18n-review-markers/SKILL.md) skill walks
an agent through it: copy `src/protocol.ts`, wrap the app's catalogue loader
behind an `I18N_INSPECT` flag, add a `dev:i18n` script and a regression test.
To make it available in every project on a machine:

```sh
ln -s "$PWD/skills/i18n-review-markers" ~/.claude/skills/i18n-review-markers
```

## Use it on Regest

In the Regest repo:

```sh
pnpm dev:i18n              # next dev with every message tagged with its key
```

Open the app, open the panel, choose Regest's `src/locales` once. Chrome asks
to confirm folder access once per browser session.

## How strings are linked to the page

**Markers (exact).** In development the app appends an invisible marker to
every translated message. The marker spells out the message key in Unicode
tag characters, which browsers don't render. The page script reads the keys
straight from the DOM, so every string, attribute (`placeholder`, `title`,
`aria-label`, `alt`) and rich-text message is linked to its exact key. The
format is in [`src/protocol.ts`](src/protocol.ts), which has no dependencies.
This file is the source of truth: apps copy it (Regest keeps a copy in
`src/lib/i18n-review-markers.ts`) and call `markMessages(messages)` where
they load their catalogue, in development only. Change the format here
first, then update the copies.

```ts
// next-intl (Regest: i18n/request.ts)
messages: inspect ? markMessages(messages) : messages,

// i18next
i18next.init({ resources: inspect ? markResources(resources) : resources });
// where markResources maps each language's namespaces through markMessages

// react-intl / FormatJS (flat catalogues work as-is)
<IntlProvider messages={inspect ? markMessages(messages) : messages} />
```

Keep it behind a flag (Regest uses `I18N_INSPECT=1`). Tests that match exact
text would otherwise see the invisible characters.

**Text matching (any app, no changes).** When a page has no markers, the
extension looks up each piece of text on the page in the catalogue of the
page's language (`<html lang>`). The panel labels this "matched by text".
Text that appears under several keys is listed with the other candidates.
Messages with variables, plurals or markup can't be matched this way.

## Translation files

Choose the folder holding one `<locale>.json` per language
(`ca.json`, `es.json`…). Nested objects and arrays are supported; keys are
dot paths (`Landing.faq.items.0.q`), the same paths the markers carry. The
panel polls the folder, so outside changes show up within a couple of
seconds.

## Layout

| File | Role |
|---|---|
| `src/protocol.ts` | Marker format, shared with the app |
| `src/content.ts` | Page script: finds strings, highlights, live previews |
| `src/panel/` | Side panel (React): folder, edits, review marks, list |
| `src/messages.ts` | Messages between panel and page script |
| `static/` | Manifest, panel HTML/CSS |
| `build.mjs` | esbuild bundle into `dist/` |
| `test/fixtures/locales/` | A small three-language catalogue for the tests |
| `e2e/run.ts` | Drives the built extension in Chromium against a fixture app |
| `skills/i18n-review-markers/` | Agent skill that adds the markers to an app |

## Development

```sh
pnpm check                 # typecheck, unit tests, build
pnpm test:e2e              # build, then the browser test (screenshots in test-results/)
```

The browser test needs Playwright's Chromium once:
`pnpm exec playwright install chromium`. It serves a fixture app on
ports 4317 (with markers) and 4318 (without), and stands in for Chrome's
folder picker with a real browser-private folder seeded from the fixtures.
It doesn't cover the real folder picker or the site-permission prompt.
