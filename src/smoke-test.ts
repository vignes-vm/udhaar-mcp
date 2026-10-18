import { spawn } from "node:child_process";

const port = 3999;
const server = spawn("npx", ["tsx", "src/server.ts"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "inherit"],
});

server.stdout.on("data", (chunk) => process.stdout.write(chunk));

const timeout = setTimeout(() => {
  console.error("smoke test timed out waiting for server");
  server.kill();
  process.exit(1);
}, 10_000);

async function waitForHealth(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      const body = (await res.json()) as { ok?: boolean; name?: string };
      if (res.ok && body.ok === true && body.name === "udhaar") {
        console.log("smoke test passed:", body);
        return;
      }
    } catch {
      // server not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("server never became healthy");
}

try {
  await waitForHealth();
  clearTimeout(timeout);
  server.kill();
  process.exit(0);
} catch (err) {
  clearTimeout(timeout);
  console.error(err);
  server.kill();
  process.exit(1);
}
