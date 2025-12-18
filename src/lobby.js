// src/lobby.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

import { encryptJson, decryptJson, randomB64Url } from "./crypto.js";
import { makePeerConnection, waitForIceComplete } from "./webrtc-common.js";
import { compressStringToB64u, decompressStringFromB64u } from "./codec.js";
import { swapPanelFrom } from "./view-swap.js";

mountBackground();
function initLobby() {
  const lobbyInfoEl = document.getElementById("lobbyInfo");
  if (!lobbyInfoEl) return; // OK: inside function

  // prevent double-binding
  if (lobbyInfoEl.dataset.bound === "1") return;
  lobbyInfoEl.dataset.bound = "1";
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

let hostInGame = false;

// ---- Host-only gate ----
const role = sessionStorage.getItem("imposter:role");
if (role !== "host") {
  // If lobby panel isn't even present, silently do nothing
  // (Option A: this file gets loaded everywhere)
  return;
}

// ---- Load session + passphrase ----
let room;
try {
  room = JSON.parse(sessionStorage.getItem("imposter:session"));
} catch {
  room = null;
}

if (!room) return;

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

// Host-only, in-memory game state (DO NOT store in room/sessionStorage)
let gameState = null; 
let hostState = null;
// {
//   phase: "lobby" | "playing" | "voting",
//   order: string[],
//   turnIndex: number,
//   turnName: string,
//   muted: Record<string, boolean>,
//   kicked: Record<string, boolean>,
//   votes: { skip: Record<string, boolean>, startVoting: Record<string, boolean> },
//   chat: Array<{from:string,text:string,t:number}>,
// }
// { realWord, imposterWord, imposterName, assignments: Map(name -> {word, imposter}) }

function toPublicSession() {
  // anything here is safe to share with everyone
  return {
    sessionId: room.sessionId,
    createdAt: room.createdAt,
    max: room.max,
    hostName: room.hostName,
    players: room.players,
    started: true,
  };
}

function publicState() {
  if (!hostState) return null;
  return {
    phase: hostState.phase,
    order: hostState.order,
    turnIndex: hostState.turnIndex,
    turnName: hostState.turnName,
    muted: hostState.muted,
    kicked: hostState.kicked,
    voteCounts: {
      skip: Object.keys(hostState.votes.skip).length,
      startVoting: Object.keys(hostState.votes.startVoting).length,
      needed: Math.max(1, Math.ceil(hostState.order.length / 2)),
    },
    chat: hostState.chat.slice(-80),
  };
}

function handleClientMsg(from, data) {
  if (!hostState) return;

  // If host supermuted them, ignore chat/votes/actions that shouldn't count
  if (hostState.muted[from] && data?.type === "chat") return;

  if (data?.type === "chat") {
    const text = String(data.text || "").trim();
    if (!text) return;
    const line = { from, text, t: Date.now() };
    hostState.chat.push(line);
    // Relay to everyone (including sender is fine; game.js can dedupe if desired)
    broadcast({ type: "chat", ...line });
    return;
  }

  if (data?.type === "vote") {
    const kind = data.kind;
    if (kind === "skip") {
      hostState.votes.skip[from] = true;
      const needed = Math.max(1, Math.ceil(hostState.order.length / 2));
      if (Object.keys(hostState.votes.skip).length >= needed) {
        nextTurn();
      } else {
        broadcastState();
      }
      return;
    }

    if (kind === "startVoting") {
      hostState.votes.startVoting[from] = true;
      const needed = Math.max(1, Math.ceil(hostState.order.length / 2));
      if (Object.keys(hostState.votes.startVoting).length >= needed) {
        startVotingPhase();
      } else {
        broadcastState();
      }
      return;
    }
  }

  if (data?.type === "endTurn") {
    // Only current turn player can end (or host could allow override later)
    if (from === hostState.turnName) nextTurn();
    return;
  }
}

function broadcastState() {
  const state = publicState();
  if (!state) return;
  broadcast({ type: "state", state });
}

function nextTurn() {
  if (!hostState) return;
  const alive = hostState.order.filter(n => !hostState.kicked[n]);
  hostState.order = alive;
  if (hostState.order.length === 0) return;

  hostState.turnIndex = (hostState.turnIndex + 1) % hostState.order.length;
  hostState.turnName = hostState.order[hostState.turnIndex];

  // reset per-turn votes
  hostState.votes.skip = {};
  broadcastState();
}

function startVotingPhase() {
  if (!hostState) return;
  hostState.phase = "voting";
  broadcastState();
}

function endVotingPhase() {
  if (!hostState) return;
  hostState.phase = "playing";
  hostState.votes.startVoting = {};
  broadcastState();
}

function sendToEntry(entry, obj) {
  try {
    if (entry?.dc?.readyState === "open") entry.dc.send(JSON.stringify(obj));
  } catch {}
}

function sendStartToEntry(entry) {
  sendToEntry(entry, { type: "start", session: toPublicSession() });
}

function sendAssignToEntry(entry, playerName) {
  if (!gameState) return;

  const a = gameState.assignments.get(playerName);
  if (!a) return;

  // Everyone gets word. Only imposter gets the extra flag.
  const msg = a.imposter
    ? { type: "assign", word: a.word, imposter: 1 }
    : { type: "assign", word: a.word };

  sendToEntry(entry, msg);
}

function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const entry of pending.values()) {
    try {
      if (entry?.dc?.readyState === "open") entry.dc.send(msg);
    } catch {}
  }
}

