// assets/bg.js
const WORDS = [
  "imposter","alibi","vote","whisper","mask","signal","cipher","room",
  "role","suspicion","trust","turn","lobby","code","join","host",
  "echo","shadow","truth","doubt","silence","pattern"
];

function makeMicrotext(targetChars = 1800) {  // was 5000
  let out = "";
  while (out.length < targetChars) {
    const w = WORDS[(Math.random() * WORDS.length) | 0];
    out += w + (Math.random() < 0.14 ? "\n" : " ");
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
  if (!bg.hasAttribute("data-words")) {
    bg.setAttribute("data-words", makeMicrotext());
  }
}