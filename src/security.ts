import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
  randomUUID,
} from "node:crypto";
import { config } from "./config";
export const id = () => randomUUID();
export const normalizeEmail = (s: string) => s.trim().toLowerCase();
export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function assert(ok: unknown, message: string, status = 400): asserts ok {
  if (!ok) throw new AppError(status, message);
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function seal(value: string, key = config.encryptionKey) {
  const iv = randomBytes(12),
    c = createCipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  const data = Buffer.concat([c.update(value, "utf8"), c.final()]);
  return `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}
export function unseal(value: string, key = config.encryptionKey) {
  const [iv, tag, data] = value.split(".").map((x) => Buffer.from(x, "base64"));
  const d = createDecipheriv("aes-256-gcm", Buffer.from(key, "base64"), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString();
}
export function sign(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string,
  secret = config.crmSecret,
) {
  return createHmac("sha256", secret)
    .update([method, path, timestamp, nonce, body].join("\n"))
    .digest("hex");
}
export const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export const htmlPreview = (s: string) =>
  s
    .split(/\n\n+/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
