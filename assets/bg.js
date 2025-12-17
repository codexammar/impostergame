// assets/bg.js

const WORDS = [
  "imposter", "alibi", "vote", "whisper", "mask", "signal", "cipher", "room",
  "role", "suspicion", "trust", "turn", "lobby", "code", "join", "host",
  "echo", "shadow", "tell", "truth", "doubt", "silence", "blink", "pattern"
];

function makeMicrotext(targetChars = 5000) {
  let out = "";
  while (out.length < targetChars) {
    const w = WORDS[(Math.random() * WORDS.length) | 0];
    out += w + (Math.random() < 0.18 ? "\n" : " ");
  }
  return out;
}

export function mountBackground() {
  let bg = document.querySelector(".bg");
  if (!bg) {
    bg = document.createElement("div");
    bg.className = "bg";
    document.body.prepend(bg);
  }
  bg.setAttribute("data-words", makeMicrotext());
}
