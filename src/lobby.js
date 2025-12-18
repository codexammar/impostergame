// src/lobby.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

import { encryptJson, decryptJson, randomB64Url } from "./crypto.js";
import { makePeerConnection, waitForIceComplete } from "./webrtc-common.js";
import { compressStringToB64u, decompressStringFromB64u } from "./codec.js";

mountBackground();

// Existing lobby UI
const lobbyInfoEl = document.getElementById("lobbyInfo");
const joinPasteEl = document.getElementById("joinPaste");
const addBtn = document.getElementById("addBtn");
const pasteErrEl = document.getElementById("pasteErr");
const playersEl = document.getElementById("players");
const startGameBtn = document.getElementById("startGameBtn");
const endSessionBtn = document.getElementById("endSessionBtn");

// New invite UI (make sure these exist in lobby HTML)
const inviteBtn = document.getElementById("inviteBtn");
const copyInviteBtn = document.getElementById("copyInviteBtn");
const inviteBlock = document.getElementById("inviteBlock");
const inviteMsgEl = document.getElementById("inviteMsg");
const inviteErrEl = document.getElementById("inviteErr");

// ---- Host-only gate ----
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

// ---- Load session + passphrase ----
let room;
try {
  room = JSON.parse(sessionStorage.getItem("imposter:session"));
} catch {
  room = null;
}

if (!room || room.started) {
  document.body.innerHTML = `
    <main style="padding:24px;font-family:system-ui">
      <h1>Lobby expired</h1>
      <p>This session is no longer active.</p>
    </main>
  `;
  throw new Error("No active lobby session");
}

const pass = sessionStorage.getItem("imposter:pass") || "";
if (!pass) {
  toast("Missing room passphrase. Go back and recreate the room.");
}

// Normalize storage fields
room.players ??= [];
room.usedJoinCodes ??= [];
room.connectedNames ??= [];

function saveRoom() {
  sessionStorage.setItem("imposter:session", JSON.stringify(room));
}

function setPasteErr(msg) {
  if (pasteErrEl) pasteErrEl.textContent = msg || "";
}

function setInviteErr(msg) {
  if (inviteErrEl) inviteErrEl.textContent = msg || "";
}

function show(el) { el?.classList.remove("hidden"); }
function hide(el) { el?.classList.add("hidden"); }

function basePath() {
  // /impostergame/lobby/desktop.html -> /impostergame/
  return location.pathname.replace(/\/lobby\/(desktop\.html|mobile\.html)$/, "/");
}

// Pending invites must live in memory in THIS TAB.
const pending = new Map(); // inviteId -> { pc, dc, used, createdAt, name? }

function render() {
  if (lobbyInfoEl) {
    lobbyInfoEl.textContent = `Players: ${room.players.length} / ${room.max}`;
  }

  if (!playersEl) return;
  playersEl.innerHTML = "";

  for (const p of room.players) {
    const li = document.createElement("li");
    li.textContent = p.status ? `${p.name} — ${p.status}` : p.name;
    playersEl.appendChild(li);
  }
}

render();

