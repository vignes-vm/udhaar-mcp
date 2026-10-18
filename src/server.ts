import express from "express";

const app = express();
const port = process.env.PORT ?? 3000;

app.get("/health", (_req, res) => {
  res.json({ ok: true, name: "udhaar" });
});

app.listen(port, () => {
  console.log(`udhaar-mcp listening on ${port}`);
});
