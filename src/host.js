// src/host.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();

const passEl = document.getElementById("pass");
const maxEl = document.getElementById("max");

const createBtn = document.getElementById("createBtn");
const inviteBtn = document.getElementById("inviteBtn");
const copyInviteBtn = document.getElementById("copyInviteBtn");
const resetBtn = document.getElementById("resetBtn");

const errEl = document.getElementById("err");

const inviteBlock = document.getElementById("inviteBlock");
const inviteMsgEl = document.getElementById("inviteMsg");

const joinPasteEl = document.getElementById("joinPaste");
const addBtn = document.getElementById("addBtn");
const pasteErrEl = document.getElementById("pasteErr");

const playersEl = document.getElementById("players");

function roomForStorage(r) {
  return {
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    max: r.max,
    inviteToken: r.inviteToken,
    players: r.players,
    usedJoinCodes: [...r.usedJoinCodes],
    connectedNames: [...r.connectedNames],
  };
}

function persistRoom() {
  if (!room) return;
  sessionStorage.setItem("imposter:session", JSON.stringify(roomForStorage(room)));
}

// Ephemeral session state (dies when tab closes)
let room = null;

function setErr(msg) { if (errEl) errEl.textContent = msg || ""; }
function setPasteErr(msg) { if (pasteErrEl) pasteErrEl.textContent = msg || ""; }

function hide(el) { el?.classList.add("hidden"); }
function show(el) { el?.classList.remove("hidden"); }

function basePath() {
  // /impostergame/host/desktop.html -> /impostergame/
  const p = location.pathname;
  return p.replace(/\/host\/(desktop\.html|mobile\.html)$/, "/");
}

function b64urlEncodeString(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToString(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const fixed = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(fixed);
  const bytes = new Uint8Array([...bin].map(c => c.charCodeAt(0)));
  return new TextDecoder().decode(bytes);
}

function renderPlayers() {
  if (!playersEl) return;
  playersEl.innerHTML = "";
  if (!room) return;

  for (const p of room.players) {
    const li = document.createElement("li");
    li.textContent = `${p.name} — ${p.status}`;
    playersEl.appendChild(li);
  }
}

function endSession() {
  room = null;
  setErr("");
  setPasteErr("");
  hide(inviteBlock);
  inviteMsgEl && (inviteMsgEl.value = "");

  hide(inviteBtn);
  hide(copyInviteBtn);
  hide(addBtn);
  hide(resetBtn);

  renderPlayers();
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  toast("Session ended.");
}

createBtn?.addEventListener("click", () => {
  setErr("");
  setPasteErr("");

  const pass = (passEl?.value || "").trim();
  const max = Number(maxEl?.value);

  if (!pass) return setErr("Room passphrase is required.");
  if (!Number.isFinite(max) || max < 1 || max > 15) return setErr("Max room size must be between 1 and 15.");

  // Create ephemeral room
  room = {
    sessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    max,
    // This “inviteToken” is a placeholder for the future encrypted invite payload.
    // For now, it lets us enforce “different/expired session” checks.
    inviteToken: b64urlEncodeString(JSON.stringify({ v: 1, sid: crypto.randomUUID(), t: Date.now(), max })),
    usedJoinCodes: new Set(),
    connectedNames: new Set(),
    players: []
  };

  show(inviteBtn);
  show(resetBtn);
  hide(inviteBlock);
  hide(copyInviteBtn);
  hide(addBtn);

  renderPlayers();
  persistRoom();
  sessionStorage.setItem("imposter:role", "host");
  toast("Room created. Now generate an invite.");
});

inviteBtn?.addEventListener("click", () => {
  setErr("");
  if (!room) return setErr("Create a room first.");

  const pass = (passEl?.value || "").trim();
  if (!pass) return setErr("Room passphrase is required.");

  // Join URL format must match your spec exactly:
  // <SITE>/impostergame/join#<ENCRYPTED_INVITE>
  const site = location.origin + basePath(); // ends with /impostergame/
  const joinUrl = `${site}join#${room.inviteToken}`;

  const msg =
`Here’s your room password: ${pass}
Here’s your link: ${joinUrl}
`;

  inviteMsgEl.value = msg;
  show(inviteBlock);
  show(copyInviteBtn);
  show(addBtn);

  persistRoom();
  toast("Invite generated.");
});

copyInviteBtn?.addEventListener("click", async () => {
  if (!inviteMsgEl?.value) return;
  await navigator.clipboard.writeText(inviteMsgEl.value);
  toast("Invite message copied.");
});

resetBtn?.addEventListener("click", () => {
  endSession();
});

addBtn?.addEventListener("click", () => {
  setPasteErr("");
  if (!room) return setPasteErr("Create a room first.");
  if (room.players.length >= room.max) return setPasteErr("Room is full.");

  const raw = (joinPasteEl?.value || "").trim();
  if (!raw) return setPasteErr("Paste a join code.");

  // 1) Reject join code already used
  if (room.usedJoinCodes.has(raw)) return setPasteErr("Join code already used.");

  // Decode join code (placeholder format).
  // Current join page creates: base64(JSON({v, invite, name, t}))
  let payload;
  try {
    const json = b64urlDecodeToString(raw);
    payload = JSON.parse(json);
  } catch {
    // Some base64 variants will fail; try normal base64 as fallback
    try {
      const json = decodeURIComponent(escape(atob(raw)));
      payload = JSON.parse(json);
    } catch {
      return setPasteErr("Invalid join code format.");
    }
  }

  // 2) Expired/different session check (placeholder)
  // Real implementation will decrypt and validate sessionId + ttl using AES-GCM + PBKDF2.
  if (!payload || payload.invite !== room.inviteToken) {
    return setPasteErr("Join code is from an expired or different session.");
  }

  const name = String(payload.name || "").trim();
  if (!name) return setPasteErr("Join code missing player name.");

  // 3) Join code from player already connected
  if (room.connectedNames.has(name)) {
    return setPasteErr("Join code is from a player already connected.");
  }

  // 4) Room full
  if (room.players.length >= room.max) {
    return setPasteErr("Room is full.");
  }

  // Accept
  room.usedJoinCodes.add(raw);
  room.connectedNames.add(name);
  room.players.push({ name, status: "queued (WebRTC not wired yet)" });

  joinPasteEl.value = "";
  renderPlayers();
  persistRoom();
  toast(`Added ${name}.`);
});