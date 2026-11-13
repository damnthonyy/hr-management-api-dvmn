import crypto from "crypto";

export function randomToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Math.random is predictable: codes are drawn from the CSPRNG. */
export function numericCode(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += crypto.randomInt(0, 10).toString();
  }
  return out;
}
