// src/crypto.js

function b64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const fixed = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(fixed);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

export function randomB64Url(nBytes = 16) {
  const b = new Uint8Array(nBytes);
  crypto.getRandomValues(b);
  return b64urlEncode(b);
}

async function deriveKey(passphrase, saltB64u, iterations = 150_000) {
  const salt = b64urlDecode(saltB64u);
  const enc = new TextEncoder();

  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encryptJson(passphrase, obj, opts = {}) {
  const salt = opts.salt ?? randomB64Url(16);
  const iv = opts.iv ?? randomB64Url(12);
  const iterations = opts.iterations ?? 150_000;

  const key = await deriveKey(passphrase, salt, iterations);
  const pt = new TextEncoder().encode(JSON.stringify(obj));

  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: b64urlDecode(iv) },
    key,
    pt
  );

  const wrapper = {
    v: 1,
    it: iterations,
    salt,
    iv,
    ct: b64urlEncode(new Uint8Array(ctBuf)),
  };

  return b64urlEncode(new TextEncoder().encode(JSON.stringify(wrapper)));
}

export async function decryptJson(passphrase, tokenB64u) {
  const wrapperJson = new TextDecoder().decode(b64urlDecode(tokenB64u));
  const wrapper = JSON.parse(wrapperJson);

  if (!wrapper || wrapper.v !== 1 || !wrapper.salt || !wrapper.iv || !wrapper.ct) {
    throw new Error("Bad encrypted payload");
  }

  const key = await deriveKey(passphrase, wrapper.salt, wrapper.it ?? 150_000);
  const ct = b64urlDecode(wrapper.ct);

  const ptBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64urlDecode(wrapper.iv) },
    key,
    ct
  );

  return JSON.parse(new TextDecoder().decode(new Uint8Array(ptBuf)));
}