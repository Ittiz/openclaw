import { chromium } from "playwright";

const head = "f39850dd5976a59620330073711a850c45b4806c";
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const consoleMessages = [];
const pluginAuthRequests = [];
page.on("console", (message) => consoleMessages.push(`${message.type()}: ${message.text()}`));

async function fulfillPluginRoute(route, body, headers = {}) {
  const url = new URL(route.request().url());
  const probeNonce = url.searchParams.get("__openclaw_plugin_frame_auth_probe");
  const probeOrigin = url.searchParams.get("__openclaw_plugin_frame_auth_origin");
  if (probeNonce && probeOrigin) {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<script>parent.postMessage({type:"openclaw-plugin-frame-auth-probe",nonce:${JSON.stringify(probeNonce)}},${JSON.stringify(probeOrigin)})</script>`,
    });
    return;
  }
  await route.fulfill({ status: 200, contentType: "text/html", headers, body });
}

const pluginHtml = `<!doctype html>
<html><head><style>
body { font: 15px/1.45 system-ui; margin: 0; padding: 18px; color: #172033; background: #f8fafc; }
h2 { margin: 0 0 14px; font-size: 18px; }
.row { margin: 9px 0; padding: 10px 12px; border-radius: 8px; font-weight: 650; }
.pending { background: #e5e7eb; }.pass { background: #dcfce7; color: #166534; }
.reject { background: #fee2e2; color: #991b1b; }.info { background: #dbeafe; color: #1e40af; }
code { font-weight: 500; }
</style></head><body>
<h2>Live plugin iframe</h2>
<div id="allowed" class="row pending">Allowed action: pending</div>
<div id="unauthorized" class="row pending">Unauthorized action: pending</div>
<div id="context" class="row pending">Context update: pending</div>
<div id="stale" class="row pending">Stale action: pending</div>
<script>
(async () => {
  const connected = await window.openclawPluginUiBridge.connected;
  const port = connected.port;
  let state = connected.connection;
  const initialRevision = state.context.revision;
  const set = (id, text, kind) => {
    const node = document.getElementById(id);
    node.textContent = text;
    node.className = "row " + kind;
  };
  port.addEventListener("message", (event) => {
    const message = event.data;
    if (message?.v !== 1) return;
    if (message.type === "openclaw.pluginUi.update") {
      state = message;
      set("context", "Context update: revision " + state.context.revision + " for " + state.context.sessionKey, "info");
      port.postMessage({
        v: 1,
        type: "openclaw.pluginUi.sessionAction",
        id: "stale",
        actionId: "save",
        contextRevision: initialRevision,
      });
      return;
    }
    if (message.type !== "openclaw.pluginUi.response") return;
    if (message.id === "allowed") {
      set("allowed", "Allowed action: dispatched to parent-selected session", message.ok ? "pass" : "reject");
    } else if (message.id === "unauthorized") {
      set("unauthorized", "Unauthorized action: " + (message.ok ? "unexpectedly allowed" : "rejected before Gateway"), message.ok ? "reject" : "pass");
    } else if (message.id === "stale") {
      set("stale", "Stale revision: " + (message.ok ? "unexpectedly allowed" : "rejected before Gateway"), message.ok ? "reject" : "pass");
    }
  });
  port.start();
  port.postMessage({
    v: 1,
    type: "openclaw.pluginUi.sessionAction",
    id: "allowed",
    actionId: "save",
    contextRevision: initialRevision,
    payload: { proof: true },
  });
  port.postMessage({
    v: 1,
    type: "openclaw.pluginUi.sessionAction",
    id: "unauthorized",
    actionId: "delete",
    contextRevision: initialRevision,
  });
})();
</script></body></html>`;

await page.route("**/plugins/proof/allowed*", async (route) => {
  await fulfillPluginRoute(route, pluginHtml, {
      "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'",
  });
});
await page.route("**/plugins/proof/blocked*", async (route) => {
  await fulfillPluginRoute(
    route,
    "<!doctype html><script>document.body.textContent='SHOULD NOT EXECUTE'</script>",
    {
      "Content-Security-Policy": "default-src 'self'; script-src 'none'",
    },
  );
});
await page.route("**/plugins/proof/direct*", async (route) => {
  pluginAuthRequests.push({
    method: route.request().method(),
    resourceType: route.request().resourceType(),
  });
  await route.fulfill({
    status: 200,
    contentType: "text/html",
    body: "<!doctype html><body><h2>Direct plugin-auth iframe preserved</h2></body>",
  });
});

await page.goto("http://127.0.0.1:4175/", { waitUntil: "domcontentloaded" });
await page.evaluate(async ({ head }) => {
  await import("/src/pages/plugin/plugin-page.ts");
  document.body.innerHTML = `
    <main id="proof">
      <header><div class="eyebrow">OPENCLAW PR #110102 · REAL BROWSER PROOF</div><h1>Document-bound plugin action bridge</h1><p>Current head <code>${head}</code></p></header>
      <section class="proof-card"><h2>Allowed and rejected dispatch behavior</h2><div id="allowed-host"></div></section>
      <section class="proof-card"><h2>Restrictive response CSP</h2><div id="blocked-host"></div><p id="blocked-detail">A <code>script-src 'none'</code> response must fail closed before an action-capable iframe mounts.</p></section>
      <section class="proof-card"><h2>Plugin-auth compatibility</h2><div id="direct-host"></div><p id="direct-detail">Declared actions must not replace the established direct iframe path.</p></section>
      <footer id="dispatch-count">Gateway dispatches: pending</footer>
    </main>`;
  const style = document.createElement("style");
  style.textContent = `
    body { margin: 0; background: #0f172a; color: #e2e8f0; font: 16px/1.5 system-ui; }
    #proof { width: 1040px; margin: 0 auto; padding: 36px; }
    header { margin-bottom: 24px; } .eyebrow { color: #7dd3fc; font-weight: 800; letter-spacing: .08em; }
    h1 { margin: 6px 0; font-size: 34px; } header p { margin: 0; color: #94a3b8; }
    .proof-card { background: #fff; color: #172033; border-radius: 14px; padding: 20px; margin: 18px 0; box-shadow: 0 18px 45px #02061755; }
    .proof-card > h2 { margin: 0 0 12px; font-size: 20px; }
    openclaw-plugin-page { display: block; min-height: 120px; }
    iframe { display: block; width: 100%; height: 290px; border: 1px solid #cbd5e1; border-radius: 10px; }
    .lazy-view-state { padding: 18px; border-radius: 10px; background: #dcfce7; border: 2px solid #22c55e; }
    .card-title { font-size: 18px; font-weight: 800; color: #166534; }
    .card-sub { color: #166534; }
    #blocked-detail { color: #475569; margin-bottom: 0; }
    footer { margin-top: 20px; padding: 14px 18px; border-radius: 10px; background: #1e293b; font-weight: 750; }
  `;
  document.head.append(style);

  const makeContext = (tabId, path, requiresGatewayAuth = true) => {
    const requests = [];
    const snapshot = {
      client: { request: async (method, params) => { requests.push({ method, params }); return { saved: true }; } },
      phase: "connected",
      offlineStable: false,
      canvasPluginSurfaceUrl: null,
      hello: {
        type: "hello-ok",
        protocol: 3,
        auth: { role: "operator", scopes: ["operator.write"] },
        controlUiTabs: [{ pluginId: "proof", id: tabId, label: tabId === "allowed" ? "Allowed bridge" : "Plugin panel", path, sessionActions: ["save"], ...(requiresGatewayAuth ? { requiresGatewayAuth: true } : {}) }],
      },
      assistantAgentId: null,
      sessionKey: "agent:proof:initial",
      lastError: null,
      lastErrorCode: null,
    };
    const context = {
      gateway: { snapshot, subscribe: () => () => undefined, setSessionKey: () => undefined },
      config: {
        current: {
          embedSandboxMode: "scripts",
          allowExternalEmbedUrls: false,
          pluginFrameGrants: [{ pluginId: "proof", path: "/plugins/proof", match: "prefix" }],
        },
        refresh: async () => context.config.current,
      },
      navigate: () => undefined,
    };
    return { context, requests };
  };

  const allowedState = makeContext("allowed", "/plugins/proof/allowed");
  const allowed = document.createElement("openclaw-plugin-page");
  allowed.pluginId = "proof";
  allowed.tabId = "allowed";
  allowed.context = allowedState.context;
  document.getElementById("allowed-host").append(allowed);

  const blockedState = makeContext("blocked", "/plugins/proof/blocked");
  const blocked = document.createElement("openclaw-plugin-page");
  blocked.pluginId = "proof";
  blocked.tabId = "blocked";
  blocked.context = blockedState.context;
  document.getElementById("blocked-host").append(blocked);

  const directState = makeContext("direct", "/plugins/proof/direct", false);
  const direct = document.createElement("openclaw-plugin-page");
  direct.pluginId = "proof";
  direct.tabId = "direct";
  direct.context = directState.context;
  document.getElementById("direct-host").append(direct);

  window.__pr110102Proof = { allowed, allowedState, blocked, direct };
}, { head });

const allowedFrame = page.locator("#allowed-host iframe");
await allowedFrame.waitFor({ state: "visible" });
const liveFrame = page.frameLocator("#allowed-host iframe");
await liveFrame.locator("#allowed.pass").waitFor();
await liveFrame.locator("#unauthorized.pass").waitFor();

await page.evaluate(() => {
  const proof = window.__pr110102Proof;
  proof.allowedState.context.gateway.snapshot.sessionKey = "agent:proof:updated";
  proof.allowed.requestUpdate();
});
await liveFrame.locator("#context.info").waitFor();
await liveFrame.locator("#stale.pass").waitFor();
await page.locator("#blocked-host .lazy-view-state").waitFor();
await page.waitForFunction(() => document.querySelectorAll("#blocked-host iframe").length === 0);
const directFrame = page.locator("#direct-host iframe");
await directFrame.waitFor({ state: "visible" });
await page.frameLocator("#direct-host iframe").getByText("Direct plugin-auth iframe preserved").waitFor();

const result = await page.evaluate(() => {
  const proof = window.__pr110102Proof;
  const requests = proof.allowedState.requests;
  document.getElementById("dispatch-count").textContent =
    `Gateway dispatches: ${requests.length} (only the declared, current-context action)`;
  return {
    userAgent: navigator.userAgent,
    gatewayRequests: requests,
    blockedIframeCount: document.querySelectorAll("#blocked-host iframe").length,
    blockedText: document.querySelector("#blocked-host")?.textContent?.trim(),
    pluginAuthSrc: document.querySelector("#direct-host iframe")?.getAttribute("src"),
    pluginAuthSrcdocLength: document.querySelector("#direct-host iframe")?.srcdoc.length,
  };
});
result.iframeRows = await liveFrame.locator(".row").allTextContents();
result.pluginAuthRequests = pluginAuthRequests;
result.head = head;
result.consoleErrors = consoleMessages.filter((line) => line.startsWith("error:"));

await page.screenshot({ path: "/tmp/pr110102-current-head-browser-proof.png", fullPage: true });
console.log(JSON.stringify(result, null, 2));
await browser.close();
