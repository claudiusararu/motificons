import { describe, expect, it } from "vitest";
import {
  DOWNLOAD_TOKEN_TTL_MS,
  mintDownloadToken,
  verifyDownloadToken,
} from "./download-token";

/**
 * The signed download token, exercised as the thing it actually is: a string
 * that a stranger holds and that the server has to decide about.
 *
 * Everything here uses the pure mint/verify pair, with the secret and the
 * clock passed in - the env-reading wrappers around them add no rules of
 * their own, and the rules are the subject.
 */

const SECRET = "test-signing-secret-not-a-real-one";
const NOW = 1_800_000_000_000;

const CLAIMS = { collectionId: "col_1", workspaceId: "ws_1" };

function base64url(value: string): string {
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The same HMAC the library computes, re-implemented here on purpose: it
    lets these tests forge a CORRECTLY SIGNED token with claims of their own
    choosing, which is the only way to prove the shape and expiry checks do
    any work rather than hiding behind the signature check. */
async function signedToken(payload: unknown, secret = SECRET): Promise<string> {
  const encoded = base64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  let binary = "";
  for (const byte of new Uint8Array(signature)) binary += String.fromCharCode(byte);
  return `${encoded}.${base64url(binary)}`;
}

describe("mintDownloadToken", () => {
  it("produces two base64url parts, safe to sit in a query string unencoded", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    expect(token.split(".")).toHaveLength(2);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("signs, it does not encrypt - the claims are readable, just not forgeable", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    const payload = JSON.parse(atob(token.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/")));
    expect(payload).toEqual({
      collectionId: "col_1",
      workspaceId: "ws_1",
      expiresAt: NOW + DOWNLOAD_TOKEN_TTL_MS,
    });
  });
});

describe("verifyDownloadToken", () => {
  it("returns the claims for a fresh token on the collection it was minted for", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    expect(await verifyDownloadToken(token, SECRET, { collectionId: "col_1" }, NOW)).toEqual({
      collectionId: "col_1",
      workspaceId: "ws_1",
      expiresAt: NOW + DOWNLOAD_TOKEN_TTL_MS,
    });
  });

  it("is still good one millisecond before it expires, and dead at it", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    const expiry = NOW + DOWNLOAD_TOKEN_TTL_MS;

    expect(
      await verifyDownloadToken(token, SECRET, { collectionId: "col_1" }, expiry - 1),
    ).not.toBeNull();
    expect(
      await verifyDownloadToken(token, SECRET, { collectionId: "col_1" }, expiry),
    ).toBeNull();
  });

  it("refuses a token minted for one collection on another collection's URL", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    expect(await verifyDownloadToken(token, SECRET, { collectionId: "col_2" }, NOW)).toBeNull();
  });

  it("refuses a payload edited after signing, even to a later expiry", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    const signature = token.split(".")[1]!;
    const encoded = base64url(
      JSON.stringify({
        collectionId: "col_1",
        workspaceId: "ws_1",
        expiresAt: NOW + DOWNLOAD_TOKEN_TTL_MS * 1000,
      }),
    );

    expect(
      await verifyDownloadToken(`${encoded}.${signature}`, SECRET, { collectionId: "col_1" }, NOW),
    ).toBeNull();
  });

  it("refuses a payload edited to point at someone else's workspace", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    const signature = token.split(".")[1]!;
    const encoded = base64url(
      JSON.stringify({
        collectionId: "col_1",
        workspaceId: "ws_someone_else",
        expiresAt: NOW + DOWNLOAD_TOKEN_TTL_MS,
      }),
    );

    expect(
      await verifyDownloadToken(`${encoded}.${signature}`, SECRET, { collectionId: "col_1" }, NOW),
    ).toBeNull();
  });

  it("refuses a token signed with a different secret", async () => {
    const token = await mintDownloadToken(CLAIMS, SECRET, NOW);
    expect(
      await verifyDownloadToken(token, "some-other-secret", { collectionId: "col_1" }, NOW),
    ).toBeNull();
  });

  it("refuses junk without throwing, whatever shape the junk is", async () => {
    const expected = { collectionId: "col_1" };
    for (const junk of [
      null,
      "",
      "not-a-token",
      "one.two.three",
      ".",
      "a.",
      ".b",
      `${btoa("{}")}.deadbeef`,
      `${btoa("not json at all")}.deadbeef`,
    ]) {
      expect(await verifyDownloadToken(junk, SECRET, expected, NOW)).toBeNull();
    }
  });

  it("refuses a validly signed token whose claims are the wrong shape", async () => {
    /* Signed with the real secret, so the signature check passes and the
       shape check is the only thing left to catch these. A missing workspace
       id must never read as an empty-string workspace the route would then
       go and query with. */
    for (const payload of [
      null,
      "a string",
      { collectionId: "col_1", expiresAt: NOW + 1000 },
      { collectionId: "col_1", workspaceId: "", expiresAt: NOW + 1000 },
      { collectionId: "", workspaceId: "ws_1", expiresAt: NOW + 1000 },
      { collectionId: "col_1", workspaceId: "ws_1" },
      { collectionId: "col_1", workspaceId: "ws_1", expiresAt: "later" },
      { collectionId: 7, workspaceId: "ws_1", expiresAt: NOW + 1000 },
    ]) {
      const token = await signedToken(payload);
      expect(
        await verifyDownloadToken(token, SECRET, { collectionId: "col_1" }, NOW),
      ).toBeNull();
    }
  });

  it("accepts a validly signed token built by hand - the forgeries above fail on their claims, not on the test's own signing", async () => {
    const token = await signedToken({
      collectionId: "col_1",
      workspaceId: "ws_1",
      expiresAt: NOW + 1000,
    });
    expect(
      await verifyDownloadToken(token, SECRET, { collectionId: "col_1" }, NOW),
    ).not.toBeNull();
  });
});
