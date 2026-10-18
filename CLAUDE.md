# Project
Udhaar: a voice-first credit ledger MCP server for the Amazon Developer Hackathon (Alexa+ track, plus AWS Builder and Open Source mini-challenges). Node 20+, TypeScript (ESM, NodeNext), @modelcontextprotocol/sdk, express, zod, @aws-sdk/client-bedrock-runtime.

# Git rules (strict)
- One commit per completed step, conventional-commit style (feat:, fix:, docs:, chore:, test:), imperative, under 72 chars.
- NEVER add Co-Authored-By, "Generated with Claude", Claude-Session links or any AI attribution to commit messages or PR descriptions. Commit author is the configured git user only.
- Never commit secrets, .env, node_modules, dist, or data/. Run `git diff --cached` and check before every commit.
- After each commit run: git log -1 --format=%B | grep -iE "claude|anthropic|co-authored" and confirm it prints nothing.

# Engineering rules
- Run `npx tsc --noEmit` and the smoke test before committing code changes.
- No hardcoded credentials. AWS credentials only from the standard AWS chain.
- Keep a running friction log: whenever I (or you) hit a real problem with an Amazon/AWS/MCP tool, SDK or doc, append an entry to FRICTION_LOG.md with: task attempted, steps taken, expected vs actual, severity (low/med/high), workaround, suggestion. Only log things that actually happened. Never invent entries.
