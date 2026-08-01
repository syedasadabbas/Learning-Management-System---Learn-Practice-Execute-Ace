// =============================================================================
// STAT TILE + RATE DISPLAY — instructor-admin stream.
// -----------------------------------------------------------------------------
// The one place a `Rate` is turned into text, so "no data" is worded identically
// on every panel. A rate with a zero denominator renders the words "no data" and
// a muted tone; it never renders "0%", because "nobody has attempted the quiz"
// and "everybody failed the quiz" are different facts.
// =============================================================================

import * as React from "react";

import { Card } from "@/components/ui";
import {
  formatAverage,
  formatRate,
  NO_DATA_LABEL,
  type Rate,
} from "@/lib/instructor/rates";

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  /** Small line under the value: the raw counts behind a rate, usually. */
  hint?: React.ReactNode;
  /** Rendered muted when true — used for "no data". */
  muted?: boolean;
  testId?: string;
}

export function StatTile({ label, value, hint, muted, testId }: StatTileProps) {
  return (
    <Card data-testid={testId ?? "stat-tile"} padded>
      <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
        {label}
      </p>
      <p
        className={
          muted
            ? "mt-1 text-2xl font-semibold text-ink-muted"
            : "mt-1 text-2xl font-semibold text-ink tabular-nums"
        }
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
    </Card>
  );
}

export interface RateTileProps {
  label: string;
  rate: Rate;
  /** Words for the denominator, e.g. "students who attempted". */
  denominatorNoun?: string;
  testId?: string;
}

/** A rate as a tile. `percent === null` -> "no data" + an explanatory hint. */
export function RateTile({ label, rate, denominatorNoun, testId }: RateTileProps) {
  const hasData = rate.percent !== null;
  return (
    <StatTile
      testId={testId}
      label={label}
      value={formatRate(rate)}
      muted={!hasData}
      hint={
        hasData
          ? `${rate.numerator} of ${rate.denominator}${denominatorNoun ? ` ${denominatorNoun}` : ""}`
          : `No ${denominatorNoun ?? "records"} yet — nothing to divide by.`
      }
    />
  );
}

/** Inline rate text, for table cells. */
export function RateText({ rate }: { rate: Rate }) {
  return (
    <span
      data-testid="rate-text"
      data-has-data={rate.percent !== null}
      className={rate.percent === null ? "text-ink-muted" : "tabular-nums"}
    >
      {formatRate(rate)}
    </span>
  );
}

/** Inline average text with the same "no data" contract. */
export function AverageText({
  value,
  digits = 1,
  suffix = "",
}: {
  value: number | null;
  digits?: number;
  suffix?: string;
}) {
  const text = formatAverage(value, digits, suffix);
  return (
    <span
      data-testid="average-text"
      data-has-data={text !== NO_DATA_LABEL}
      className={text === NO_DATA_LABEL ? "text-ink-muted" : "tabular-nums"}
    >
      {text}
    </span>
  );
}