function entryByName(name) {
  for (const entry of pending.values()) {
    if (entry?.name === name) return entry;
  }
  return null;
}

function sendToName(name, obj) {
  const entry = entryByName(name);
  if (!entry) return;
  sendToEntry(entry, obj);
}

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

function renderGameRosterIfPresent() {
  const roster = document.getElementById("roster");
  if (!roster) return;

  roster.innerHTML = "";
  for (const p of room.players) {
    const li = document.createElement("li");
    li.textContent = p.status ? `${p.name} — ${p.status}` : p.name;
    roster.appendChild(li);
  }
}

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
        // before the join code is accepted, we don't know who "from" is
        // you can ignore messages here or log them
        // console.log("Pre-name msg:", msg.data);
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
  entry.dc.onmessage = (msg) => {
    let data;
    try { data = JSON.parse(msg.data); } catch { return; }
    handleClientMsg(name, data);
    };

  room.usedJoinCodes.push(raw);
  room.connectedNames.push(name);
  room.players.push({ name, status: "connecting..." });

  saveRoom();
  render();

  try {
    const answerSdp = await decompressStringFromB64u(ans.sdpPacked);
    await entry.pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

    const markConnected = () => {
        const p = room.players.find(x => x.name === name);
        if (p) p.status = "connected";

        saveRoom();
        render();

        if (room.started) renderGameRosterIfPresent();

        toast(`${name} connected.`);
    };

    const onOpen = () => {
    // Let joiner update UI
    try { entry.dc.send(JSON.stringify({ type: "connected" })); } catch {}

    // Mark host UI
    markConnected();

    // 🔥 Sticky start: if host already started the game, push start now
    if (room.started) {
        try { entry.dc.send(JSON.stringify({ type: "start", session: toPublicSession() })); } catch {}
    }
    };

    // Fire when it opens later
    entry.dc.addEventListener("open", onOpen);

    // Or if it's already open right now, run immediately
    if (entry.dc.readyState === "open") onOpen();

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
  if (room.players.length < 2) {
    toast("Need at least 1 player besides the host.");
    return;
  }
  if (hostInGame) return;
  hostInGame = true;

  // 1) Host chooses words (use prompt for now; we can prettify later with showModal)
  const realWord = (prompt("Real word (everyone except imposter):", "park") || "").trim();
  const imposterWord = (prompt("Imposter word (similar but different):", "beach") || "").trim();

  if (!realWord || !imposterWord) {
    toast("Words are required.");
    hostInGame = false;
    return;
  }

  // 2) Pick imposter from current roster
  const names = room.players.map(p => p.name);
  const imposterName = names[Math.floor(Math.random() * names.length)];

  // 3) Build per-player assignments (host-only memory)
  const assignments = new Map();
  for (const n of names) {
    const isImp = n === imposterName;
    assignments.set(n, { imposter: isImp, word: isImp ? imposterWord : realWord });
  }
  gameState = { realWord, imposterWord, imposterName, assignments };
  hostState = {
    phase: "playing",
    order: names.slice(),
    turnIndex: 0,
    turnName: names[0],
    muted: {},
    kicked: {},
    votes: { skip: {}, startVoting: {} },
    chat: [],
  };

  // Persist host assignment so refresh still shows it in game.js
    const mine = assignments.get(room.hostName);
    sessionStorage.setItem("imposter:word", mine?.word || "");
    sessionStorage.setItem("imposter:imposter", mine?.imposter ? "1" : "0");

  // 4) Mark started (public-only)
  room.started = true;
  saveRoom();

  // 5) Public start message to connected players
  broadcast({ type: "start", session: toPublicSession() });
  broadcastState();

  // 6) Private assignments to connected players
  for (const entry of pending.values()) {
    if (!entry?.name) continue;           // entry.name is set when join code is accepted
    sendAssignToEntry(entry, entry.name);
  }

  window.imposterNet = {
    role: "host",
    broadcast,
    sendToName,
    getRoom: () => room,
    getState: () => hostState,
    hostAction: (action) => {
        // action: {type:"kick"|"supermute"|"forceSkip"|"spin"|"startVoting"|"endVoting", target?}
        if (!hostState) return;

        if (action.type === "hostChat") {
            const text = String(action.text || "").trim();
            if (!text) return;
            const line = { from: room.hostName || "Host", text, t: Date.now() };
            hostState.chat.push(line);
            broadcast({ type: "chat", ...line });
            broadcastState();
            return;
        }

        if (action.type === "supermute" && action.target) {
        hostState.muted[action.target] = !hostState.muted[action.target];
        broadcastState();
        return;
        }

        if (action.type === "kick" && action.target) {
        hostState.kicked[action.target] = true;

        // tell them then effectively drop them (we can't truly "disconnect" cleanly yet without pc close)
        sendToName(action.target, { type: "kicked", reason: "Removed by host." });

        // remove from roster/order and advance if needed
        const wasTurn = hostState.turnName === action.target;
        hostState.order = hostState.order.filter(n => n !== action.target);
        if (hostState.turnIndex >= hostState.order.length) hostState.turnIndex = 0;
        hostState.turnName = hostState.order[hostState.turnIndex] || "";

        if (wasTurn) nextTurn();
        broadcastState();
        return;
        }

        if (action.type === "forceSkip") {
        nextTurn();
        return;
        }

        if (action.type === "startVoting") {
        startVotingPhase();
        return;
        }

        if (action.type === "endVoting") {
        endVotingPhase();
        return;
        }

        if (action.type === "spin") {
        // pick first player randomly
        const order = room.players.map(p => p.name).filter(Boolean);
        hostState.order = order;
        hostState.phase = "playing";
        hostState.turnIndex = Math.floor(Math.random() * order.length);
        hostState.turnName = order[hostState.turnIndex];
        hostState.votes.skip = {};
        hostState.votes.startVoting = {};

        broadcast({ type: "spin", landedName: hostState.turnName, t: Date.now() });
        broadcastState();
        return;
        }
    }
    };

  // 7) Swap UI (your existing code)
  (async () => {
    try {
      const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
      const gameFile = isMobileUA ? "../game/mobile.html" : "../game/desktop.html";
      await swapPanelFrom(gameFile);
        await new Promise(r => setTimeout(r, 0));
        initHostGameUI();
    } catch (e) {
      console.error(e);
      toast("Failed to load game UI.");
    }
  })();
});

