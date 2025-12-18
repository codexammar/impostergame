// src/join.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

import { decryptJson, encryptJson } from "./crypto.js";
import { makePeerConnection, waitForIceComplete } from "./webrtc-common.js";
import { compressStringToB64u, decompressStringFromB64u } from "./codec.js";
import { swapPanelFrom } from "./view-swap.js";

mountBackground();

function initJoin() {
  const joinForm = document.getElementById("joinForm");
  if (!joinForm) return; // OK: inside function

  // prevent double-binding
  if (joinForm.dataset.bound === "1") return;
  joinForm.dataset.bound = "1";
const expired = document.getElementById("expired");

const passEl = document.getElementById("pass");
const nameEl = document.getElementById("name");
const genBtn = document.getElementById("genBtn");
const copyBtn = document.getElementById("copyBtn");

const errEl = document.getElementById("err");
const out = document.getElementById("out");
const codeEl = document.getElementById("code");
const waitingEl = document.getElementById("waiting");

const inviteToken = (location.hash || "").slice(1);
let started = false;

let pc = null;

if (!inviteToken) {
  expired?.classList.remove("hidden");
  joinForm?.classList.add("hidden");
}

function setErr(msg) {
  if (!errEl) return;
  errEl.textContent = msg || "";
}

genBtn?.addEventListener("click", async () => {
  setErr("");
  if (!inviteToken) return;

  const pass = (passEl?.value || "").trim();
  const name = (nameEl?.value || "").trim();

  if (!pass) return setErr("Room password is required.");
  if (!name) return setErr("Name is required.");

  let invite;
  try {
    invite = await decryptJson(pass, inviteToken);
  } catch {
    return setErr("Wrong password or corrupted invite.");
  }

  const now = Date.now();

  // IMPORTANT: lobby now sends offer.sdpPacked (not offer.sdp)
  if (
    !invite?.sessionId ||
    !invite?.inviteId ||
    !invite?.offer?.sdpPacked ||
    !invite?.createdAt ||
    !invite?.ttlMs
  ) {
    return setErr("Invite payload invalid.");
  }

  if (now > invite.createdAt + invite.ttlMs) {
    return setErr("Invite expired.");
  }

  pc = makePeerConnection();

  pc.ondatachannel = (e) => {
    const dc = e.channel;

    dc.onopen = () => {
        window.imposterNet = { role:"player", dc };
      // Channel open may happen before host sends its confirmation message.
      toast("Handshake complete. Waiting for host…");
      if (waitingEl) waitingEl.textContent = "Handshake complete. Waiting for host…";
      sessionStorage.setItem("imposter:role", "player");
    };

    dc.onmessage = (msg) => {
        try {
            const data = JSON.parse(msg.data);
            // Forward other message types to game layer if present
            if (window.imposterNet?.role === "player" && typeof window.imposterNet.onMsg === "function") {
                window.imposterNet.onMsg(data);
            }
            if (data?.type === "connected") {
            toast("Connected! You’re in.");
            if (waitingEl) waitingEl.textContent = "Connected. Waiting for host to start…";
            return;
            }

            if (data?.type === "start") {
            // Seed local sessionStorage so game.js doesn't reject the player
            if (started) return;
            started = true;

            const session = (data.session || {});
            session.started = true;

            // Go to game
            (async () => {
            try {
                const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
                const gameFile = isMobileUA ? "../game/mobile.html" : "../game/desktop.html";

                await swapPanelFrom(gameFile);
                await new Promise(r => setTimeout(r, 0));

                // Seed session so your game UI can render roster if you want
                sessionStorage.setItem("imposter:session", JSON.stringify(session));
                sessionStorage.setItem("imposter:role", "player");

                initPlayerGameUI(session);
            } catch (e) {
                console.error(e);
                toast("Failed to load game UI.");
            }
            })();
            return;
            }

            if (data?.type === "assign") {
                const wordText = document.getElementById("wordText");
                const imposterNotice = document.getElementById("imposterNotice");

                if (wordText) wordText.textContent = data.word ? `Your word: ${data.word}` : "";
                if (imposterNotice) {
                    imposterNotice.style.display = data.imposter ? "" : "none";
                }

                // Optional: persist so a refresh can still show the word (not secure, but convenient)
                sessionStorage.setItem("imposter:word", data.word || "");
                sessionStorage.setItem("imposter:imposter", data.imposter ? "1" : "0");

                return;
            }
        } catch {
            // ignore non-json for now
        }
    };
  };

  try {
    const offerSdp = await decompressStringFromB64u(invite.offer.sdpPacked);
    await pc.setRemoteDescription({ type: "offer", sdp: offerSdp });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);

    const answerSdp = pc.localDescription?.sdp;
    if (!answerSdp) return setErr("Failed to create answer.");

    const answerPacked = await compressStringToB64u(answerSdp);

    const joinPayload = {
      v: 1,
      sessionId: invite.sessionId,
      inviteId: invite.inviteId,
      name,
      answer: { type: "answer", sdpPacked: answerPacked },
      t: now,
    };

    const joinCode = await encryptJson(pass, joinPayload);

    codeEl.value = joinCode;
    out?.classList.remove("hidden");
    copyBtn?.classList.remove("hidden");

    if (waitingEl) waitingEl.textContent = "Waiting for host to connect…";
    toast("Response generated. Send it to the host.");
  } catch (e) {
    console.error(e);
    setErr("Failed to generate response. Try again.");
  }
});

copyBtn?.addEventListener("click", async () => {
  const text = (codeEl?.value || "").trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast("Join code copied.");
});

function initPlayerGameUI(session) {
  const gameInfo = document.getElementById("gameInfo");
  const roster = document.getElementById("roster");
  const hostControls = document.getElementById("hostControls");
  const playerControls = document.getElementById("playerControls");
  const backToLobbyBtn = document.getElementById("backToLobbyBtn");
const endSessionBtn = document.getElementById("endSessionBtn");

backToLobbyBtn?.addEventListener("click", () => {
  // simplest: reload the original join page UI
  location.reload();
});

endSessionBtn?.addEventListener("click", () => {
  sessionStorage.removeItem("imposter:session");
  sessionStorage.removeItem("imposter:role");
  toast("Session ended.");
  location.href = "../";
});

  if (hostControls) hostControls.style.display = "none";
  if (playerControls) playerControls.style.display = "";

  if (gameInfo) gameInfo.textContent = "Connected player • Waiting for host updates";

  if (roster) {
    roster.innerHTML = "";
    for (const p of session.players || []) {
      const li = document.createElement("li");
      li.textContent = p.status ? `${p.name} — ${p.status}` : p.name;
      roster.appendChild(li);
    }
  }
}
}
initJoin();
window.addEventListener("imposter:panelSwap", initJoin);