// ---- Generate per-player invite (Offer in link hash) ----
inviteBtn?.addEventListener("click", async () => {
  setInviteErr("");
  if (!pass) return setInviteErr("Missing room passphrase.");
  if (room.players.length >= room.max) return setInviteErr("Room is full.");

  try {
    const inviteId = randomB64Url(10);

    const pc = makePeerConnection();
    const dc = pc.createDataChannel("game", { ordered: true });

    // Host sends a confirmation message when channel opens so joiner UI can update.
    dc.onopen = () => {
      try { dc.send(JSON.stringify({ type: "connected" })); } catch {}
      toast("DataChannel opened.");
    };

    dc.onmessage = (msg) => {
      // Later: gameplay messages like endTurn, etc.
      console.log("DC msg:", msg.data);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceComplete(pc);

    const offerSdp = pc.localDescription?.sdp;
    if (!offerSdp) throw new Error("Failed to create offer SDP.");

    // Compress SDP so the invite hash is shorter.
    const offerPacked = await compressStringToB64u(offerSdp);

    pending.set(inviteId, { pc, dc, used: false, createdAt: Date.now() });

    const invitePayload = {
      v: 1,
      sessionId: room.sessionId,
      inviteId,
      createdAt: Date.now(),
      ttlMs: 10 * 60 * 1000,
      max: room.max,
      offer: { type: "offer", sdpPacked: offerPacked },
    };

    const inviteToken = await encryptJson(pass, invitePayload);

    const site = location.origin + basePath(); // ends with /impostergame/
    const joinUrl = `${site}join#${inviteToken}`;

    const msg =
`Here’s your room password: ${pass}
Here’s your link: ${joinUrl}
`;

    if (inviteMsgEl) inviteMsgEl.value = msg;
    show(inviteBlock);
    show(copyInviteBtn);

    toast("Invite generated (single-use). Send it to one player.");
  } catch (e) {
    console.error(e);
    setInviteErr("Failed to generate invite.");
  }
});

copyInviteBtn?.addEventListener("click", async () => {
  const text = (inviteMsgEl?.value || "").trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast("Invite message copied.");
});

// ---- Paste joiner response (Answer) ----
addBtn?.addEventListener("click", async () => {
  setPasteErr("");
  if (!pass) return setPasteErr("Missing room passphrase.");
  if (room.players.length >= room.max) return setPasteErr("Room is full.");

  const raw = (joinPasteEl?.value || "").trim();
  if (!raw) return setPasteErr("Paste a join code.");

  // Reuse prevention
  if (room.usedJoinCodes.includes(raw)) return setPasteErr("Join code already used.");

  let payload;
  try {
    payload = await decryptJson(pass, raw);
  } catch {
    return setPasteErr("Invalid join code (wrong password or corrupted).");
  }

  if (!payload || payload.sessionId !== room.sessionId) {
    return setPasteErr("Join code is from an expired or different session.");
  }

  const inviteId = String(payload.inviteId || "").trim();
  if (!inviteId) return setPasteErr("Join code missing invite id.");

  const entry = pending.get(inviteId);
  if (!entry) return setPasteErr("That invite is unknown/expired. Generate a new invite.");
  if (entry.used) return setPasteErr("That invite was already used. Generate a new invite.");

  const name = String(payload.name || "").trim();
  if (!name) return setPasteErr("Join code missing player name.");
  if (room.connectedNames.includes(name)) return setPasteErr("Join code is from a player already connected.");

  const ans = payload.answer;
  if (!ans?.sdpPacked) return setPasteErr("Join code missing answer data.");

  // Reserve seat + prevent replay
  entry.used = true;
  entry.name = name;

  room.usedJoinCodes.push(raw);
  room.connectedNames.push(name);
  room.players.push({ name, status: "connecting..." });

  saveRoom();
  render();

  try {
    const answerSdp = await decompressStringFromB64u(ans.sdpPacked);
    await entry.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    entry.dc.onopen = () => {
      try { entry.dc.send(JSON.stringify({ type: "connected" })); } catch {}
      const p = room.players.find(x => x.name === name);
      if (p) p.status = "connected";
      saveRoom();
      render();
      toast(`${name} connected.`);
    };

    joinPasteEl.value = "";
    toast(`Accepted ${name}. Waiting for channel…`);
  } catch (e) {
    console.error(e);
    const p = room.players.find(x => x.name === name);
    if (p) p.status = "failed";
    saveRoom();
    render();
    setPasteErr("Failed to apply answer. Ask player to regenerate with a fresh invite.");
  }
});

// ---- Start game ----
startGameBtn?.addEventListener("click", () => {
  if (room.players.length < 1) {
    toast("At least one player required.");
    return;
  }

  room.started = true;
  saveRoom();

  location.href = "../game/";
});

// ---- End session ----
endSessionBtn?.addEventListener("click", () => {
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  sessionStorage.removeItem("imposter:pass");
  toast("Session ended.");
  location.href = "../";
});