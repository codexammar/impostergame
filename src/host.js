// src/host.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();

const passEl = document.getElementById("pass");
const maxEl = document.getElementById("max");

const createBtn = document.getElementById("createBtn");
const resetBtn = document.getElementById("resetBtn");

const errEl = document.getElementById("err");

function setErr(msg) {
  if (errEl) errEl.textContent = msg || "";
}

function persistRoom(room) {
  // Store a JSON-safe version (no Sets, no RTCPeerConnection objects).
  const safe = {
    sessionId: room.sessionId,
    createdAt: room.createdAt,
    max: room.max,
    players: room.players ?? [],
    usedJoinCodes: room.usedJoinCodes ?? [],
    connectedNames: room.connectedNames ?? [],
    started: false,
  };
  sessionStorage.setItem("imposter:session", JSON.stringify(safe));
}

function endSession() {
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  sessionStorage.removeItem("imposter:pass");
  toast("Session ended.");
}

createBtn?.addEventListener("click", () => {
  setErr("");

  const pass = (passEl?.value || "").trim();
  const max = Number(maxEl?.value);

  if (!pass) return setErr("Room passphrase is required.");
  if (!Number.isFinite(max) || max < 1 || max > 15) {
    return setErr("Max room size must be between 1 and 15.");
  }

  const room = {
    sessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    max,
    players: [],
    usedJoinCodes: [],
    connectedNames: [],
  };

  // Host identity + passphrase are ephemeral (tab/session only)
  sessionStorage.setItem("imposter:role", "host");
  sessionStorage.setItem("imposter:pass", pass);
  persistRoom(room);

  toast("Room created. Sending you to the lobby…");
  location.href = "../lobby/";
});

resetBtn?.addEventListener("click", () => {
  endSession();
});