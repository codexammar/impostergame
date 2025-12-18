// src/host.js
import { mountBackground } from "../assets/bg.js";
import { toast } from "../assets/ui.js";

mountBackground();

function initHost() {
  const createBtn = document.getElementById("createBtn");
  if (!createBtn) return; // OK: inside a function

  // IMPORTANT: prevent double-binding if init runs multiple times
  if (createBtn.dataset.bound === "1") return;
  createBtn.dataset.bound = "1";

  const passEl = document.getElementById("pass");
  const hostNameEl = document.getElementById("hostName");
  const maxEl = document.getElementById("max");
  const resetBtn = document.getElementById("resetBtn");
  const errEl = document.getElementById("err");

  function setErr(msg) {
    if (errEl) errEl.textContent = msg || "";
  }

  function persistRoom(room) {
    const safe = {
      sessionId: room.sessionId,
      createdAt: room.createdAt,
      max: room.max,
      hostName: room.hostName,
      players: room.players ?? [],
      usedJoinCodes: room.usedJoinCodes ?? [],
      connectedNames: room.connectedNames ?? [],
      started: room.started ?? false,
    };
    sessionStorage.setItem("imposter:session", JSON.stringify(safe));
  }

  function endSession() {
    sessionStorage.removeItem("imposter:session");
    sessionStorage.removeItem("imposter:role");
    sessionStorage.removeItem("imposter:pass");
    toast("Session ended.");
  }

  createBtn.addEventListener("click", () => {
    setErr("");

    const pass = (passEl?.value || "").trim();
    const hostName = (hostNameEl?.value || "").trim();
    const max = Number(maxEl?.value);

    if (!pass) return setErr("Room passphrase is required.");
    if (!hostName) return setErr("Host name is required.");
    if (!Number.isFinite(max) || max < 1 || max > 15) return setErr("Max room size must be between 1 and 15.");

    const room = {
      sessionId: crypto.randomUUID(),
      createdAt: Date.now(),
      max,
      hostName,
      players: [{ name: hostName, status: "connected" }],
      usedJoinCodes: [],
      connectedNames: [hostName],
      started: false,
    };

    sessionStorage.setItem("imposter:role", "host");
    sessionStorage.setItem("imposter:pass", pass);
    persistRoom(room);

    toast("Room created. Sending you to the lobby…");
    location.href = "../lobby/";
  });

  resetBtn?.addEventListener("click", endSession);
}

initHost();
window.addEventListener("imposter:panelSwap", initHost);
