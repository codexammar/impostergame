// src/join.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

import { decryptJson, encryptJson } from "./crypto.js";
import { makePeerConnection, waitForIceComplete } from "./webrtc-common.js";

mountBackground();

const expired = document.getElementById("expired");
const joinForm = document.getElementById("joinForm");

const passEl = document.getElementById("pass");
const nameEl = document.getElementById("name");
const genBtn = document.getElementById("genBtn");
const copyBtn = document.getElementById("copyBtn");

const errEl = document.getElementById("err");
const out = document.getElementById("out");
const codeEl = document.getElementById("code");

const inviteToken = (location.hash || "").slice(1);

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
  if (!invite?.sessionId || !invite?.inviteId || !invite?.offer?.sdp || !invite?.createdAt || !invite?.ttlMs) {
    return setErr("Invite payload invalid.");
  }
  if (now > invite.createdAt + invite.ttlMs) {
    return setErr("Invite expired.");
  }

  // Create PC, accept host offer, generate answer
  pc = makePeerConnection();

  pc.ondatachannel = (e) => {
    const dc = e.channel;
    dc.onopen = () => {
      toast("Connected.");
      sessionStorage.setItem("imposter:role", "player");
      // Later: game page will be driven by host messages via DC.
      // For now, player can stay on join page or navigate manually.
    };
    dc.onmessage = (msg) => console.log("DC:", msg.data);
  };

  try {
    await pc.setRemoteDescription({ type: "offer", sdp: invite.offer.sdp });

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitForIceComplete(pc);

    const answerSdp = pc.localDescription?.sdp;
    if (!answerSdp) return setErr("Failed to create answer.");

    const joinPayload = {
      v: 1,
      sessionId: invite.sessionId,
      inviteId: invite.inviteId,
      name,
      answer: { type: "answer", sdp: answerSdp },
      t: now,
    };

    // Encrypt answer with same passphrase
    const joinCode = await encryptJson(pass, joinPayload);

    codeEl.value = joinCode;
    out?.classList.remove("hidden");
    copyBtn?.classList.remove("hidden");
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