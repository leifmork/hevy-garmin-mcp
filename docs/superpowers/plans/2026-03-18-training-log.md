# Training Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two MCP tools (`add_log_entry` and `get_log_entries`) backed by a Vercel Blob JSON file, giving the AI coach and athlete a shared append-only training log.

**Architecture:** A new `lib/log/client.ts` module owns all Vercel Blob I/O, the `LogEntry` type, and the `LOG_TAGS` constant. The two tools are registered in the existing monolithic route handler following the exact pattern of existing tools. No new dependencies.

**Tech Stack:** TypeScript, `@vercel/blob` (already installed), `crypto.randomUUID()` (Node 20+ built-in — already the minimum engine version).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `lib/log/client.ts` | Create | `LogEntry` type, `LOG_TAGS` constant, `readLog` / `writeLog` / `appendEntry` |
| `app/api/[transport]/route.ts` | Modify | Register `add_log_entry` and `get_log_entries` in `TOOLS` object and `tools/list` schema |
| `docs/product/features.md` | Modify | Mark training log tools as built |

> **Local testing note:** Vercel Blob requires `BLOB_READ_WRITE_TOKEN` to be set. For local testing, add it to `.env.local`. Get the value from the Vercel dashboard → Storage → your Blob store → `.env.local` snippet.

---

## Task 1: Create `lib/log/client.ts`

**Files:**
- Create: `lib/log/client.ts`

- [ ] **Step 1: Write `lib/log/client.ts`**

Create the file at `lib/log/client.ts` with this exact content:

```typescript
import { put, get } from "@vercel/blob";

// ─── Types ────────────────────────────────────────────────

export const LOG_TAGS = [
    "observation",
    "milestone",
    "injury",
    "illness",
    "goal",
    "recovery",
    "nutrition",
    "mental",
    "race",
    "plan",
    "lifestyle",
    "technique",
] as const;

export type LogTag = typeof LOG_TAGS[number];

export interface LogEntry {
    id: string;
    date: string;       // YYYY-MM-DD — the training date this entry relates to
    text: string;       // free-form note
    tags: LogTag[];     // required, at least one
    author: "user" | "ai";
    createdAt: string;  // ISO 8601 — when the entry was written
}

// ─── Blob Storage ─────────────────────────────────────────

const LOG_BLOB_NAME = "training-log.json";

/**
 * Reads all log entries from Vercel Blob.
 * Returns [] if the file does not yet exist (cold start / first use).
 */
export async function readLog(): Promise<LogEntry[]> {
    try {
        const result = await get(LOG_BLOB_NAME, { access: "private" });
        if (!result || result.statusCode !== 200 || !result.stream) return [];

        const reader = result.stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const text = new TextDecoder().decode(Buffer.concat(chunks));
        return JSON.parse(text) as LogEntry[];
    } catch {
        return [];
    }
}

/**
 * Overwrites the log blob with the given entries array.
 * Entries are stored oldest-first (convention only — get_log_entries re-sorts on read).
 */
export async function writeLog(entries: LogEntry[]): Promise<void> {
    await put(LOG_BLOB_NAME, JSON.stringify(entries, null, 2), {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
    });
}

/**
 * Appends a new entry to the log and returns the created entry.
 * Throws if tags array is empty.
 */
export async function appendEntry(
    entry: Omit<LogEntry, "id" | "createdAt"> & { author?: "user" | "ai" }
): Promise<LogEntry> {
    if (!entry.tags || entry.tags.length === 0) {
        throw new Error("At least one tag is required");
    }

    const newEntry: LogEntry = {
        id: crypto.randomUUID(),
        date: entry.date,
        text: entry.text,
        tags: entry.tags,
        author: entry.author ?? "user",
        createdAt: new Date().toISOString(),
    };

    const entries = await readLog();
    entries.push(newEntry);
    await writeLog(entries);
    return newEntry;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/leifmork/GitHub/Private/hevy-garmin-mcp && pnpm tsc --noEmit
```

Expected: No errors. If you see errors about `@vercel/blob` types, check that `pnpm install` has been run.

- [ ] **Step 3: Commit**

