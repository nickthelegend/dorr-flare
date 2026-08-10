import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function keyFromMaterial(material: string): Buffer {
  return createHash("sha256").update(material, "utf8").digest();
}

/** AES-256-GCM seal: hex(iv12 | tag16 | ciphertext). */
export function sealJson(obj: unknown, keyMaterial: string): string {
  const iv = randomBytes(12);
  const key = keyFromMaterial(keyMaterial);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("hex");
}

export function openJson(blobHex: string, keyMaterial: string): unknown {
  const buf = Buffer.from(blobHex, "hex");
  if (buf.length < 28) throw new Error("invalid sealed payload");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const key = keyFromMaterial(keyMaterial);
  const dec = createDecipheriv("aes-256-gcm", key, iv);
  dec.setAuthTag(tag);
  const plain = Buffer.concat([dec.update(enc), dec.final()]);
  return JSON.parse(plain.toString("utf8"));
}
