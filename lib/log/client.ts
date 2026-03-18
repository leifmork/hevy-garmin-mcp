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
