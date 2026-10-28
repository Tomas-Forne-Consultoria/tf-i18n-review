---
name: i18n-review-markers
description: Adds i18n Review key markers to an app so the i18n Review Chrome extension maps every translated string to its exact key. Use when setting up translation review in a project, wiring a `dev:i18n` script, or updating an app's copy of the marker format.
---

# Add i18n Review markers to an app

The [i18n Review extension](https://github.com/Tomas-Forne-Consultoria/i18n-review) maps the strings on a page to their message keys. An app makes that exact by appending an invisible **marker** to every message while it runs in **inspect mode**. This skill adds inspect mode to an app. Regest did it in [tf-bopa-chat#632](https://github.com/Tomas-Forne-Consultoria/tf-bopa-chat/pull/632), the worked example for every step below.

The change touches three things:

1. A copy of the marker format.
2. The **loader**: the one place the message catalogue enters the runtime.
3. A `dev:i18n` script that turns inspect mode on.

Production behaviour stays byte-identical.

## 1. Find the loader and the catalogue

Read the app's i18n setup and find:

- **The library:** next-intl, i18next, react-intl/FormatJS, vue-i18n…
- **The loader:** the single function or config that hands messages to the library. For next-intl it is `getRequestConfig` in `i18n/request.ts`; for i18next, the `resources` passed to `init` or a backend's load callback; for react-intl, the `messages` prop of `IntlProvider`.
- **Where the loader runs:** on the server, in the browser, or both. This decides how the inspect flag reaches it (step 3).
- **The catalogue layout:** the extension edits one folder holding one `<locale>.json` per language, with keys as dot paths into nested objects (arrays by index: `faq.items.0.q`).

Done when you can name the loader's file and function, where it runs, and the catalogue folder.

Tell the user before continuing when either of these holds, because the extension can still highlight strings but cannot save into that layout:

- The layout differs, for example `locales/<lng>/<namespace>.json` or a flat `"a.b": "…"` file split per feature.
- The message paths the library sees differ from the file's dot paths, for example an i18next namespace prefix.

## 2. Copy the marker format

`src/protocol.ts` in the extension repo is the source of truth. The repo is private, so apps keep a copy rather than installing it:

```sh
gh api repos/Tomas-Forne-Consultoria/i18n-review/contents/src/protocol.ts \
  -H "Accept: application/vnd.github.raw" > <app lib dir>/i18n-review-markers.ts
```

Put it beside the app's other shared helpers (Regest: `src/lib/i18n-review-markers.ts`). Prepend a header naming the source of truth:

```ts
/**
 * Key markers for the i18n Review Chrome extension. COPY of src/protocol.ts
 * in https://github.com/Tomas-Forne-Consultoria/i18n-review, which is the
 * source of truth: change the format there first, then update this copy.
 */
```

When the app already has a copy, refresh it the same way and keep its header.

Done when the copy's body matches the repo's `src/protocol.ts` exactly. Check by diffing from the first `const START` line to the end.

## 3. Wrap the loader in inspect mode

Gate on an explicit flag and never on production:

```ts
import { markMessages } from "<app alias>/i18n-review-markers";

// `pnpm dev:i18n` tags every message with its key for the translation
// review extension (github.com/Tomas-Forne-Consultoria/i18n-review).
// Never in production builds.
const inspect =
  process.env.I18N_INSPECT === "1" && process.env.NODE_ENV !== "production";

// …where the loader hands messages to the library:
messages: inspect ? markMessages(messages) : messages,
```

- **Server-side loader** (next-intl, SSR): `process.env.I18N_INSPECT` works as written.
- **Browser loader:** read the flag the way the bundler exposes env to the client, e.g. `import.meta.env.VITE_I18N_INSPECT` (Vite) or `NEXT_PUBLIC_I18N_INSPECT` (Next client). Name the variable accordingly in step 4.
- **Several catalogues** (i18next namespaces, one object per locale): wrap each one so every leaf's marker carries the dot path from its file root.

Done when the flag-off path returns the very same messages object as before the change, and the flag-on path marks every catalogue the loader hands over.

## 4. Add the dev script

Copy the app's existing dev command and prefix the flag:

```json
"dev:i18n": "I18N_INSPECT=1 next dev"
```

Use the package manager and dev command the project already has. Keep `dev` itself unchanged: markers in plain `dev` would break tests and tools that match exact text.

## 5. Add the regression test

In the app's unit-test runner, check that every message in every locale file comes back tagged with its own key and strips back to its original text. Regest's version, `src/lib/__tests__/i18n-review-markers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import ca from "~/locales/ca.json";
import en from "~/locales/en.json";
import { decodeKey, markMessages, MARKER_RE, stripMarkers } from "../i18n-review-markers";

function leaves(node: unknown, path = ""): [string, string][] {
  if (typeof node === "string") return [[path, node]];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${path}.${i}`));
  if (node && typeof node === "object")
    return Object.entries(node).flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  return [];
}

describe("i18n Review key markers (dev:i18n)", () => {
  it.each([["ca", ca], ["en", en]])("tag every %s message with its own key", (_, messages) => {
    const original = leaves(messages);
    const marked = leaves(markMessages(messages));
    expect(marked.map(([k]) => k)).toEqual(original.map(([k]) => k));
    marked.forEach(([key, value], i) => {
      expect([...value.matchAll(MARKER_RE)].map((m) => decodeKey(m[1]!))).toEqual([key]);
      expect(stripMarkers(value)).toBe(original[i]![1]);
    });
  });
});
```

List every locale file the app ships.

Done when the test passes for every locale.

## 6. Verify in the running app

1. Start `dev:i18n` and fetch a page that shows translated text.
2. Decode its markers:

   ```sh
   curl -s http://localhost:<port>/<page> | python3 -c "
   import sys,re; s=sys.stdin.read()
   m=re.findall('\U000E0001([\U000E0020-\U000E007E]+)\U000E007F', s)
   print(len(m), [''.join(chr(ord(c)-0xE0000) for c in x) for x in m[:5]])"
   ```

   For a browser-only app the HTML may hold no text, so read `document.body.innerText` in a browser instead.
3. Stop the server.
4. Run the project's full test and lint gate with the flag unset.

Done when the page yields markers that decode to real keys and the gate is green.

While the server runs, look for strings the app uses as data rather than display, such as URLs, ids, values it splits or compares, or keys for lookups. Markers change those values in inspect mode only. Report any you find to the user; leave them unless they break the page.

## 7. Deliver

Ship it through the project's normal PR flow. In the description, say:

- what inspect mode does;
- that the copy's source of truth is the extension repo;
- that production is untouched;
- how to try it: build the extension, load `dist/` unpacked, run `dev:i18n`, open the panel and pick the locale folder.
