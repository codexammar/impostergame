// assets/ui.js

export function showModal({ title, html }) {
  document.body.classList.add("modal-open");

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop";
  backdrop.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <h2>${escapeHtml(title)}</h2>
      <div class="modal-body">${html}</div>
      <div class="row">
        <button class="btn" data-close>Close</button>
      </div>
    </div>
  `;

  function close() {
    document.body.classList.remove("modal-open");
    backdrop.remove();
  }

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.querySelector("[data-close]").addEventListener("click", close);

  document.body.appendChild(backdrop);
  return backdrop;
}

export function toast(message, ms = 2400) {
  const el = document.createElement("div");
  el.textContent = message;
  el.style.position = "fixed";
  el.style.left = "50%";
  el.style.bottom = "22px";
  el.style.transform = "translateX(-50%)";
  el.style.background = "rgba(10, 14, 22, 0.92)";
  el.style.border = "1px solid rgba(255,255,255,0.14)";
  el.style.borderRadius = "12px";
  el.style.padding = "10px 12px";
  el.style.color = "rgba(233,238,246,0.92)";
  el.style.boxShadow = "0 18px 55px rgba(0,0,0,0.55)";
  el.style.maxWidth = "min(720px, 92vw)";
  el.style.zIndex = "9999";
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}