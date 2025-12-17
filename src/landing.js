// src/landing.js

import { mountBackground } from "../assets/bg.js";
import { showModal, toast } from "../assets/ui.js";

mountBackground();

const joinBtn = document.getElementById("joinBtn");
const howBtn = document.getElementById("howBtn");

joinBtn?.addEventListener("click", () => {
  // If user somehow has an invite hash on the base page, forward it to /join/
  const hash = location.hash || "";

  if (hash && hash.length > 1) {
    const base = location.pathname.endsWith("/")
      ? location.pathname
      : location.pathname + "/";
    // base should be /impostergame/ on pages
    location.href = base + "join/" + hash;
    return;
  }

  // Otherwise, do NOT take them to join UI. This respects your rule.
  toast("Joining requires a host invite link.");
  showModal({
    title: "How to join",
    html: `
      <p><strong>You can’t join from here.</strong> The host must send you a join link after creating a session.</p>
      <ol>
        <li>Open the host’s link.</li>
        <li>Enter the room password + your in-game name.</li>
        <li>Generate your response string (join code).</li>
        <li>Send that join code back to the host.</li>
        <li>Wait while the host connects you.</li>
      </ol>
      <p>If you don’t have a link yet, ask your host.</p>
    `
  });
});

howBtn?.addEventListener("click", () => {
  showModal({
    title: "How to Play",
    html: `
      <p>This is a peer-to-peer party game. The host runs the session. Players connect directly to the host.</p>
      <ul>
        <li><strong>Host:</strong> creates a room, sets password + size, shares invite link.</li>
        <li><strong>Players:</strong> open invite link, enter name, generate join code, send it back.</li>
        <li><strong>No servers:</strong> everything happens in the browser via WebRTC data channels.</li>
      </ul>
      <p>When the host tab closes, the session ends — and old links become useless.</p>
    `
  });
});