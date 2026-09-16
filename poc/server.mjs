import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, join, normalize, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { isSafeBridgeReplay } from "./bridge-replay.mjs";
import { ControllerTransportTracker } from "./transport-state.mjs";

const root = normalize(join(dirname(fileURLToPath(import.meta.url)), ".."));
const port = Number(process.env.PORT || 4316);
const bridgeBinary = process.env.VIDEO_SYNC_BRIDGE_BIN || join(root, ".build", "bridge", "video-sync-bridge");
const rekordboxAdapterBinary = process.env.VIDEO_SYNC_REKORDBOX_ADAPTER_BIN || join(root, ".build", "bridge", "video-sync-rekordbox-adapter");
const bridgeRecordPath = process.env.VIDEO_SYNC_BRIDGE_RECORD || join(root, ".build", "bridge-live.jsonl");
const transportStatePath = process.env.VIDEO_SYNC_TRANSPORT_STATE || join(root, ".build", "bridge-transport-state.json");
const bridgeMapPath = process.env.VIDEO_SYNC_BRIDGE_MAP || join(root, "bridge", "config", "ddj-grv6.csv");
const bridgeMidiPortName = process.env.VIDEO_SYNC_MIDI_PORT_NAME || "DDJ-GRV6";
const bridgeMidiMode = process.env.VIDEO_SYNC_MIDI_MODE === "virtual" ? "virtual" : "direct";
const bridgeEnabled = process.env.VIDEO_SYNC_BRIDGE !== "off";
const bridgeClients = new Set();
const recentBridgeMessages = [];
let latestLinkMessage = null;
let latestRekordboxState = null;
let savedTransportState = null;
try {
  savedTransportState = JSON.parse(await readFile(transportStatePath, "utf8"));
} catch {
  // The first run has no saved controller parity yet.
}
const controllerTransport = new ControllerTransportTracker(2, savedTransportState);
let transportWrite = Promise.resolve();
let bridgeProcess = null;
let rekordboxAdapterProcess = null;
let shuttingDown = false;
let bridgeState = {
  state: bridgeEnabled ? "starting" : "disabled",
  detail: bridgeEnabled ? "Starting the headless Link and MIDI bridge…" : "Bridge launch disabled by VIDEO_SYNC_BRIDGE=off.",
  binary: bridgeBinary,
  recordPath: bridgeRecordPath,
};
let rekordboxAdapterState = {
  state: process.platform === "darwin" ? "starting" : "unsupported",
  detail: process.platform === "darwin"
    ? "Starting the Rekordbox deck-state adapter…"
    : "The first deck-state adapter is available on macOS only.",
  binary: rekordboxAdapterBinary,
};

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".mp4": "video/mp4",
  ".png": "image/png",
};

