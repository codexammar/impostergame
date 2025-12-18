// src/view-swap.js
export async function swapPanelFrom(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);

  const html = await res.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const incomingPanel = doc.querySelector(".panel");
  if (!incomingPanel) throw new Error(`No .panel found in ${url}`);

  const currentPanel = document.querySelector(".panel");
  if (!currentPanel) throw new Error("No .panel found on current page");

  // Replace only the contents, keep the existing panel node (and background etc.)
  currentPanel.innerHTML = incomingPanel.innerHTML;
  window.dispatchEvent(new Event("imposter:panelSwap"));
}