# Training Log — Design Spec

**Date:** 2026-03-18
**Status:** Approved for implementation

---

## Overview

Add a simple, append-only training log to the MCP server. The log gives both the AI coach and the athlete a place to record qualitative observations, milestones, and context that structured Garmin/Hevy data cannot capture. It is explicitly a *complement* to the data sources — never a duplicate.

---

## Entry Shape

```ts
{
  id:        string    // uuid v4
  date:      string    // YYYY-MM-DD — the training date this entry relates to
  text:      string    // free-form note
  tags:      Tag[]     // optional — may be empty array; see standard tags below
  author:    "user" | "ai"  // informational only — not verified by the server
  createdAt: string    // ISO 8601 timestamp — when the entry was written
}
```

`tags` is optional. When omitted, it defaults to `[]`. An entry with zero tags is valid.

---

### Standard Tags

Tags are a fixed enum. New tags require a code change — this prevents tag proliferation.

| Tag | Use when... | NOT for... |
|---|---|---|
| `observation` | Use only when no more specific tag applies — it is the fallback, not the default. General session feel, effort perception. | Defaulting to it when another tag fits better |
| `milestone` | New PRs, notable firsts, significant achievements | Regular good sessions |
| `injury` | Localized pain or discomfort that could affect training continuity, structural issues | Systemic illness — use `illness` |
| `illness` | Systemic sickness: cold, flu, fever, stomach bug, infection affecting energy/immune system | Localized pain — use `injury` |
| `goal` | Setting, updating, or reflecting on a training target | Progress toward a goal — use `observation` |
| `recovery` | Subjective readiness to train, fatigue levels, whether athlete feels fresh or depleted | Sleep data — Garmin already captures that |
| `nutrition` | Fueling strategy, diet changes, hydration, pre/during/post-workout nutrition | General lifestyle — use `lifestyle` |
| `mental` | Internal psychological state: motivation, confidence, enjoyment, mental barriers | External stress — use `lifestyle` |
| `race` | Race day, pre-race strategy, post-race reflection, competition results | Hard training sessions that aren't races |
| `plan` | Training plan changes, periodization decisions, deload weeks, volume shifts | Daily adjustments — use `observation` |
| `lifestyle` | External factors: travel, jet lag, work stress, alcohol, poor sleep unrelated to training | Internal mental state — use `mental` |
| `technique` | Running form, lifting mechanics, coaching cues, movement patterns being worked on | General session notes — use `observation` |

**Key distinctions:**
- `injury` = localized physical pain → `illness` = systemic sickness
- `mental` = how you feel inside → `lifestyle` = what's happening outside
- `recovery` = subjective readiness signal → `observation` = general note

---

## Storage

- **Location:** Vercel Blob — `training-log.json` (same private blob store used for Garmin session)
- **Format:** JSON array of entries. On-disk order is oldest-first as a human-readability convention only — `get_log_entries` always re-sorts in memory before returning.
- **Cold start:** `readLog()` must handle a 404 from Vercel Blob gracefully — treat it as an empty log and return `[]`. The file is created on the first write.
- **Write strategy:** Read blob → append entry → re-upload (append-only, no edits or deletes via API)
- **Concurrent writes:** The read-modify-write cycle has no locking. For this single-user personal tool, this is an accepted known limitation. If the AI and user write simultaneously, one write may overwrite the other silently.
- **Manual edits:** User can edit the blob directly in Vercel dashboard if needed.

---

## MCP Tools

### `add_log_entry` (write)

Appends a new entry to the log.

**Input:**
```
date    string   required  YYYY-MM-DD — the training date this note relates to
text    string   required  Free-form note
tags    Tag[]    optional  One or more standard tags from the enum. Defaults to [].
author  enum     optional  "user" (default) | "ai" — informational only, not verified
```

**Output:** The created entry object (with generated `id` and `createdAt`).

**Errors:**
- No/invalid token → HTTP 401, no entry written
- Blob write failure → tool error response with human-readable message; no partial entry is appended

**Auth:** Protected by existing `?token=` check — no token, no write.

---

### `get_log_entries` (read)

Reads and filters log entries.

**Input:**
```
startDate  string   optional  YYYY-MM-DD — filter entries where date >= startDate
endDate    string   optional  YYYY-MM-DD — filter entries where date <= endDate
tags       Tag[]    optional  Return only entries containing at least one of these tags
limit      number   optional  Max entries to return, newest-first (default 20)
```

**Date filtering:** Both `startDate` and `endDate` filter on the `date` field (the training date the entry relates to), **not** `createdAt`.

**Pagination note:** With the default `limit` of 20, older entries beyond the limit are silently excluded. When the AI needs full history for analysis (e.g., reviewing all injury notes), it should pass a large explicit `limit` (e.g., `999`) rather than relying on the default.

**Output:** Array of matching entries, sorted newest-first.

---

## Implementation Plan

### Files to change

1. **`lib/log/client.ts`** (new file)
   - `readLog(): Promise<LogEntry[]>` — fetch and parse `training-log.json` from Vercel Blob; return `[]` on 404
   - `writeLog(entries: LogEntry[]): Promise<void>` — upload updated array to Vercel Blob
   - `appendEntry(entry: Omit<LogEntry, 'id' | 'createdAt'> & { author?: 'user' | 'ai' }): Promise<LogEntry>` — apply `author` default of `"user"` if omitted, generate id (uuid) and createdAt (ISO timestamp), append, save

2. **`app/api/[transport]/route.ts`** (existing file)
   - Add `add_log_entry` and `get_log_entries` to the `TOOLS` object, following the same pattern as existing tools (e.g. `get_daily_recovery`)
   - Add both tool schemas to the `tools/list` response, following the same `inputSchema` structure as existing tools

### New dependency
None — `@vercel/blob` already installed. uuid generation can use `crypto.randomUUID()` (built into Node 20+, already the minimum engine version).

---

## Out of Scope

- Edit or delete entries via MCP tool — use Vercel dashboard for manual corrections
- Multi-user support
- Full-text search
- Exporting or syncing the log to another service
- Linking entries to specific Garmin activity IDs (potential future enhancement)
