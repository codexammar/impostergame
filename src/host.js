// src/host.js

import { mountBackground } from "../assets/bg.js";
import { toast, showModal } from "../assets/ui.js";

import { encryptJson, decryptJson, randomB64Url } from "./crypto.js";
import { makePeerConnection, waitForIceComplete } from "./webrtc-common.js";

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

function setErr(msg) { if (errEl) errEl.textContent = msg || ""; }
function setPasteErr(msg) { if (pasteErrEl) pasteErrEl.textContent = msg || ""; }
function hide(el) { el?.classList.add("hidden"); }
function show(el) { el?.classList.remove("hidden"); }

function basePath() {
  // /impostergame/host/desktop.html -> /impostergame/
  return location.pathname.replace(/\/host\/(desktop\.html|mobile\.html)$/, "/");
}

function roomForStorage(r) {
  return {
    sessionId: r.sessionId,
    createdAt: r.createdAt,
    max: r.max,
    ttlMs: r.ttlMs,
    players: r.players,
    usedJoinCodes: [...r.usedJoinCodes],
    connectedNames: [...r.connectedNames],
    // We intentionally do NOT store pending RTCPeerConnections in sessionStorage.
  };
}

function persistRoom() {
  if (!room) return;
  sessionStorage.setItem("imposter:session", JSON.stringify(roomForStorage(room)));
}

// Ephemeral runtime state
let room = null;

// Pending invites that host generated but haven’t been answered yet.
// inviteId -> { pc, dc, createdAt, used:false }
const pending = new Map();

function renderPlayers() {
  if (!playersEl) return;
  playersEl.innerHTML = "";
  if (!room) return;

  for (const p of room.players) {
    const li = document.createElement("li");
    li.textContent = p.status ? `${p.name} — ${p.status}` : p.name;
    playersEl.appendChild(li);
  }
}

function endSession() {
  room = null;
  pending.clear();

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

  room = {
    sessionId: crypto.randomUUID(),
    createdAt: Date.now(),
    ttlMs: 30 * 60 * 1000, // 30 minutes
    max,
    usedJoinCodes: new Set(),
    connectedNames: new Set(),
    players: []
  };

  show(inviteBtn);
  show(resetBtn);
  hide(inviteBlock);
  hide(copyInviteBtn);
  show(addBtn);

  renderPlayers();
  persistRoom();
  sessionStorage.setItem("imposter:role", "host");
  toast("Room created. Generate an invite for each player.");
});

inviteBtn?.addEventListener("click", async () => {
  setErr("");
  if (!room) return setErr("Create a room first.");

  const pass = (passEl?.value || "").trim();
  if (!pass) return setErr("Room passphrase is required.");

  if (room.players.length >= room.max) {
    return setErr("Room is full.");
  }

  // Create a fresh per-player invite: PC + DC + Offer
  const inviteId = randomB64Url(10);
  const pc = makePeerConnection();

  // Host creates DataChannel (since host is offerer)
  const dc = pc.createDataChannel("game", { ordered: true });

  dc.onopen = () => {
    toast("A player connected.");
  };

  dc.onmessage = (msg) => {
    // Later: gameplay messages (endTurn, etc.)
    console.log("DC msg:", msg.data);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIceComplete(pc);

  const offerSdp = pc.localDescription?.sdp;
  if (!offerSdp) return setErr("Failed to create offer.");

  pending.set(inviteId, { pc, dc, createdAt: Date.now(), used: false });

  const invitePayload = {
    v: 1,
    sessionId: room.sessionId,
    inviteId,
    createdAt: Date.now(),
    ttlMs: 10 * 60 * 1000, // 10 min per invite link
    max: room.max,
    offer: { type: "offer", sdp: offerSdp },
  };

  const inviteToken = await encryptJson(pass, invitePayload);

  const site = location.origin + basePath(); // ends with /impostergame/
  const joinUrl = `${site}join#${inviteToken}`;

  const msg =
`Here’s your room password: ${pass}
Here’s your link: ${joinUrl}
`;

  inviteMsgEl.value = msg;
  show(inviteBlock);
  show(copyInviteBtn);

  toast("Invite generated (single-use). Send it to one player.");
});

copyInviteBtn?.addEventListener("click", async () => {
  if (!inviteMsgEl?.value) return;
  await navigator.clipboard.writeText(inviteMsgEl.value);
  toast("Invite message copied.");
});

resetBtn?.addEventListener("click", endSession);

addBtn?.addEventListener("click", async () => {
  setPasteErr("");
  if (!room) return setPasteErr("Create a room first.");
  if (room.players.length >= room.max) return setPasteErr("Room is full.");

  const raw = (joinPasteEl?.value || "").trim();
  if (!raw) return setPasteErr("Paste a join code.");

  if (room.usedJoinCodes.has(raw)) return setPasteErr("Join code already used.");

  const pass = (passEl?.value || "").trim();
  if (!pass) return setPasteErr("Room passphrase is required.");

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

  const pendingInvite = pending.get(inviteId);
  if (!pendingInvite) return setPasteErr("That invite is unknown/expired. Generate a new invite.");
  if (pendingInvite.used) return setPasteErr("That invite was already used. Generate a new invite.");

  const name = String(payload.name || "").trim();
  if (!name) return setPasteErr("Join code missing player name.");
  if (room.connectedNames.has(name)) return setPasteErr("Join code is from a player already connected.");

  const ans = payload.answer;
  if (!ans?.sdp) return setPasteErr("Join code missing answer SDP.");

  // Mark used so it can't be replayed
  pendingInvite.used = true;
  room.usedJoinCodes.add(raw);
  room.connectedNames.add(name);

  // Add player as "connecting"; DC onopen will flip to connected soon
  room.players.push({ name, status: "connecting..." });
  renderPlayers();
  persistRoom();

  try {
    await pendingInvite.pc.setRemoteDescription({ type: "answer", sdp: ans.sdp });

    // When DC is open, set status to connected
    pendingInvite.dc.onopen = () => {
      const p = room.players.find(x => x.name === name);
      if (p) p.status = "connected";
      renderPlayers();
      persistRoom();
      toast(`${name} connected.`);
    };

    // Store DC reference for gameplay later
    // For now we just keep it on the pending entry.
    pendingInvite.name = name;

    joinPasteEl.value = "";
    toast(`Accepted ${name}. Waiting for channel…`);
  } catch (e) {
    console.error(e);
    const p = room.players.find(x => x.name === name);
    if (p) p.status = "failed";
    renderPlayers();
    persistRoom();
    setPasteErr("Failed to apply answer. Ask player to regenerate with a fresh invite.");
  }
});