function initHostGameUI() {
  const gameInfo = document.getElementById("gameInfo");
  const roster = document.getElementById("roster");

  const chatLog = document.getElementById("chatLog");
  const chatInput = document.getElementById("chatInput");
  const sendBtn = document.getElementById("sendBtn");

  const backToLobbyBtn = document.getElementById("backToLobbyBtn");
  const endSessionBtn = document.getElementById("endSessionBtn"); // game view uses this id

  const hostControls = document.getElementById("hostControls");
  const playerControls = document.getElementById("playerControls");

  // Host view: host controls on
  if (hostControls) hostControls.style.display = "";
  if (playerControls) playerControls.style.display = "";

  if (gameInfo) {
    gameInfo.textContent = `You are hosting • Players: ${room.players.length} / ${room.max}`;
  }

  
  renderGameRosterIfPresent();
  // If we already have gameState and hostName, show host assignment
    if (gameState && room.hostName) {
    applyAssignmentToUI(gameState.assignments.get(room.hostName));
    }

  function applyAssignmentToUI(a) {
    const wordText = document.getElementById("wordText");
    const imposterNotice = document.getElementById("imposterNotice");

    if (wordText) wordText.textContent = a?.word ? `Your word: ${a.word}` : "";
    if (imposterNotice) {
        imposterNotice.style.display = a?.imposter ? "" : "none";
    }
  }

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

    // Send through hostState so players receive it too
    window.imposterNet?.hostAction?.({ type: "hostChat", text: msg });
    // Update host UI immediately
    window.imposterNet?.getState && window.imposterNet.getState();
  });

  backToLobbyBtn?.addEventListener("click", async () => {
    // Optional: swap back to lobby UI from file
    const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
    const lobbyFile = isMobileUA ? "../lobby/mobile.html" : "../lobby/desktop.html";
    await swapPanelFrom(lobbyFile);

    // Re-bind lobby UI again (simplest is to reload the page)
    location.reload();
  });

  endSessionBtn?.addEventListener("click", () => {
    sessionStorage.removeItem("imposter:session");
    sessionStorage.removeItem("imposter:role");
    sessionStorage.removeItem("imposter:pass");
    toast("Session ended.");
    location.href = "../";
  });
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
}

initLobby();
window.addEventListener("imposter:panelSwap", initLobby);