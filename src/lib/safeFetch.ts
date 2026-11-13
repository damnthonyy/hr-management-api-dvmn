import dns, { type LookupAddress, type LookupOptions } from "dns";
import https from "https";
import net from "net";
import axios, { AxiosError } from "axios";

/**
 * Fetching user-supplied URLs from the server (SSRF protection).
 *
 * - https only, default port, no credentials in the URL;
 * - the destination must be a public address. The check runs in the
 *   agent's DNS lookup, i.e. on the IP actually connected to, so DNS
 *   rebinding (public IP at validation time, private IP at connection
 *   time) does not work;
 * - redirects are followed manually and every hop is re-validated;
 * - bounded size and time, no proxy.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export class RemoteFileTooLargeError extends Error {
  constructor() {
    super("Remote file is too large");
    this.name = "RemoteFileTooLargeError";
  }
}

// Two separate lists: a BlockList also matches IPv4 addresses against IPv6
// rules through their IPv4-mapped form, so ::ffff:0:0/96 would block all IPv4.
const blockedV4 = new net.BlockList();
const blockedV6 = new net.BlockList();
// IPv4: "this" network, private, CGNAT, loopback, link-local (cloud
// metadata 169.254.169.254), IETF/test/benchmark ranges, multicast, reserved.
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedV4.addSubnet(address, prefix, "ipv4");
}
// IPv6: unspecified, loopback, IPv4-mapped/translated (could reach any IPv4),
// NAT64, discard, documentation, ULA, link-local, multicast.
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["::ffff:0:0", 96],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedV6.addSubnet(address, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return !blockedV4.check(address, "ipv4");
  if (family === 6) return !blockedV6.check(address, "ipv6");
  return false;
}

/** Syntactic checks, before any network access. */
export function assertSafeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("Invalid URL");
  }
  if (url.protocol !== "https:") throw new UnsafeUrlError("Only https URLs are allowed");
  if (url.username || url.password) throw new UnsafeUrlError("Credentials in URLs are not allowed");
  if (url.port !== "" && url.port !== "443") throw new UnsafeUrlError("Only the default https port is allowed");
  // The WHATWG parser already normalizes numeric hosts (2130706433, 0x7f.1)
  // to dotted IPv4, and keeps IPv6 literals in brackets.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) !== 0 && !isPublicAddress(host)) {
    throw new UnsafeUrlError("Destination address is not allowed");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw new UnsafeUrlError("Destination address is not allowed");
  }
  return url;
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/** dns.lookup replacement that refuses non-public addresses. */
export function safeLookup(hostname: string, options: LookupOptions, callback: LookupCallback): void {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      callback(error, []);
      return;
    }
    const list = addresses as LookupAddress[];
    if (list.length === 0 || list.some((entry) => !isPublicAddress(entry.address))) {
      callback(new UnsafeUrlError("Destination address is not allowed"), []);
      return;
    }
    if (options.all) {
      callback(null, list);
      return;
    }
    callback(null, list[0].address, list[0].family);
  });
}

const agent = new https.Agent({ lookup: safeLookup as unknown as https.AgentOptions["lookup"] });

const MAX_REDIRECTS = 3;

export interface RemoteFile {
  status: number;
  contentType: string;
  body: Buffer;
  finalUrl: string;
}

export async function fetchRemoteFile(rawUrl: string, options: { maxBytes: number; timeoutMs?: number }): Promise<RemoteFile> {
  let url = assertSafeUrl(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    let response;
    try {
      response = await axios.get<ArrayBuffer>(url.toString(), {
        httpsAgent: agent,
        proxy: false,
        maxRedirects: 0,
        timeout: options.timeoutMs ?? 10_000,
        maxContentLength: options.maxBytes,
        maxBodyLength: options.maxBytes,
        responseType: "arraybuffer",
        validateStatus: () => true,
      });
    } catch (error) {
      const cause = (error as AxiosError).cause ?? error;
      if (cause instanceof UnsafeUrlError) throw cause;
      if (error instanceof AxiosError && /maxContentLength/.test(error.message)) {
        throw new RemoteFileTooLargeError();
      }
      throw error;
    }

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && typeof location === "string") {
      url = assertSafeUrl(new URL(location, url).toString());
      continue;
    }

    return {
      status: response.status,
      contentType: String(response.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase(),
      body: Buffer.from(response.data),
      finalUrl: url.toString(),
    };
  }
  throw new UnsafeUrlError("Too many redirects");
}
