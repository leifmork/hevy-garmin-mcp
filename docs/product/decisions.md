# Product Decisions

## Key decisions

**Tech stack: Next.js on Vercel**
Chosen for fast deployment, serverless functions, and native Vercel Blob support. The MCP server runs as a Next.js API route.

**Custom JSON-RPC MCP handler (not the SDK's transport layer)**
The active MCP handler is a hand-rolled JSON-RPC implementation in `app/api/[transport]/route.ts`. There is also a `lib/garmin/tools.ts` using the `@modelcontextprotocol/sdk` `registerTool` pattern, but it is not the active route. Any new tools are added to the custom handler.

**Capability URL auth (`?token=`)**
Chosen over OAuth for simplicity — single-user tool, no need for a full OAuth flow. The token is passed as a query parameter over HTTPS.

**Vercel Blob for session persistence**
Garmin requires session tokens to avoid login throttling. These are stored in a private Vercel Blob store.

**Read-only tools (so far)**
All current MCP tools are read-only — no writes back to Garmin or Hevy. This matches the coaching use case where the AI reads data and provides advice.

**No database**
No Prisma or external DB in use. State is minimal (Garmin session token in Blob).

## Open questions
- How to add persistent log/notes capability that both the AI and user can write to
- Whether to adopt the MCP SDK's `registerTool` pattern fully or keep the custom handler
