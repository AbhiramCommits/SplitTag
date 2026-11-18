# SplitTag data schema

SplitTag stores two JSON arrays under `data/`: experiments and events. The
Express API validates every write before it reaches disk (`server/store.js`).

## Experiment

```json
{
  "id": "exp-hero-cta",
  "name": "Hero CTA urgency",
  "status": "running",
  "targetUrlPattern": "/",
  "trafficAllocation": 1,
  "variants": [
    { "id": "control", "name": "Control", "weight": 0.5, "changes": [] },
    { "id": "urgency", "name": "Urgency", "weight": 0.5, "changes": [] }
  ],
  "goals": [
    { "id": "cta-click", "name": "Primary CTA click", "type": "click", "selector": "#cta-primary" }
  ]
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `id` | string | 1–64 chars: letters, numbers, `-`, `_`. Unique. |
| `name` | string | Non-empty. |
| `status` | string | `draft`, `running`, or `stopped`. Only `running` experiments are delivered to the snippet. |
| `targetUrlPattern` | string | Non-empty. Matched against `location.pathname` as a substring, or as a glob when it contains `*`. `"/"` matches the site root only. |
| `trafficAllocation` | number | `0..1`. Share of eligible visitors admitted to the experiment. |
| `variants` | array | 1–20 items. First variant is the **control**. |
| `variants[].id` | string | 1–64 chars, unique inside the experiment. |
| `variants[].name` | string | Non-empty. |
| `variants[].weight` | number | `0..1`; weights must sum to `<= 1` and `> 0`. The snippet normalizes by the sum, so `0.5/0.5` and `1/1` both work. |
| `variants[].changes` | array | Mutation objects, see below. |
| `goals` | array | May be empty. |
| `goals[].id` | string | Unique inside the experiment. |
| `goals[].name` | string | Non-empty. |
| `goals[].type` | string | `click`, `form_submit`, or `scroll_depth`. |
| `goals[].selector` | string | Required for `click` and `form_submit`. |
| `goals[].threshold` | number | Required for `scroll_depth`; `1..100` percent. |

### Changes (mutations)

All changes require `selector` (a CSS selector).

| `type` | Extra fields | Meaning |
| --- | --- | --- |
| `text` | `value: string` | Replace `textContent`. |
| `html` | `value: string` | Replace `innerHTML`. |
| `style` | `props: { [cssProperty]: string \| number }` | Injected as a scoped stylesheet rule. |
| `class` | `add?: string[]`, `remove?: string[]` | Add/remove class names; at least one must be present. |
| `hide` | — | Hides the element (`display: none`). |
| `move` | `beforeSelector?: string`, `afterSelector?: string` (exactly one) | Re-inserts the element relative to another. |
| `attr` | `name: string`, `value: string` | Sets an attribute. |

## Event

```json
{
  "type": "goal",
  "visitorId": "vid_8f1c…",
  "experimentId": "exp-hero-cta",
  "variantId": "urgency",
  "goalId": "cta-click",
  "timestamp": 1763500000000,
  "url": "http://localhost:4000/",
  "meta": { "scrollDepth": 75 }
}
```

| Field | Type | Rules |
| --- | --- | --- |
| `type` | string | `exposure` or `goal`. |
| `visitorId` | string | Non-empty, max 128 chars. |
| `experimentId` | string | Non-empty. |
| `variantId` | string | Non-empty. |
| `goalId` | string | Required when `type` is `goal`. |
| `timestamp` | number | Finite Unix milliseconds (client clock). |
| `url` | string | Optional. |
| `meta` | object | Optional. |

The server adds `id` (UUID) and `receivedAt` (server milliseconds). Clients may
POST one event object or an array of up to 1000. A malformed object rejects the
whole batch with HTTP 400 and an `{ "error": "…" }` message, so a bad event can
never be partially persisted.

## Derived results are not stored

Exposures and conversions are computed from the event log on request. Unique
visitors are counted by `visitorId`; a visitor converting the same goal twice
counts once. That makes the event log append-only and auditable.
