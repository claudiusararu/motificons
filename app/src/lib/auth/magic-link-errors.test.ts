import { describe, expect, it } from "vitest";
import { magicLinkErrorMessage } from "./magic-link-errors";

describe("magicLinkErrorMessage", () => {
  it("gives the specific bad-link message for INVALID_TOKEN", () => {
    expect(magicLinkErrorMessage("INVALID_TOKEN")).toBe(
      "That sign-in link is invalid or has expired. Enter your email below and we will send you a fresh one.",
    );
  });

  it("falls back to a generic message for any other code", () => {
    expect(magicLinkErrorMessage("new_user_signup_disabled")).toBe(
      "That sign-in link did not work. Request a new one below.",
    );
    expect(magicLinkErrorMessage("failed_to_create_session")).toBe(
      "That sign-in link did not work. Request a new one below.",
    );
  });

  it("falls back to the generic message for an unrecognized/future code", () => {
    expect(magicLinkErrorMessage("SOME_NEW_CODE")).toBe(
      "That sign-in link did not work. Request a new one below.",
    );
  });

  it("is case-sensitive - Better Auth always sends the code in the exact casing above", () => {
    expect(magicLinkErrorMessage("invalid_token")).toBe(
      "That sign-in link did not work. Request a new one below.",
    );
  });
});
