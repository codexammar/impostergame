// src/join.js

import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

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

const inviteHash = (location.hash || "").slice(1);

// Hard gate: no hash => not a real invite
if (!inviteHash) {
  expired?.classList.remove("hidden");
  joinForm?.classList.add("hidden");
}

function setErr(msg) {
  if (!errEl) return;
  errEl.textContent = msg || "";
}

genBtn?.addEventListener("click", () => {
  setErr("");

  if (!inviteHash) return;

  const pass = (passEl?.value || "").trim();
  const name = (nameEl?.value || "").trim();

  if (!pass) return setErr("Room password is required.");
  if (!name) return setErr("Name is required.");

  // Placeholder join code for now.
  // Next phase: decrypt invite with PBKDF2+AES-GCM, create WebRTC answer, encrypt into join code.
  const payload = {
    v: 1,
    invite: inviteHash,
    name,
    t: Date.now()
  };

  const joinCode = btoa(unescape(encodeURIComponent(JSON.stringify(payload)))).replace(/=+$/g, "");
  codeEl.value = joinCode;

  out?.classList.remove("hidden");
  copyBtn?.classList.remove("hidden");
});

copyBtn?.addEventListener("click", async () => {
  const text = (codeEl?.value || "").trim();
  if (!text) return;
  await navigator.clipboard.writeText(text);
  toast("Join code copied.");
});