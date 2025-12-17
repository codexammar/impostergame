// src/lobby.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();

const lobbyInfoEl = document.getElementById("lobbyInfo");
const joinPasteEl = document.getElementById("joinPaste");
const addBtn = document.getElementById("addBtn");
const pasteErrEl = document.getElementById("pasteErr");
const playersEl = document.getElementById("players");
const startGameBtn = document.getElementById("startGameBtn");
const endSessionBtn = document.getElementById("endSessionBtn");

// ---- Load session from host ----
let session;
try {
  session = JSON.parse(sessionStorage.getItem("imposter:session"));
} catch {
  session = null;
}

if (!session || session.started) {
  document.body.innerHTML = `
    <main style="padding:24px;font-family:system-ui">
      <h1>Lobby expired</h1>
      <p>This session is no longer active.</p>
    </main>
  `;
  throw new Error("No active lobby session");
}
const role = sessionStorage.getItem("imposter:role");
if (role !== "host") {
  document.body.innerHTML = `
    <main style="padding:24px;font-family:system-ui">
      <h1>Lobby is host-only</h1>
      <p>The host controls the lobby. To join, use the invite link the host sent you.</p>
    </main>
  `;
  throw new Error("Not host");
}

session.players ??= [];
session.usedJoinCodes ??= [];
session.connectedNames ??= [];

function save() {
  sessionStorage.setItem("imposter:session", JSON.stringify(session));
}

function setPasteErr(msg) {
  pasteErrEl.textContent = msg || "";
}

function render() {
  lobbyInfoEl.textContent =
    `Players: ${session.players.length} / ${session.max}`;

  playersEl.innerHTML = "";
  for (const p of session.players) {
    const li = document.createElement("li");
    li.textContent = p.status ? `${p.name} — ${p.status}` : p.name;
    playersEl.appendChild(li);
  }
}

render();

// ---- Join code handling ----
addBtn.addEventListener("click", () => {
  setPasteErr("");

  if (session.players.length >= session.max) {
    return setPasteErr("Room is full.");
  }

  const raw = joinPasteEl.value.trim();
  if (!raw) return setPasteErr("Paste a join code.");

  if (session.usedJoinCodes.includes(raw)) {
    return setPasteErr("Join code already used.");
  }

  let payload;
  try {
    payload = JSON.parse(
      decodeURIComponent(escape(atob(raw)))
    );
  } catch {
    return setPasteErr("Invalid join code format.");
  }

  if (payload.invite !== session.inviteToken) {
    return setPasteErr("Join code is from an expired or different session.");
  }

  const name = String(payload.name || "").trim();
  if (!name) return setPasteErr("Join code missing player name.");

  if (session.connectedNames.includes(name)) {
    return setPasteErr("Player already connected.");
  }

  session.usedJoinCodes.push(raw);
  session.connectedNames.push(name);
  session.players.push({ name, status: "queued (WebRTC not wired yet)" });

  joinPasteEl.value = "";
  save();
  render();
  toast(`Added ${name}`);
});

// ---- Start game ----
startGameBtn.addEventListener("click", () => {
  if (session.players.length < 1) {
    toast("At least one player required.");
    return;
  }

  session.started = true;
  save();

  sessionStorage.setItem("imposter:role", "host");
  location.href = "../game/";
});

// ---- End session ----
endSessionBtn.addEventListener("click", () => {
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  toast("Session ended.");
  location.href = "../";
});