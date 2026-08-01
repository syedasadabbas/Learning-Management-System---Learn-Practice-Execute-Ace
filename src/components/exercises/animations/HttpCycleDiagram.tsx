"use client";

// =============================================================================
// HTTP REQUEST/RESPONSE CYCLE EXPLAINER
// -----------------------------------------------------------------------------
// Owner: interactive-exercises stream.
//
// Week 1 lecture 1 ("How the Web Works") and week 4 lecture 3 ("Deployment &
// Going Live") are the same five steps read in opposite directions: a student who
// can name the five points can also say WHERE a broken deploy failed — a DNS
// record that does not resolve is a different fix from a 404 on a stylesheet.
// The packet animates along the wire so request and response are visibly two
// separate trips, which is the part a static box-and-arrow diagram loses.
// =============================================================================

import { motion } from "framer-motion";

import { stepTransition } from "@/lib/exercises/reduced-motion";
import { ExplainerShell, type ExplainerStep } from "../ExplainerShell";

const STEPS: readonly ExplainerStep[] = [
  {
    label: "You type a URL",
    caption:
      "The browser splits the URL into scheme (https), host (example.com) and path (/index.html). Nothing has left your machine yet.",
    code: "https://example.com/index.html",
  },
  {
    label: "DNS turns the host into an address",
    caption:
      "A DNS lookup resolves example.com to an IP address. A site that 'does not exist' minutes after deploying is almost always this step — the record has not propagated yet.",
    code: "example.com → 203.0.113.42",
  },
  {
    label: "The request travels to the server",
    caption:
      "The browser opens a TLS connection and sends a request: a method, a path, and headers. GET means 'give me this'; no body is sent.",
    code: "GET /index.html HTTP/1.1\nHost: example.com",
  },
  {
    label: "The server responds with a status code",
    caption:
      "The response carries a status code and a body. 200 is OK, 301 moved, 404 not found, 500 the server broke. A missing stylesheet after deployment is a 404 on that file, not a failure of the page.",
    code: "HTTP/1.1 200 OK\nContent-Type: text/html",
  },
  {
    label: "The browser renders",
    caption:
      "HTML is parsed into the DOM; every <link> and <script> it finds starts this whole cycle again for that file. That is why a page can arrive but look unstyled.",
    code: '<link rel="stylesheet" href="styles.css">  → one more round trip',
  },
];

/** Horizontal position of the packet as a percentage of the wire, per step. */
const PACKET_LEFT_PERCENT = [4, 30, 62, 62, 4] as const;
/** Which end is doing the work, per step. */
const ACTIVE_END: readonly ("browser" | "dns" | "server")[] = [
  "browser",
  "dns",
  "server",
  "server",
  "browser",
];

function EndpointCard({
  label,
  detail,
  active,
}: {
  label: string;
  detail: string;
  active: boolean;
}) {
  return (
    <div
      className={
        active
          ? "rounded border-2 border-brand bg-brand/10 px-3 py-2 text-center"
          : "rounded border border-line bg-panel px-3 py-2 text-center"
      }
    >
      <p className="text-xs font-semibold text-ink">{label}</p>
      <p className="text-[11px] text-ink-muted">{detail}</p>
    </div>
  );
}

export function HttpCycleDiagram() {
  return (
    <ExplainerShell conceptId="http-cycle" steps={STEPS}>
      {({ stepIndex, reducedMotion }) => {
        const transition = stepTransition(reducedMotion);
        const active = ACTIVE_END[stepIndex];
        const isResponse = stepIndex >= 3;

        return (
          <div className="flex w-full max-w-lg flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <EndpointCard label="Browser" detail="your machine" active={active === "browser"} />
              <EndpointCard label="DNS" detail="name → IP" active={active === "dns"} />
              <EndpointCard label="Server" detail="203.0.113.42" active={active === "server"} />
            </div>

            {/* The wire. The packet's colour states its direction, so the meaning
                survives with motion switched off. */}
            <div className="relative h-10 rounded bg-panel ring-1 ring-line">
              <div className="absolute inset-x-2 top-1/2 h-0.5 -translate-y-1/2 bg-line" />
              <motion.div
                data-testid="http-packet"
                animate={{ left: `${PACKET_LEFT_PERCENT[stepIndex]}%` }}
                transition={transition}
                className={
                  isResponse
                    ? "absolute top-1/2 -translate-y-1/2 rounded bg-emerald-600 px-2 py-1 text-[11px] font-medium text-white"
                    : "absolute top-1/2 -translate-y-1/2 rounded bg-brand px-2 py-1 text-[11px] font-medium text-white"
                }
              >
                {isResponse ? "← 200 OK" : "GET →"}
              </motion.div>
            </div>

            <p className="text-center text-xs text-ink-muted">
              {isResponse ? "response travelling back" : "request travelling out"}
            </p>
          </div>
        );
      }}
    </ExplainerShell>
  );
}
