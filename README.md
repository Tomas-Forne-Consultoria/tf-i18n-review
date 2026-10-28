# i18n Review (Chrome extension)

Review and edit any app's translations next to the UI that shows them. A side
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

It works with any web app whose translations live in one folder with one
`<locale>.json` per language. Setting up a project takes one skill run (or a
few lines by hand); without setup, the extension still finds most strings by
their text.

## 1. Install the extension (once per browser)

```sh
git clone git@github.com:Tomas-Forne-Consultoria/i18n-review.git
cd i18n-review
pnpm install
pnpm build                 # or pnpm watch while working on it
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load
   unpacked** and pick this repo's `dist/` folder.
2. Pin **i18n Review**. Clicking its icon opens the side panel.

Works in Chromium browsers (Chrome, Edge, Arc, Brave). It runs on `localhost`
and `127.0.0.1` out of the box. On any other site the panel offers **Enable
on this site**, which asks Chrome for access to that site only.

After a `git pull` here, run `pnpm build` again and click the reload icon on
the extension's card in `chrome://extensions`.

## 2. Set up a project (once per project)

The setup makes the app tag every translated message with its key while it
runs in **inspect mode**, so the extension maps each string on the page to
its exact key. Production is untouched.

### With the skill (recommended)

The [`i18n-review-markers`](skills/i18n-review-markers/SKILL.md) skill does
the setup for an AI coding agent such as Claude Code. Make it available in
every project on your machine once:

```sh
ln -s "$PWD/skills/i18n-review-markers" ~/.claude/skills/i18n-review-markers
```

Then, in the project you want to set up, type `/i18n-review-markers`, or ask
the agent to "add the i18n Review markers to this app". The agent:

1. Finds where the app loads its translations: next-intl, i18next,
   react-intl/FormatJS, vue-i18n… It stops and asks if the translation files
   aren't one `<locale>.json` per language in one folder, because the
   extension can't save into other layouts.
2. Copies the marker format (`src/protocol.ts`) into the app with a
   "this is a copy" header.
3. Wraps the translation loader so it adds markers only when `I18N_INSPECT=1`
   is set, and never in production.
4. Adds a `dev:i18n` script next to the app's `dev` script.
5. Adds a test that every message in every language gets its own key and
   strips back to the original text.
6. Starts `dev:i18n`, checks that a real page carries markers, and runs the
   project's tests.
7. Opens a PR.

Run the same skill again in a project after the marker format changes here.
It refreshes the copy.

### By hand

1. Copy [`src/protocol.ts`](src/protocol.ts) into the app. It has no
   dependencies.
2. Where the app hands its messages to the i18n library, pass them through
   `markMessages()` behind a dev-only flag:

   ```ts
   const inspect =
     process.env.I18N_INSPECT === "1" && process.env.NODE_ENV !== "production";

   // next-intl (getRequestConfig)
   messages: inspect ? markMessages(messages) : messages,

   // i18next: pass each language's catalogue through markMessages
   i18next.init({ resources: inspect ? markResources(resources) : resources });

   // react-intl / FormatJS (flat catalogues work as-is)
   <IntlProvider messages={inspect ? markMessages(messages) : messages} />
   ```

   When the translations load in the browser, read the flag the way your
   bundler exposes env to the client (e.g. `import.meta.env.VITE_I18N_INSPECT`).
3. Add a script such as `"dev:i18n": "I18N_INSPECT=1 <your dev command>"`.
   Leave plain `dev` alone: tests that match exact text would see the
   invisible characters.

### Without setup

The extension also works on apps with no markers. It looks up each piece of
text on the page in the translations of the page's language (`<html lang>`),
and the panel labels the result "matched by text". Messages with variables,
plurals or markup can't be matched this way, and text used under several
keys is listed with the other candidates.

## 3. Review translations

1. Start the app with `dev:i18n` (or your normal dev server for a project
   without markers) and open it in the browser.
2. Click the extension icon. The first time on a site, choose the project's
   translations folder (e.g. `src/locales`). If the same folder is already
   set up on another site, such as another port, pick it from the list.
   Chrome asks to confirm folder access once per browser session.
3. Work through the list:
   - Hover rows to find the string on the page.
   - Edit any language inline.
   - Tick **Done** as you go.
   - Use **Not done** or **Changed since done** to see what's left.
4. Click **Save to files**, then commit the locale changes in the project as
   usual (`git diff` shows only the lines you edited).

Unsaved edits and review marks are kept in the extension, per translations
folder. They survive closing the panel or the browser, and every site that
uses the same folder shares them.

## How strings are linked to the page

The marker the app appends spells out the message key in Unicode tag
characters, which browsers don't render. The extension's page script reads
the keys straight from the DOM, so every string, attribute (`placeholder`,
`title`, `aria-label`, `alt`) and rich-text message is linked to its exact
key.

[`src/protocol.ts`](src/protocol.ts) is the source of truth for the format.
Projects keep a copy, because a private repo can't be installed as a
dependency without giving the host a token. Change the format here first,
then refresh each project's copy by running the skill there.

## Translation files

Choose the folder holding one `<locale>.json` per language
(`ca.json`, `es.json`…). Nested objects and arrays are supported; keys are
dot paths (`Landing.faq.items.0.q`), the same paths the markers carry. The
panel polls the folder, so outside changes show up within a couple of
seconds.

## Projects using it

| Project | Setup |
|---|---|
| Regest | [tf-bopa-chat#632](https://github.com/Tomas-Forne-Consultoria/tf-bopa-chat/pull/632): `pnpm dev:i18n`, copy in `src/lib/i18n-review-markers.ts`, folder `src/locales` |

Add a row when you set up another project.

## Layout

| File | Role |
|---|---|
| `src/protocol.ts` | Marker format, copied into each project |
| `src/content.ts` | Page script: finds strings, highlights, live previews |
| `src/panel/` | Side panel (React): folder, edits, review marks, list |
| `src/messages.ts` | Messages between panel and page script |
| `static/` | Manifest, panel HTML/CSS |
| `build.mjs` | esbuild bundle into `dist/` |
| `skills/i18n-review-markers/` | Agent skill that sets up a project |
| `test/fixtures/locales/` | A small three-language catalogue for the tests |
| `e2e/run.ts` | Drives the built extension in Chromium against a fixture app |

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
