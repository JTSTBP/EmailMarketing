import https from "node:https";
import dns from "node:dns/promises";
import { isIP } from "node:net";
import { assert, id } from "./security";
import type { Evidence } from "./types";
export function publicIPv4(ip: string) {
  if (isIP(ip) !== 4) return false;
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 2) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0)
  );
}
// Pin DNS resolution to a validated public IPv4 address. Re-validate redirects. No cookies,
// credentials, browser automation, private networks or LinkedIn login-wall access.
async function fetchPublic(url: string, depth = 0): Promise<string> {
  assert(depth < 4, "Too many redirects");
  const u = new URL(url);
  assert(
    u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === "443"),
    "Only public HTTPS pages are supported",
  );
  assert(
    !/(^|\.)linkedin\.com$/i.test(u.hostname),
    "Paste accessible LinkedIn profile text with its source URL instead",
  );
  const addresses = await dns.lookup(u.hostname, { all: true, family: 4 });
  assert(
    addresses.length && addresses.every((a) => publicIPv4(a.address)),
    "Private or reserved network address blocked",
  );
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        headers: {
          "User-Agent": "JobsTerritoryResearch/1.0 (+manual research request)",
          Accept: "text/html,text/plain",
        },
        lookup: ((_host: any, _opts: any, cb: any) => {
          if (_opts?.all)
            cb(null, [{ address: addresses[0].address, family: 4 }]);
          else cb(null, addresses[0].address, 4);
        }) as any,
        timeout: 10000,
      },
      (res) => {
        if (
          res.statusCode &&
          [301, 302, 303, 307, 308].includes(res.statusCode) &&
          res.headers.location
        ) {
          res.resume();
          fetchPublic(new URL(res.headers.location, u).href, depth + 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (
          res.statusCode !== 200 ||
          !/text\/(html|plain)/.test(res.headers["content-type"] || "")
        ) {
          res.resume();
          reject(new Error("Public page is unavailable or restricted"));
          return;
        }
        let size = 0,
          body = "";
        res.setEncoding("utf8");
        res.on("data", (part) => {
          size += Buffer.byteLength(part);
          if (size > 1_000_000) req.destroy(new Error("Page is too large"));
          else body += part;
        });
        res.on("end", () => resolve(body));
        res.on("error", reject);
      },
    );
    req.on("timeout", () =>
      req.destroy(new Error("Research request timed out")),
    );
    req.on("error", reject);
  });
}
export async function collectSource(
  url: string,
  kind: Evidence["kind"],
): Promise<Evidence> {
  const html = await fetchPublic(url);
  const clean = html
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  assert(
    clean.length > 30,
    "No readable public content; paste an excerpt instead",
  );
  return {
    id: id(),
    url,
    publishedAt: undefined,
    researchedAt: new Date().toISOString(),
    summary: clean.slice(0, 3500),
    kind,
    verified: false,
  };
}
