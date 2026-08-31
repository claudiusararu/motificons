/**
 * Outbound email, behind an interface.
 *
 * Two implementations: `consoleMailer` (dev - logs the link instead of
 * sending) and `resendMailer` (prod - Resend's HTTP API, plain `fetch`, so it
 * works unmodified in a Worker). `resolveMailer()` picks between them by
 * whether `RESEND_API_KEY` is set, so nothing else in the app needs to know
 * which one is active.
 */

import {
  LOGO_CHIP_CONTENT_ID,
  LOGO_CHIP_FILENAME,
  LOGO_CHIP_PNG_BASE64,
} from "./mailer-assets";

export interface Mailer {
  sendMagicLink(email: string, url: string): Promise<void>;
}

/**
 * Dev/no-provider-configured mailer: logs the sign-in link to the console
 * instead of sending mail. Also the fallback if `RESEND_API_KEY` is unset in
 * a deploy that has not been given one yet - a missing key should not 500 the
 * sign-in page, and the link is still reachable from the Worker log.
 */
export const consoleMailer: Mailer = {
  async sendMagicLink(email, url) {
    console.log(`\n[auth] Magic link for ${email}:\n  ${url}\n`);
  },
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM = "Motificons <hello@motificons.app>";

/** Resend's HTTP API, called directly with `fetch` - no SDK, so nothing
    Node-only ends up in the Worker bundle. Fire-and-forget by design: no
    retry queue, no delivery tracking. A failed send throws, which the
    magic-link plugin lets bubble up to the sign-in form's error state
    (AuthCard.tsx already renders whatever message reaches it).

    The logo chip rides along as a CID inline attachment (`content_id` -
    confirmed supported on Resend's raw REST API, snake_case field name,
    2026-08-09: https://resend.com/docs/api-reference/emails/send-email and
    https://resend.com/docs/dashboard/emails/attachments) rather than a
    hosted URL, so the email is correct with zero deploy/hosting dependency
    - `magicLinkHtml`'s `cid:` reference and this attachment share the same
    `LOGO_CHIP_CONTENT_ID` constant so they cannot drift apart. */
function resendMailer(apiKey: string): Mailer {
  return {
    async sendMagicLink(email, url) {
      const response = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: FROM,
          to: email,
          subject: "Sign in to Motificons",
          html: magicLinkHtml(url),
          text: magicLinkText(url),
          attachments: [
            {
              filename: LOGO_CHIP_FILENAME,
              content: LOGO_CHIP_PNG_BASE64,
              content_id: LOGO_CHIP_CONTENT_ID,
            },
          ],
        }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(
          `Resend send failed (${response.status}): ${body.slice(0, 300)}`,
        );
      }
    },
  };
}

export async function resolveMailer(): Promise<Mailer> {
  const { env } = (await import("cloudflare:workers")) as unknown as {
    env?: { RESEND_API_KEY?: string };
  };
  return env?.RESEND_API_KEY ? resendMailer(env.RESEND_API_KEY) : consoleMailer;
}

/* ---------------------------------------------------------------------- *
 * Template - minimal, on-brand, inline-styled (email clients ignore
 * <style> blocks and classes). Colors match the design tokens exactly:
 * --ink #183153, --primary #ffd43b, --canvas #f0f1f3.
 * ---------------------------------------------------------------------- */

/** Exported for mailer.test.ts - the only way to verify an email template
    renders email-safe markup (no SVG element, no external/data: image)
    without actually sending mail through Resend. */
export function magicLinkHtml(url: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Sign in to Motificons</title>
  </head>
  <body style="margin:0;padding:32px 16px;background-color:#f0f1f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;background-color:#ffffff;border-radius:12px;">
            <tr>
              <td style="padding:40px 40px 32px;">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <!-- Email-safe logo chip: Gmail (and most webmail clients)
                         strip SVG markup entirely from message bodies, which
                         is why the original version rendered as an empty
                         yellow square in Gmail - no SVG
                         element anywhere. This is the bolt glyph (the same
                         one from Logo.astro's rotating set), pre-baked into
                         a 112x112 PNG and delivered as a CID inline
                         attachment - see resendMailer's doc comment for why
                         CID over a hosted URL. Displayed at 28x28, same
                         logical size as the site header's chip (proportional
                         to the 20px wordmark next to it) - the 112px asset
                         is not a "2x" of this display size, it is 4x, purely
                         for extra crispness, no visual size change. The td
                         keeps its own yellow/border/radius styling as the
                         fallback appearance for clients that block images
                         outright; the img is sized to fully cover it, so a
                         The PNG draws the ENTIRE chip - background, border,
                         corners, hard shadow - so the td stays completely
                         unstyled: one border source, nothing to overlap.
                         Canvas is 34x36 (34px chip + 2px shadow) at 4x. -->
                    <td style="vertical-align:middle;" valign="middle"><img src="cid:${LOGO_CHIP_CONTENT_ID}" width="34" height="36" alt="Motificons" style="display:block;width:34px;height:36px;color:#183153;font-size:12px;font-weight:700;" /></td>
                    <td style="padding-left:10px;font-size:20px;font-weight:700;color:#183153;">Motificons</td>
                  </tr>
                </table>

                <h1 style="margin:32px 0 12px;font-size:24px;line-height:30px;font-weight:700;color:#183153;">Sign in to Motificons</h1>
                <p style="margin:0 0 28px;font-size:16px;line-height:24px;color:#616d8a;">
                  Click the button below to sign in. This link expires in 5 minutes and works once.
                </p>

                <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="background-color:#ffd43b;border:2px solid #183153;border-radius:12px;" align="center">
                      <a href="${url}" style="display:inline-block;padding:15px 24px;font-size:16px;font-weight:700;color:#183153;text-decoration:none;">Sign in</a>
                    </td>
                  </tr>
                </table>

                <p style="margin:28px 0 0;font-size:14px;line-height:20px;color:#616d8a;">
                  Or paste this link into your browser:<br />
                  <a href="${url}" style="color:#146ebe;word-break:break-all;">${url}</a>
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 40px;border-top:1px solid #e9ebee;font-size:13px;line-height:18px;color:#616d8a;">
                Didn't request this? You can ignore this email - no account changes without clicking the link above.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function magicLinkText(url: string): string {
  return [
    "Sign in to Motificons",
    "",
    "Click the link below to sign in. It expires in 5 minutes and works once.",
    "",
    url,
    "",
    "Didn't request this? You can ignore this email - no account changes without clicking the link above.",
  ].join("\n");
}
