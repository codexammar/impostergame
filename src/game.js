// src/game.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();
function initGame() {
  const gameInfo = document.getElementById("gameInfo");
  if (!gameInfo) return; // not on game UI right now

  // IMPORTANT: prevent double-binding if init runs multiple times
  if (gameInfo.dataset.bound === "1") return;
  gameInfo.dataset.bound = "1";

  // ...MOVE the rest of your current game.js code INSIDE here...
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

// Show my assignment if present (host and players)
(function applyStoredAssignment() {
  const wordText = document.getElementById("wordText");
  const imposterNotice = document.getElementById("imposterNotice");

  const word = sessionStorage.getItem("imposter:word") || "";
  const imposter = sessionStorage.getItem("imposter:imposter") === "1";

  if (wordText) wordText.textContent = word ? `Your word: ${word}` : "";
  if (imposterNotice) imposterNotice.style.display = imposter ? "" : "none";
})();

if (!session || !session.started) return;

const role = sessionStorage.getItem("imposter:role") || "player";
const isHost = role === "host";

const net = window.imposterNet || null;

// Player: receive updates from host
if (net?.role === "player" && typeof net.onMsg !== "function") {
  net.onMsg = (data) => {
    if (data?.type === "state") applyState(data.state);
    if (data?.type === "chat") appendChatLine(data.from, data.text);
    if (data?.type === "spin") toast(`Wheel: ${data.landedName} goes first`);
    if (data?.type === "kicked") {
      toast(data.reason || "You were removed.");
      location.href = "../join/";
    }
  };
}

let state = null;

function applyState(s) {
  state = s;
  // update header
  if (gameInfo) {
    const who = state?.turnName ? `Turn: ${state.turnName}` : "No turn";
    const phase = state?.phase ? ` • Phase: ${state.phase}` : "";
    gameInfo.textContent = (isHost ? "You are hosting" : "Connected player") + " • " + who + phase;
  }
  renderRoster();
}
// Host: seed local state immediately from host memory
if (isHost && net?.getState) {
  applyState(net.getState());
}

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

const spinBtn = document.getElementById("spinBtn");
spinBtn?.addEventListener("click", () => {
  if (!isHost) return toast("Only the host can spin.");
  net?.hostAction?.({ type: "spin" });
  if (isHost && net?.getState) applyState(net.getState());
});


// Roster render (selectable)
let selectedName = null;

function renderRoster() {
  if (!roster) return;
  roster.innerHTML = "";

  const players = Array.isArray(session.players) ? session.players : [];
  const turn = state?.turnName || null;
  const mutedMap = state?.muted || {};
  const kickedMap = state?.kicked || {};

  for (const p of players) {
    const name = p?.name ?? "Unknown";
    if (kickedMap[name]) continue;
    const status = p?.status ? ` — ${p.status}` : "";

    const li = document.createElement("li");
    li.style.cursor = "pointer";
    li.style.userSelect = "none";
    li.textContent = name + status;

    if (turn && name === turn) {
      li.style.fontWeight = "900";
      li.style.textDecoration = "underline";
    }

    if (mutedMap[name]) {
      li.style.opacity = "0.6";
      li.title = "Supermuted by host";
    }

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

  // Always show immediately locally
  appendChatLine(isHost ? "Host" : "Me", msg);

  if (isHost) {
    net?.hostAction?.({ type: "hostChat", text: msg });
    if (net?.getState) applyState(net.getState());
    return;
    }

  // Player sends to host
  if (net?.dc?.readyState === "open") {
    net.dc.send(JSON.stringify({ type: "chat", text: msg, t: Date.now() }));
  }
});

chatInput?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendBtn?.click();
});

kickBtn?.addEventListener("click", () => {
  if (!isHost) return;
  if (!selectedName) return toast("Select a player first.");
  if (selectedName === session.hostName) return toast("Kicking yourself is bold. Not supported.");
  net?.hostAction?.({ type: "kick", target: selectedName });
  if (isHost && net?.getState) applyState(net.getState());
});

skipBtn?.addEventListener("click", () => {
  if (!isHost) return;
  net?.hostAction?.({ type: "forceSkip" });
  if (isHost && net?.getState) applyState(net.getState());
});

superMuteBtn?.addEventListener("click", () => {
  if (!isHost) return;
  if (!selectedName) return toast("Select a player first.");
  if (selectedName === session.hostName) return toast("Supermuting the host would be poetic, but no.");
  net?.hostAction?.({ type: "supermute", target: selectedName });
  if (isHost && net?.getState) applyState(net.getState());
});

const endTurnBtn = document.getElementById("endTurnBtn");

endTurnBtn?.addEventListener("click", () => {
  const myName = isHost ? session.hostName : null; // players don't store name currently
  // easiest: allow any player to request; host enforces “only current turn”
  if (isHost) {
    net?.hostAction?.({ type: "forceSkip" });
    if (net?.getState) applyState(net.getState());
    return;
    }
  net?.dc?.readyState === "open" && net.dc.send(JSON.stringify({ type: "endTurn", t: Date.now() }));
});

// Everyone actions (placeholders)
voteSkipBtn?.addEventListener("click", () => {
  if (isHost) return toast("Host can force-skip with Skip Turn.");
  net?.dc?.readyState === "open" && net.dc.send(JSON.stringify({ type: "vote", kind: "skip", t: Date.now() }));
});

voteStartBtn?.addEventListener("click", () => {
  if (isHost) {
    net?.hostAction?.({ type: "startVoting" });
    if (net?.getState) applyState(net.getState());
    return;
  }
  net?.dc?.readyState === "open" && net.dc.send(JSON.stringify({ type: "vote", kind: "startVoting", t: Date.now() }));
});

muteForMeBtn?.addEventListener("click", () => {
  if (!selectedName) return toast("Select a player first.");
  toast(`(placeholder) Muted ${selectedName} for you.`);
});

// Navigation
backToLobbyBtn?.addEventListener("click", () => {
  location.href = isHost ? "../lobby/" : "../join/";
});

endSessionBtn?.addEventListener("click", () => {
  // Host ends session for themselves; later, host broadcasts shutdown.
  sessionStorage.removeItem("imposter:word");
  sessionStorage.removeItem("imposter:imposter");
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
}

initGame();
window.addEventListener("imposter:panelSwap", initGame);
