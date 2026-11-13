import { describe, it, expect, vi, afterEach } from "vitest";
import dns from "dns";
import { assertSafeUrl, fetchRemoteFile, isPublicAddress, safeLookup, UnsafeUrlError } from "../src/lib/safeFetch";

describe("SSRF guard", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "::",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "fd00::1",
    "fe80::1",
    "64:ff9b::7f00:1",
  ])("treats %s as non-public", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])("treats %s as public", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["http://example.com/file.pdf", /https/],
    ["https://user:pass@example.com/file.pdf", /Credentials/],
    ["https://example.com:8443/file.pdf", /port/],
    ["https://127.0.0.1/file.pdf", /not allowed/],
    ["https://2130706433/file.pdf", /not allowed/],
    ["https://0x7f.0.0.1/file.pdf", /not allowed/],
    ["https://[::1]/file.pdf", /not allowed/],
    ["https://[::ffff:127.0.0.1]/file.pdf", /not allowed/],
    ["https://169.254.169.254/latest/meta-data/", /not allowed/],
    ["https://localhost/file.pdf", /not allowed/],
    ["https://metadata.google.internal/computeMetadata/v1/", /not allowed/],
    ["file:///etc/passwd", /https/],
    ["not a url", /Invalid/],
  ])("rejects %s", (url, message) => {
    expect(() => assertSafeUrl(url)).toThrow(message);
  });

  it("accepts a regular https URL", () => {
    expect(assertSafeUrl("https://files.example.com/a/b.pdf?x=1").hostname).toBe("files.example.com");
  });

  it("refuses hostnames that resolve to a private address", async () => {
    await new Promise<void>((resolve) => {
      safeLookup("localhost", {}, (error) => {
        expect(error).toBeInstanceOf(UnsafeUrlError);
        resolve();
      });
    });
  });

  it("blocks DNS rebinding: the check applies to the address actually connected to", async () => {
    // The name passes the syntactic checks, then resolves to the metadata IP.
    vi.spyOn(dns, "lookup").mockImplementation(((
      _hostname: string,
      _options: unknown,
      callback: (error: null, addresses: Array<{ address: string; family: number }>) => void
    ) => {
      callback(null, [{ address: "169.254.169.254", family: 4 }]);
    }) as unknown as typeof dns.lookup);

    await expect(fetchRemoteFile("https://rebind.attacker.example/latest/meta-data/", { maxBytes: 1024 })).rejects.toThrow(
      UnsafeUrlError
    );
  });
});
