import { describe, expect, it } from "vitest";
import {
  API_KEY_PREFIX,
  deriveKeyDisplayPrefix,
  generateApiKeyPlaintext,
  hashApiKey,
} from "./api-keys";

describe("generateApiKeyPlaintext", () => {
  it("starts with the mk_ prefix", () => {
    expect(generateApiKeyPlaintext().startsWith(API_KEY_PREFIX)).toBe(true);
  });

  it("is mk_ followed by 64 lowercase hex chars", () => {
    const key = generateApiKeyPlaintext();
    expect(key).toMatch(/^mk_[0-9a-f]{64}$/);
  });

  it("is different on every call", () => {
    const a = generateApiKeyPlaintext();
    const b = generateApiKeyPlaintext();
    expect(a).not.toBe(b);
  });
});

describe("deriveKeyDisplayPrefix", () => {
  it("keeps mk_ plus the first 8 hex chars", () => {
    const key = "mk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(deriveKeyDisplayPrefix(key)).toBe("mk_01234567");
  });

  it("is deterministic for the same plaintext", () => {
    const key = generateApiKeyPlaintext();
    expect(deriveKeyDisplayPrefix(key)).toBe(deriveKeyDisplayPrefix(key));
  });

  it("never contains the full secret", () => {
    const key = generateApiKeyPlaintext();
    const prefix = deriveKeyDisplayPrefix(key);
    expect(prefix.length).toBeLessThan(key.length);
    expect(key.startsWith(prefix)).toBe(true);
  });
});

describe("hashApiKey", () => {
  it("returns a 64-char lowercase hex SHA-256 digest", async () => {
    const hash = await hashApiKey("mk_test");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is deterministic for the same plaintext", async () => {
    const key = generateApiKeyPlaintext();
    const a = await hashApiKey(key);
    const b = await hashApiKey(key);
    expect(a).toBe(b);
  });

  it("differs for different plaintexts", async () => {
    const a = await hashApiKey(generateApiKeyPlaintext());
    const b = await hashApiKey(generateApiKeyPlaintext());
    expect(a).not.toBe(b);
  });

  it("never equals the plaintext it was derived from", async () => {
    const key = generateApiKeyPlaintext();
    const hash = await hashApiKey(key);
    expect(hash).not.toBe(key);
  });
});
