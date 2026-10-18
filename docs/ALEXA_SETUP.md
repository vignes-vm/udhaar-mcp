# Connecting Udhaar to Alexa+

## What's verified vs unverified

**Verified** (actually run and observed during development):
- The server implements Streamable HTTP per MCP spec 2025-11-25: single
  `/mcp` endpoint, `POST` returns SSE/JSON per the spec, `GET`/`DELETE`
  return 405 with a JSON-RPC error body, stateless (`sessionIdGenerator:
  undefined`).
- Validated against the official `@modelcontextprotocol/inspector` CLI and
  the official `@modelcontextprotocol/sdk` client (`src/smoke-test.ts`),
  both over HTTP against a running instance.
- Bearer-token auth on `/mcp` (`UDHAAR_API_KEY`): confirmed 401 without a
  token, success with the correct one.
- The Docker image: built locally, runs as non-root, `/health` and `/mcp`
  both respond from the container.

**Not verified** (no Alexa+ device or Alexa Developer Console access was
used in building this):
- Registering this server as a real Alexa+ add-on.
- An actual voice round-trip through an Echo / Alexa+ app.
- Whether the simple bearer-token auth above is sufficient for Alexa+'s
  registration flow, or whether full OAuth 2.1 is strictly required (see
  below) — this was researched from public docs, not tested against a real
  registration.

## What Alexa+ requires (from the public MCP Toolkit docs)

- **Transport**: Streamable HTTP, MCP spec 2025-11-25 or later. ✅ implemented.
- **Latency**: round-trip tool response under 500ms. Not load-tested; the
  JSON-file ledger and local/rules-based parsing path are fast, but the
  Bedrock-backed tools (`record_from_speech`, `collection_plan`) depend on
  model latency and may exceed this under cold starts — worth measuring
  before a real registration.
- **Authentication**: the quickstart docs describe full **OAuth 2.1 with
  PKCE** — an authorization code flow, a Protected Resource Metadata document
  at `/.well-known/oauth-authorization-server`, a `resource` parameter on
  authorization/token requests, and Bearer tokens only in the
  `Authorization` header (never query strings). **This repo does not
  implement that** — it implements a simpler static bearer-token check
  (`UDHAAR_API_KEY`), which is enough for local testing, the Inspector, and
  the web simulator, but very likely not enough on its own for Alexa+'s
  real OAuth-based registration flow. Building a full OAuth 2.1
  authorization server was judged too large to add silently; flagging it
  here instead, per project ground rules.
- **Onboarding**: either the **Add-on Agent Skill** (works inside Claude
  Code / Kiro / Cursor / VS Code Copilot with shell access) or the
  **Alexa AI CLI** directly.

## Steps you need to do (this machine can't do these for you)

1. **Deploy the server somewhere reachable by Alexa+.** For local testing,
   use a tunnel:
   ```bash
   cloudflared tunnel --url http://localhost:3000
   ```
   For anything beyond a quick demo, use the App Runner deployment in
   `deploy/README.md` instead — a tunnel URL changes every run.

2. **Authenticate the CLI with your Amazon developer account:**
   ```bash
   alexa-ai configure
   ```

3. **Onboard the add-on.** Recommended path — let the Add-on Agent Skill
   drive it (it introspects the running server, scaffolds `addon.json`,
   collects media assets, and deploys):
   - Install/invoke the Add-on Agent Skill in your coding agent per Amazon's
     instructions, pointed at this repo and your deployed `/mcp` URL.

   Manual path:
   ```bash
   alexa-ai new mcp
   # fill in addon.json: short description (<=123 chars), full description
   # (<=4000 chars), 3-4 example phrases (<=200 chars each) — use the
   # phrasing examples in skills/udhaar/SKILL.md as a starting point.
   alexa-ai deploy
   ```

4. **Provide required assets** when prompted: 6 icon sizes, carousel images,
   optionally a banner image, plus a privacy policy URL and terms-of-use URL
   for the add-on (this project doesn't ship these — write short ones for
   your own hosting, or use placeholders for a hackathon demo and say so).

5. **Auth**: if the CLI's scaffolding doesn't bridge auth for you
   automatically, you'll need to either (a) implement the OAuth 2.1 + PKCE
   flow described above before registering, or (b) check whether the
   add-on layer Amazon runs in front of your server handles that
   translation — this wasn't something that could be confirmed without a
   real registration attempt. Start the onboarding flow and see what it
   asks for; don't assume either way.

6. **Test the real integration** by speaking to Alexa+ once it reports the
   add-on connected: say one of the example phrases from
   `skills/udhaar/SKILL.md` and confirm the ledger updates (cross-check with
   the web simulator at `/` or `GET /api/state`).

Until step 6 has actually been done, treat "works with Alexa+" as unproven —
what's demonstrated in this repo is a spec-compliant Streamable HTTP MCP
server, verified via the Inspector, the official SDK client, and a
browser-based simulator that exercises the same tools a real Alexa+
integration would call.
