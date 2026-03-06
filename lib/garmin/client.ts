import { GarminConnect } from "@flow-js/garmin-connect";
import { put, list, get } from "@vercel/blob";
import * as fs from "fs";
import * as path from "path";

const SESSION_BLOB_NAME = "garmin-session.json";
const LOCAL_SESSION_FILE = path.join(process.cwd(), ".garmin-session.json");

const isProduction = process.env.VERCEL === "1";

let clientInstance: GarminConnect | null = null;

/**
 * Returns an authenticated GarminConnect client.
 * - In production (Vercel): persists session tokens to Vercel Blob.
 * - Locally: persists session tokens to a JSON file.
 * - Reuses client instance within the same function invocation.
 */
export async function getGarminClient(): Promise<GarminConnect> {
    console.log("[GarminClient] getGarminClient called");
    console.log("[GarminClient] isProduction:", isProduction);
    console.log("[GarminClient] VERCEL env:", process.env.VERCEL);
    console.log("[GarminClient] BLOB_READ_WRITE_TOKEN set:", !!process.env.BLOB_READ_WRITE_TOKEN);

    if (clientInstance) {
        console.log("[GarminClient] Returning cached client instance");
        return clientInstance;
    }

    const username = process.env.GARMIN_EMAIL;
    const password = process.env.GARMIN_PASSWORD;

    console.log("[GarminClient] GARMIN_EMAIL set:", !!username);
    console.log("[GarminClient] GARMIN_PASSWORD set:", !!password);

    if (!username || !password) {
        console.error("[GarminClient] Missing GARMIN_EMAIL or GARMIN_PASSWORD");
        throw new Error(
            "GARMIN_EMAIL and GARMIN_PASSWORD environment variables are required"
        );
    }

    const client = new GarminConnect({ username, password });

    // Try to restore existing session
    console.log("[GarminClient] Attempting to restore session...");
    const restored = await restoreSession(client);
    console.log("[GarminClient] Session restored:", restored);

    if (!restored) {
        // Full login required
        console.log("[GarminClient] No session found, attempting full login...");
        try {
            await client.login();
            console.log("[GarminClient] Login successful!");
        } catch (loginError) {
            console.error("[GarminClient] LOGIN FAILED:", loginError);
            throw loginError;
        }

        console.log("[GarminClient] Saving session after login...");
        await saveSession(client);
    }

    clientInstance = client;
    console.log("[GarminClient] Client ready");
    return client;
}

// --- Session Persistence ---

async function restoreSession(client: GarminConnect): Promise<boolean> {
    try {
        if (isProduction) {
            console.log("[GarminClient] Restoring session from Vercel Blob...");
            return await restoreFromBlob(client);
        } else {
            console.log("[GarminClient] Restoring session from local file...");
            return restoreFromFile(client);
        }
    } catch (error) {
        console.error("[GarminClient] Failed to restore session:", error);
        return false;
    }
}

async function saveSession(client: GarminConnect): Promise<void> {
    try {
        const tokens = client.exportToken();
        const data = JSON.stringify(tokens);
        console.log("[GarminClient] Saving session, data length:", data.length);

        if (isProduction) {
            console.log("[GarminClient] Saving to Vercel Blob...");
            const result = await put(SESSION_BLOB_NAME, data, {
                access: "private",
                addRandomSuffix: false,
                contentType: "application/json",
            });
            console.log("[GarminClient] Blob saved successfully, url:", result.url);
        } else {
            console.log("[GarminClient] Saving to local file:", LOCAL_SESSION_FILE);
            fs.writeFileSync(LOCAL_SESSION_FILE, data, "utf-8");
            console.log("[GarminClient] Local file saved");
        }
    } catch (error) {
        console.error("[GarminClient] FAILED TO SAVE SESSION:", error);
    }
}

async function restoreFromBlob(client: GarminConnect): Promise<boolean> {
    console.log("[GarminClient] Getting blob:", SESSION_BLOB_NAME);
    try {
        const result = await get(SESSION_BLOB_NAME, { access: "private" });

        if (!result || result.statusCode !== 200 || !result.stream) {
            console.log("[GarminClient] No session blob found or empty response");
            return false;
        }

        console.log("[GarminClient] Blob found, reading stream...");
        // Read the stream to text
        const reader = result.stream.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const text = new TextDecoder().decode(
            Buffer.concat(chunks)
        );

        const tokens = JSON.parse(text);
        console.log("[GarminClient] Tokens loaded from blob, has oauth1:", !!tokens.oauth1, "has oauth2:", !!tokens.oauth2);
        client.loadToken(tokens.oauth1, tokens.oauth2);
        console.log("[GarminClient] Session restored from blob successfully");
        return true;
    } catch (error) {
        console.error("[GarminClient] Failed to get blob:", error);
        return false;
    }
}

function restoreFromFile(client: GarminConnect): boolean {
    if (!fs.existsSync(LOCAL_SESSION_FILE)) {
        console.log("[GarminClient] Local session file not found:", LOCAL_SESSION_FILE);
        return false;
    }

    console.log("[GarminClient] Reading local session file...");
    const data = fs.readFileSync(LOCAL_SESSION_FILE, "utf-8");
    const tokens = JSON.parse(data);
    console.log("[GarminClient] Local tokens loaded, has oauth1:", !!tokens.oauth1, "has oauth2:", !!tokens.oauth2);
    client.loadToken(tokens.oauth1, tokens.oauth2);
    console.log("[GarminClient] Session restored from local file successfully");
    return true;
}