function sendEvent(response, event, value) {
  response.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`);
}

function broadcast(event, value) {
  for (const response of bridgeClients) sendEvent(response, event, value);
}

function updateBridgeState(state, detail) {
  bridgeState = { ...bridgeState, state, detail };
  broadcast("bridge-status", bridgeState);
}

function updateRekordboxAdapterState(state, detail) {
  rekordboxAdapterState = { ...rekordboxAdapterState, state, detail };
  broadcast("rekordbox-adapter-status", rekordboxAdapterState);
}

function publishControllerTransport(changedDeck) {
  broadcast("controller-transport", { ...controllerTransport.snapshot(), changedDeck });
}

function persistControllerTransport() {
  const serialized = `${JSON.stringify(controllerTransport.snapshot(), null, 2)}\n`;
  transportWrite = transportWrite
    .then(() => mkdir(dirname(transportStatePath), { recursive: true }))
    .then(() => writeFile(transportStatePath, serialized))
    .catch((error) => console.error(`[transport] ${error.message}`));
}

function publishBridgeMessage(message) {
  const transportChanged = ["controller.control", "rekordbox.control"].includes(message.type) &&
    controllerTransport.observe(message.payload, message.emittedAtUnixMs);
  const publishTransportAfterControl = ["deck.load", "track.load"].includes(message.payload?.event);
  if (transportChanged) {
    persistControllerTransport();
    if (!publishTransportAfterControl) publishControllerTransport(Number(message.payload.deck));
  }
  if (message.type === "link.clock") latestLinkMessage = message;
  else if (message.type === "rekordbox.deck-state") latestRekordboxState = message;
  else if (message.type === "rekordbox.adapter-status") {
    updateRekordboxAdapterState(message.payload.state, message.payload.detail);
  } else {
    recentBridgeMessages.push(message);
    if (recentBridgeMessages.length > 30) recentBridgeMessages.shift();
  }
  if (message.type === "bridge.ready") {
    const midiSource = message.payload.midiMode === "existing-port"
      ? `controller ${message.payload.midiPortName}`
      : `virtual input ${message.payload.virtualMidiName}`;
    updateBridgeState("running", `Listening to ${midiSource} alongside Rekordbox. Raw capture: ${bridgeRecordPath}`);
  }
  broadcast("bridge-message", message);
  if (transportChanged && publishTransportAfterControl) publishControllerTransport(Number(message.payload.deck));
}

async function startBridge() {
  if (!bridgeEnabled) return;
  try {
    await stat(bridgeBinary);
    await mkdir(dirname(bridgeRecordPath), { recursive: true });
  } catch {
    updateBridgeState("missing", "Bridge binary not found. Run npm run bridge:build, then restart this server.");
    return;
  }

  const args = ["--clock-hz", "10", "--record", bridgeRecordPath];
  if (bridgeMidiMode === "direct") args.push("--midi-port-name", bridgeMidiPortName);
  if (bridgeMapPath) args.push("--map", bridgeMapPath);
  bridgeProcess = spawn(bridgeBinary, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const lines = createInterface({ input: bridgeProcess.stdout });
  lines.on("line", (line) => {
    try {
      publishBridgeMessage(JSON.parse(line));
    } catch {
      updateBridgeState("error", `Bridge returned invalid JSON: ${line.slice(0, 100)}`);
    }
  });

  let lastError = "";
  bridgeProcess.stderr.on("data", (chunk) => {
    lastError = String(chunk).trim();
    if (lastError) console.error(`[bridge] ${lastError}`);
  });
  bridgeProcess.on("error", (error) => updateBridgeState("error", error.message));
  bridgeProcess.on("exit", (code, signal) => {
    bridgeProcess = null;
    if (shuttingDown) return;
    updateBridgeState("exited", lastError || `Bridge exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
  });
}

