# Installing SplitTag on a marketing page

Paste these two lines into the page's `<head>`, **before** the stylesheet and
before any visible content:

```html
<script>window.SPLITTAG_CONFIG = {"experiments":[{"id":"exp-hero-cta","targetUrlPattern":"/","trafficAllocation":1,"variants":[{"id":"control","weight":1,"changes":[]}],"goals":[{"id":"cta-click","type":"click","selector":"#cta-primary"}]}]};</script>
<script src="/snippet.js"></script>
```

The first line is the experiment config. The second line is the snippet. Both
are classic synchronous scripts: do **not** add `async` or `defer`, and do not
move the snippet below the stylesheet or body content.

## Why inline config?

The snippet's job is to decide and mutate before first paint. An inlined config
makes the decision a pure local computation, so no request is on the critical
path. If `window.SPLITTAG_CONFIG` is absent, the snippet falls back to a
synchronous `GET /api/config`; that path works but costs a network round trip,
so it is a fallback rather than the recommended install.

## What the snippet does

1. Injects `html { visibility: hidden !important }` synchronously.
2. Reads or creates the `splittag_vid` cookie (1 year, `SameSite=Lax`) and
   mirrors it into `localStorage`.
3. Buckets the visitor with FNV-1a over `visitorId + ':' + experimentId`.
   A stored assignment in `localStorage.splittag_assign` always wins, so
   changing weights never reshuffles an existing visitor.
4. Applies the variant's text, HTML, style, class, hide, move, and attribute
   changes. Style/hide rules go into a scoped `<style>` tag.
5. Reveals the page after the changes are applied, with a 1000 ms safety timer
   that reveals the page even if config loading or a mutation throws.
6. Sends one exposure event per visitor per experiment per browser session,
   then batches goal events with `sendBeacon`.

## QA / preview mode

Force a variant without touching real results:

```
https://your-site.example/?splittag_force=exp-hero-cta:urgency
https://your-site.example/?splittag_force=exp-hero-cta:control
```

Force mode sets `window.SplitTag.preview = true`, skips writing the assignment,
and suppresses every event send, including exposures. The special variant id
`control` means the first variant in the config.

## Public API

```js
SplitTag.getAssignment('exp-hero-cta'); // "urgency" | "control" | null
SplitTag.getAssignments();              // { "exp-hero-cta": "urgency" }
SplitTag.track('cta-click', { source: 'nav' });
SplitTag.preview;                       // true in ?splittag_force mode
SplitTag.version;                       // "1.0.0"
```

`SplitTag.track()` is for conversions that happen outside the automatically
tracked click, form-submit, and scroll-depth goals (for example, a conversion
confirmed by your app after a fetch).

## Self-hosting reminder

Serve `snippet.js` with `Cache-Control: no-store` (the included Express server
does). The snippet is intentionally a classic script and has no build step.
