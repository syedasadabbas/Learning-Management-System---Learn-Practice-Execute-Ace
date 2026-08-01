// =============================================================================
// CONTRACT TEST — pins this verifier to the Next app's minter.
// -----------------------------------------------------------------------------
// ./token.ts is a DELIBERATE DUPLICATE of the verify half of
// `src/lib/live-classes/realtime-token.ts`. The duplication is argued in that
// file's header; this test is the safety net that makes it survivable.
//
// THE VECTORS BELOW WERE PRODUCED BY THE NEXT APP'S MINTER, not by this package.
// They are literal strings, so a change to either implementation that alters the
// wire format fails here rather than in production — where the symptom would be
// "nobody can join any class" with two correct-looking codebases.
//
// To regenerate after an intentional format change, from the repository root:
//
//   npx tsx -e "import {mintRealtimeToken} from './src/lib/live-classes/realtime-token'; \
//     console.log(mintRealtimeToken({userId:42,role:'student',classId:7, \
//     secret:'contract-test-secret-32-characters!!',now:1770000000000, \
//     ttlMs:120000,nonce:'fixed-nonce'}))"
//
// and paste the result. Do not regenerate it by calling this package's own
// minter — that would make the test tautological, which is the one thing it
// must not be.
// =============================================================================

import { describe, expect, it } from "vitest";

import { mintRealtimeTokenForTests, verifyRealtimeToken } from "./token";

const SECRET = "contract-test-secret-32-characters!!";
const ISSUED_AT = 1_770_000_000_000;
const EXPIRES_AT = ISSUED_AT + 120_000;

/** Minted by src/lib/live-classes/realtime-token.ts. See the header. */
const APP_MINTED_TOKEN =
  "eyJ1Ijo0MiwiciI6InN0dWRlbnQiLCJjIjo3LCJlIjoxNzcwMDAwMTIwMDAwLCJuIjoiZml4ZWQtbm9uY2UifQ" +
  ".rzyK_7ByhvkMc9vtgMc7-j860qIWhqmtTfc6vDayowc";

describe("cross-package token contract", () => {
  it("verifies a token minted by the Next app", () => {
    const result = verifyRealtimeToken(APP_MINTED_TOKEN, SECRET, ISSUED_AT + 1_000);

    expect(result).toEqual({
      ok: true,
      claims: {
        userId: 42,
        role: "student",
        classId: 7,
        expiresAtMs: EXPIRES_AT,
        nonce: "fixed-nonce",
      },
    });
  });

  it("produces byte-identical output from this package's minter", () => {
    // If this fails, the two encoders have diverged even though verification
    // might still pass — which would mean the test above is checking a format
    // this package can no longer produce, and the next divergence goes unnoticed.
    const local = mintRealtimeTokenForTests({
      userId: 42,
      role: "student",
      classId: 7,
      secret: SECRET,
      expiresAtMs: EXPIRES_AT,
      nonce: "fixed-nonce",
    });

    expect(local).toBe(APP_MINTED_TOKEN);
  });

  it("rejects the app-minted token once it has expired", () => {
    expect(verifyRealtimeToken(APP_MINTED_TOKEN, SECRET, EXPIRES_AT)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
});