```bash
git add lib/log/client.ts
git commit -m "feat: add training log blob client (readLog, writeLog, appendEntry)"
```

---

## Task 2: Register `add_log_entry` tool

**Files:**
- Modify: `app/api/[transport]/route.ts`

This file has two sections to update:
1. The `TOOLS` object (~line 163) — add the handler
2. The `tools/list` array (~line 589) — add the JSON schema

Model after `get_daily_recovery` which is the simplest existing tool.

- [ ] **Step 1: Add handler to the `TOOLS` object**

In `app/api/[transport]/route.ts`, inside the `TOOLS` object, add after the last Hevy tool (`get_lifting_volume`):

```typescript
    // ─── Training Log Tools ───────────────────────────────────

    add_log_entry: {
        description: "Appends a new entry to the training log. Records qualitative context that Garmin and Hevy data cannot capture.",
        handler: async ({ date, text, tags, author = "user" }: { date: string; text: string; tags: string[]; author?: string }) => {
            const { appendEntry } = await import("@/lib/log/client");
            const entry = await appendEntry({
                date,
                text,
                tags: tags as import("@/lib/log/client").LogTag[],
                author: author === "ai" ? "ai" : "user",
            });
            return entry;
        },
    },
```

- [ ] **Step 2: Add schema to the `tools/list` array**

In the `tools/list` handler, after the `get_lifting_volume` schema entry, add:

```typescript
            {
                name: "add_log_entry",
                description: "Appends an entry to the athlete's training log. Use this to record qualitative context that Garmin and Hevy cannot capture — observations, milestones, injuries, goals, recovery notes, etc. The log is append-only; entries cannot be edited or deleted via this tool.",
                annotations: {
                    readOnlyHint: false,
                    destructiveHint: false,
                    openWorldHint: false,
                },
                inputSchema: {
                    type: "object",
                    properties: {
                        date: {
                            type: "string",
                            description: "The training date this entry relates to (YYYY-MM-DD). Use today's date unless the entry is retrospective.",
                        },
                        text: {
                            type: "string",
                            description: "Free-form note. Be specific and concise — this is coaching context, not a diary.",
                        },
                        tags: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: [
                                    "observation", "milestone", "injury", "illness", "goal",
                                    "recovery", "nutrition", "mental", "race", "plan", "lifestyle", "technique",
                                ],
                            },
                            description: "Required. One or more tags classifying this entry. Choose the most specific tag that fits. Tag guide: observation=FALLBACK ONLY, use when nothing else fits; milestone=PRs and achievements; injury=localized pain (NOT illness); illness=systemic sickness like flu (NOT injury); goal=setting/updating targets; recovery=subjective readiness to train; nutrition=fueling and diet; mental=internal state like motivation (NOT external stress, use lifestyle); race=race day notes; plan=training plan changes; lifestyle=external factors like travel or work stress (NOT internal state, use mental); technique=form and coaching cues. Key distinctions: injury=localized, illness=systemic. mental=internal, lifestyle=external.",
                        },
                        author: {
                            type: "string",
                            enum: ["user", "ai"],
                            description: "Who is writing this entry. Use 'ai' when logging an observation autonomously. Defaults to 'user'.",
                        },
                    },
                    required: ["date", "text", "tags"],
                    additionalProperties: true,
                },
            },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Start dev server and verify tool appears**

```bash
pnpm dev
```

In a separate terminal (replace `YOUR_TOKEN` with your `MCP_AUTH_TOKEN` from `.env.local`, or omit `?token=...` if token is not set):

```bash
curl -s -X POST "http://localhost:3000/api/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | grep -o '"add_log_entry"'
```

Expected output: `"add_log_entry"`

- [ ] **Step 5: Test writing a log entry**

```bash
curl -s -X POST "http://localhost:3000/api/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc":"2.0","id":2,"method":"tools/call",
    "params":{
      "name":"add_log_entry",
      "arguments":{
        "date":"2026-03-18",
        "text":"First log entry — training log is working.",
        "tags":["milestone"],
        "author":"user"
      }
    }
  }'
