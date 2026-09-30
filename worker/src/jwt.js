// HS256 JWT for Kling's access-key / secret-key authentication.
import { createHmac } from "node:crypto";

const b64url = (buf) => Buffer.from(buf).toString("base64url");

export function signJwt(accessKey, secretKey, { now = Math.floor(Date.now() / 1000), ttl = 1800 } = {}) {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iss: accessKey, exp: now + ttl, nbf: now - 5 }));
  const sig = createHmac("sha256", secretKey).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
