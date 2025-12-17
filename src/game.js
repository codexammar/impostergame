// src/game.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();

const gameInfo = document.getElementById("gameInfo");
const roster = document.getElementById("roster");

const hostControls = document.getElementById("hostControls");
const playerControls = document.getElementById("playerControls");

const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const sendBtn = document.getElementById("sendBtn");

const backToLobbyBtn = document.getElementById("backToLobbyBtn");
const endSessionBtn = document.getElementById("endSessionBtn");

const kickBtn = document.getElementById("kickBtn");
const skipBtn = document.getElementById("skipBtn");
const superMuteBtn = document.getElementById("superMuteBtn");

const voteStartBtn = document.getElementById("voteStartBtn");
const voteSkipBtn = document.getElementById("voteSkipBtn");
const muteForMeBtn = document.getElementById("muteForMeBtn");

let session;
try {
  session = JSON.parse(sessionStorage.getItem("imposter:session"));
} catch {
  session = null;
}

if (!session || !session.started) {
  document.body.innerHTML = `
    <main style="padding:24px;font-family:system-ui">
      <h1>Game not available</h1>
      <p>This game session isn’t active. Return to the lobby.</p>
    </main>
  `;
  throw new Error("No active game session");
}

const role = sessionStorage.getItem("imposter:role") || "player";
const isHost = role === "host";

// Toggle host-only UI
if (hostControls) hostControls.style.display = isHost ? "" : "none";
// Player controls are visible to both; keep them present
if (playerControls) playerControls.style.display = "";

// Basic header
if (gameInfo) {
  gameInfo.textContent = isHost
    ? `You are hosting • Players: ${session.players?.length ?? 0} / ${session.max}`
    : `Connected player • Waiting for host updates`;
}

// Roster render (selectable)
let selectedName = null;

function renderRoster() {
  if (!roster) return;
  roster.innerHTML = "";

  const players = Array.isArray(session.players) ? session.players : [];
  for (const p of players) {
    const name = p?.name ?? "Unknown";
    const status = p?.status ? ` — ${p.status}` : "";

    const li = document.createElement("li");
    li.style.cursor = "pointer";
    li.style.userSelect = "none";
    li.textContent = name + status;

    li.addEventListener("click", () => {
      selectedName = name;
      toast(`Selected: ${selectedName}`);
    });

    roster.appendChild(li);
  }
}

renderRoster();

// Local-only chat placeholder
function appendChatLine(who, text) {
  if (!chatLog) return;
  const line = document.createElement("div");
  line.style.margin = "6px 0";
  line.innerHTML = `<strong>${escapeHtml(who)}:</strong> ${escapeHtml(text)}`;
  chatLog.appendChild(line);
  chatLog.scrollTop = chatLog.scrollHeight;
}

sendBtn?.addEventListener("click", () => {
  const msg = (chatInput?.value || "").trim();
  if (!msg) return;
  chatInput.value = "";
  appendChatLine(isHost ? "Host" : "Me", msg);
  // Later: send to host via WebRTC. Host validates + broadcasts.
});

chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn?.click();
});

// Host-only placeholder actions
kickBtn?.addEventListener("click", () => {
  if (!isHost) return;
  if (!selectedName) return toast("Select a player first.");
  toast(`(placeholder) Kick: ${selectedName}`);
});

skipBtn?.addEventListener("click", () => {
  if (!isHost) return;
  toast("(placeholder) Skip turn requested.");
});

superMuteBtn?.addEventListener("click", () => {
  if (!isHost) return;
  if (!selectedName) return toast("Select a player first.");
  toast(`(placeholder) Supermute: ${selectedName}`);
});

// Everyone actions (placeholders)
voteStartBtn?.addEventListener("click", () => toast("(placeholder) Voted to start voting."));
voteSkipBtn?.addEventListener("click", () => toast("(placeholder) Voted to skip turn."));
muteForMeBtn?.addEventListener("click", () => {
  if (!selectedName) return toast("Select a player first.");
  toast(`(placeholder) Muted ${selectedName} for you.`);
});

// Navigation
backToLobbyBtn?.addEventListener("click", () => {
  location.href = "../lobby/";
});

endSessionBtn?.addEventListener("click", () => {
  // Host ends session for themselves; later, host broadcasts shutdown.
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  toast("Session ended.");
  location.href = "../";
});

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}