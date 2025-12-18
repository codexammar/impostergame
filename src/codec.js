// src/codec.js
// Compress/decompress SDPs to shorten invite/join strings.
// Uses gzip via CompressionStream when available, otherwise falls back to raw base64url.

function b64urlEncodeBytes(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecodeToBytes(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const fixed = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(fixed);
  return new Uint8Array([...bin].map(c => c.charCodeAt(0)));
}

async function streamToBytes(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }

  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export async function compressStringToB64u(s) {
  const bytes = new TextEncoder().encode(s);

  // Preferred: gzip
  if ("CompressionStream" in window) {
    const cs = new CompressionStream("gzip");
    const compressedStream = new Blob([bytes]).stream().pipeThrough(cs);
    const compressedBytes = await streamToBytes(compressedStream);
    return "gz:" + b64urlEncodeBytes(compressedBytes);
  }

  // Fallback: raw utf8
  return "raw:" + b64urlEncodeBytes(bytes);
}

export async function decompressStringFromB64u(tagged) {
  const text = String(tagged || "");
  const idx = text.indexOf(":");
  if (idx === -1) throw new Error("Bad SDP encoding (missing tag).");

  const tag = text.slice(0, idx);
  const data = text.slice(idx + 1);
  const bytes = b64urlDecodeToBytes(data);

  if (tag === "raw") {
    return new TextDecoder().decode(bytes);
  }

  if (tag === "gz") {
    if (!("DecompressionStream" in window)) {
      throw new Error("This browser can't decompress gzip invites.");
    }
    const ds = new DecompressionStream("gzip");
    const decompressedStream = new Blob([bytes]).stream().pipeThrough(ds);
    const outBytes = await streamToBytes(decompressedStream);
    return new TextDecoder().decode(outBytes);
  }

  throw new Error("Unknown SDP encoding tag.");
}