async function startRekordboxAdapter() {
  if (process.platform !== "darwin") return;
  try {
    await stat(rekordboxAdapterBinary);
  } catch {
    updateRekordboxAdapterState("missing", "Rekordbox adapter binary not found. Run npm run bridge:build, then restart this server.");
    return;
  }

  rekordboxAdapterProcess = spawn(rekordboxAdapterBinary, [], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  const lines = createInterface({ input: rekordboxAdapterProcess.stdout });
  lines.on("line", (line) => {
    try {
      publishBridgeMessage(JSON.parse(line));
    } catch {
      updateRekordboxAdapterState("error", `Rekordbox adapter returned invalid JSON: ${line.slice(0, 100)}`);
    }
  });

  let lastError = "";
  rekordboxAdapterProcess.stderr.on("data", (chunk) => {
    lastError = String(chunk).trim();
    if (lastError) console.error(`[rekordbox-adapter] ${lastError}`);
  });
  rekordboxAdapterProcess.on("error", (error) => updateRekordboxAdapterState("error", error.message));
  rekordboxAdapterProcess.on("exit", (code, signal) => {
    rekordboxAdapterProcess = null;
    if (shuttingDown) return;
    if (rekordboxAdapterState.state === "permission-required") return;
    updateRekordboxAdapterState("exited", lastError || `Rekordbox adapter exited with ${signal ? `signal ${signal}` : `code ${code}`}.`);
  });
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);

  if (requestUrl.pathname === "/api/bridge/status") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify({
      ...bridgeState,
      latestLink: latestLinkMessage,
      rekordboxAdapter: rekordboxAdapterState,
      latestRekordbox: latestRekordboxState,
      controllerTransport: controllerTransport.snapshot(),
      recent: recentBridgeMessages,
    }));
    return;
  }

  if (requestUrl.pathname === "/api/bridge/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write("retry: 1000\n\n");
    bridgeClients.add(response);
    let seeded = false;
    for (const deck of controllerTransport.decks) {
      const value = requestUrl.searchParams.get(`deck${deck.deck}`);
      if (value === null) continue;
      seeded = controllerTransport.seed(deck.deck, value === "1") || seeded;
    }
    if (seeded) persistControllerTransport();
    sendEvent(response, "controller-transport", controllerTransport.snapshot());
    for (const message of recentBridgeMessages.filter(isSafeBridgeReplay)) sendEvent(response, "bridge-message", message);
    if (latestLinkMessage) sendEvent(response, "bridge-message", latestLinkMessage);
    if (latestRekordboxState) sendEvent(response, "bridge-message", latestRekordboxState);
    sendEvent(response, "bridge-status", bridgeState);
    sendEvent(response, "rekordbox-adapter-status", rekordboxAdapterState);
    request.on("close", () => bridgeClients.delete(response));
    return;
  }

  if (requestUrl.pathname === "/") {
    response.writeHead(302, { location: "/poc/", "cache-control": "no-store" }).end();
    return;
  }
  const route = requestUrl.pathname;
  const relativeRoute = decodeURIComponent(route).replace(/^\/+/, "");
  const safePath = normalize(join(root, relativeRoute));
  if (safePath !== root && !safePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const routeInfo = await stat(safePath);
    const filePath = routeInfo.isDirectory() ? join(safePath, "index.html") : safePath;
    const info = routeInfo.isDirectory() ? await stat(filePath) : routeInfo;
    const headers = {
      "content-type": mime[extname(filePath)] || "application/octet-stream",
      "cache-control": "no-store",
      "accept-ranges": "bytes",
    };
    const rangeMatch = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
    if (rangeMatch) {
      const start = rangeMatch[1] ? Number(rangeMatch[1]) : 0;
      const end = rangeMatch[2] ? Math.min(Number(rangeMatch[2]), info.size - 1) : info.size - 1;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= info.size) {
        response.writeHead(416, { "content-range": `bytes */${info.size}` }).end();
        return;
      }
      response.writeHead(206, {
        ...headers,
        "content-range": `bytes ${start}-${end}/${info.size}`,
        "content-length": end - start + 1,
      });
      if (request.method === "HEAD") response.end();
      else createReadStream(filePath, { start, end }).pipe(response);
      return;
    }
    response.writeHead(200, { ...headers, "content-length": info.size });
    if (request.method === "HEAD") response.end();
    else createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }).end("Not found");
  }
});

const heartbeat = setInterval(() => {
  for (const response of bridgeClients) response.write(": heartbeat\n\n");
}, 15000);

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  clearInterval(heartbeat);
  for (const response of bridgeClients) response.end();
  bridgeClients.clear();
  server.close();
  const children = [bridgeProcess, rekordboxAdapterProcess].filter(Boolean);
  if (children.length === 0) {
    process.exit(0);
    return;
  }
  let remaining = children.length;
  for (const child of children) {
    child.once("exit", () => {
      remaining -= 1;
      if (remaining === 0) process.exit(0);
    });
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 1500);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

server.listen(port, "127.0.0.1", () => {
  console.log(`Video Sync POC: http://127.0.0.1:${port}/`);
  console.log(`Visual directions: http://127.0.0.1:${port}/studio/visual-directions/`);
  startBridge();
  startRekordboxAdapter();
});