```

Expected: SSE response containing a JSON object with `id`, `date`, `text`, `tags: ["milestone"]`, `author: "user"`, `createdAt`.

- [ ] **Step 6: Commit**

```bash
git add app/api/\[transport\]/route.ts
git commit -m "feat: add add_log_entry MCP tool"
```

---

## Task 3: Register `get_log_entries` tool

**Files:**
- Modify: `app/api/[transport]/route.ts`

- [ ] **Step 1: Add handler to the `TOOLS` object**

Immediately after `add_log_entry` in the `TOOLS` object, add:

```typescript
    get_log_entries: {
        description: "Reads training log entries, filtered by date and/or tags. Returns newest-first. Pass limit=999 when full history is needed.",
        handler: async ({ startDate = "", endDate = "", tags = [], limit = 20 }: { startDate?: string; endDate?: string; tags?: string[]; limit?: number }) => {
            const { readLog } = await import("@/lib/log/client");
            let entries = await readLog();

            if (startDate) entries = entries.filter(e => e.date >= startDate);
            if (endDate) entries = entries.filter(e => e.date <= endDate);
            if (tags.length > 0) {
                entries = entries.filter(e =>
                    (tags as string[]).some(t => e.tags.includes(t as import("@/lib/log/client").LogTag))
                );
            }

            // Sort newest-first by training date, then by createdAt as tiebreaker
            entries.sort((a, b) =>
                b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)
            );

            return entries.slice(0, limit);
        },
    },
```

- [ ] **Step 2: Add schema to the `tools/list` array**

After the `add_log_entry` schema, add:

```typescript
            {
                name: "get_log_entries",
                description: "Reads training log entries. Filters by date range and/or tags. Returns newest-first. Filters on the training date field, not the entry creation timestamp. Use limit=999 when you need full history (e.g. all injury notes ever recorded).",
                annotations: {
                    readOnlyHint: true,
                    destructiveHint: false,
                    openWorldHint: false,
                },
                inputSchema: {
                    type: "object",
                    properties: {
                        startDate: {
                            type: "string",
                            description: "Return entries where training date >= startDate (YYYY-MM-DD).",
                        },
                        endDate: {
                            type: "string",
                            description: "Return entries where training date <= endDate (YYYY-MM-DD).",
                        },
                        tags: {
                            type: "array",
                            items: {
                                type: "string",
                                enum: [
                                    "observation", "milestone", "injury", "illness", "goal",
                                    "recovery", "nutrition", "mental", "race", "plan", "lifestyle", "technique",
                                ],
                            },
                            description: "Filter to entries containing at least one of these tags. Omit to return entries with any tag.",
                        },
                        limit: {
                            type: "number",
                            description: "Max entries to return, newest-first (default 20). Pass 999 to retrieve full history.",
                        },
                    },
                    additionalProperties: true,
                },
            },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Test retrieving log entries**

```bash
curl -s -X POST "http://localhost:3000/api/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_log_entries","arguments":{}}}'
```

Expected: Returns the entry written in Task 2. Verify `date`, `text`, `tags`, and `author` match what was written.

- [ ] **Step 5: Test tag filtering returns empty for unmatched tag**

```bash
curl -s -X POST "http://localhost:3000/api/mcp?token=YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"get_log_entries","arguments":{"tags":["injury"]}}}'
```

Expected: Returns empty array `[]`. No injury entries were written, so filter correctly returns nothing.

- [ ] **Step 6: Commit**

```bash
git add app/api/\[transport\]/route.ts
git commit -m "feat: add get_log_entries MCP tool"
```

---

## Task 4: Update docs and push

**Files:**
- Modify: `docs/product/features.md`

- [ ] **Step 1: Add training log tools to the Built section**

In `docs/product/features.md`, add to the **Built** section:

```
- `add_log_entry` — append a dated, tagged qualitative entry to the training log (write)
- `get_log_entries` — read and filter training log entries by date range and/or tag (read)
```

- [ ] **Step 2: Commit**

```bash
git add docs/product/features.md
git commit -m "docs: mark training log tools as built in features.md"
```

- [ ] **Step 3: Push to origin**

```bash
git push
```
