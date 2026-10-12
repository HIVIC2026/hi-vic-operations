// Drives a real Chromium over the DevTools Protocol. The document host is the ACTUAL
// preview hostname: the request is intercepted and fulfilled locally, so no DNS/DNS-mapping
// trickery is involved — window.location.hostname is genuinely the Lovable preview host.
import { readFileSync, writeFileSync } from "node:fs";

const target = process.argv[2];
const outTxt = process.argv[3];
const outPng = process.argv[4];
const PORT = process.argv[5] ?? "9333";

const html = readFileSync("/tmp/step105-bv/www/index.html", "utf8");
const js = readFileSync("/tmp/step105-bv/www/step105-bundle.js", "utf8");
const base = `http://127.0.0.1:${PORT}`;

const res = await fetch(`${base}/json/new?about:blank`, { method: "PUT" });
const t = await res.json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));

let id = 0;
const pending = new Map();
const send = (method, params = {}) => {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise((resolve) => pending.set(i, resolve));
};

let loaded = false;
ws.addEventListener("message", async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
    return;
  }
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params;
    const isJs = request.url.includes("step105-bundle.js");
    await send("Fetch.fulfillRequest", {
      requestId,
      responseCode: 200,
      responseHeaders: [{ name: "Content-Type", value: isJs ? "text/javascript" : "text/html" }],
      body: Buffer.from(isJs ? js : html).toString("base64"),
    });
  }
  if (m.method === "Page.loadEventFired") loaded = true;
});

await send("Page.enable");
await send("Runtime.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
await send("Page.navigate", { url: target });

const t0 = Date.now();
while (!loaded && Date.now() - t0 < 15000) await new Promise((r) => setTimeout(r, 100));
await new Promise((r) => setTimeout(r, 600));

const ev = await send("Runtime.evaluate", {
  expression:
    "JSON.stringify({href:location.href, host:location.hostname, asserted:window.__STEP105_READY__===true, " +
    "title:document.title, mode:document.getElementById('mode').textContent, text:document.body.innerText})",
  returnByValue: true,
});
writeFileSync(outTxt, ev.result?.value ?? `EVAL_ERROR ${JSON.stringify(ev)}`, "utf8");

const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
writeFileSync(outPng, Buffer.from(shot.data, "base64"));
ws.close();
await fetch(`${base}/json/close/${t.id}`).catch(() => {});
process.exit(0);
