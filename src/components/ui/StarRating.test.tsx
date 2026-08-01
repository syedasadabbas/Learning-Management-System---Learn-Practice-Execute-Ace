import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StarRating } from "./StarRating";

describe("StarRating — interactive", () => {
  it("reports the clicked star for every value 1..5", () => {
    for (const target of [1, 2, 3, 4, 5]) {
      const onChange = vi.fn();
      const { unmount } = render(
        <StarRating value={0} onChange={onChange} label="Rate" />,
      );

      fireEvent.click(screen.getAllByTestId("star")[target - 1]);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledWith(target);
      unmount();
    }
  });

  it("renders an ARIA radiogroup with one radio per star", () => {
    render(<StarRating value={3} onChange={() => {}} label="Rate" />);

    const group = screen.getByRole("radiogroup", { name: "Rate" });
    expect(group).toBeVisible();

    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(radios[2]).toHaveAttribute("aria-checked", "true");
    expect(radios[0]).toHaveAttribute("aria-checked", "false");
    expect(radios[4]).toHaveAttribute("aria-checked", "false");
  });

  it("keeps exactly one tab stop (roving tabindex) on the selected star", () => {
    render(<StarRating value={4} onChange={() => {}} />);
    const radios = screen.getAllByRole("radio");

    expect(radios.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(
      1,
    );
    expect(radios[3]).toHaveAttribute("tabindex", "0");
  });

  it("is operable with the keyboard: arrows, Home and End", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <StarRating value={3} onChange={onChange} label="Rate" />,
    );
    const group = screen.getByRole("radiogroup");

    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(4);

    fireEvent.keyDown(group, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(2);

    fireEvent.keyDown(group, { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(group, { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(5);

    // Clamps at the ends rather than wrapping or going out of range.
    rerender(<StarRating value={5} onChange={onChange} label="Rate" />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(5);

    rerender(<StarRating value={1} onChange={onChange} label="Rate" />);
    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it("clamps an out-of-range value prop into 0..max", () => {
    const { rerender } = render(<StarRating value={99} onChange={() => {}} />);
    expect(screen.getByTestId("star-rating")).toHaveAttribute("data-value", "5");

    rerender(<StarRating value={-3} onChange={() => {}} />);
    expect(screen.getByTestId("star-rating")).toHaveAttribute("data-value", "0");

    rerender(<StarRating value={Number.NaN} onChange={() => {}} />);
    expect(screen.getByTestId("star-rating")).toHaveAttribute("data-value", "0");
  });
});

describe("StarRating — read-only", () => {
  it("ignores clicks when readOnly is set, even with an onChange", () => {
    const onChange = vi.fn();
    render(<StarRating value={2} readOnly onChange={onChange} label="Grade" />);

    for (const star of screen.getAllByTestId("star")) {
      fireEvent.click(star);
    }

    expect(onChange).not.toHaveBeenCalled();
  });

  it("defaults to read-only when no onChange is supplied", () => {
    render(<StarRating value={2} />);

    expect(screen.getByTestId("star-rating")).toHaveAttribute(
      "data-readonly",
      "true",
    );
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("announces the rating as a single labelled image", () => {
    render(<StarRating value={3} label="Week 1" />);
    expect(
      screen.getByRole("img", { name: "Week 1: 3 out of 5 stars" }),
    ).toBeVisible();
  });

  it("announces 0 out of 5 for an ungraded item", () => {
    render(<StarRating value={0} />);
    expect(screen.getByRole("img", { name: "0 out of 5 stars" })).toBeVisible();
  });

  it("honours a custom max", () => {
    render(<StarRating value={7} max={10} />);
    expect(screen.getAllByTestId("star")).toHaveLength(10);
    expect(screen.getByRole("img", { name: "7 out of 10 stars" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Hover/focus preview. Grading is the interaction this control exists for, and
// before this the only way to see what a 4 looked like was to award a 4.
// The invariant under test throughout: the preview is PURELY visual. It must
// never move data-value, never move aria-checked, and never call onChange —
// otherwise a mouse crossing the widget on its way elsewhere would regrade a
// student's submission.
// ---------------------------------------------------------------------------
describe("StarRating preview", () => {
  function starAt(n: number): HTMLElement {
    return screen
      .getAllByTestId("star")
      .find((el) => el.getAttribute("data-value") === String(n))!;
  }

  it("fills up to the hovered star without committing anything", () => {
    const onChange = vi.fn();
    render(<StarRating value={1} onChange={onChange} />);

    fireEvent.pointerEnter(starAt(4));

    expect(screen.getByTestId("star-rating")).toHaveAttribute(
      "data-preview",
      "4",
    );
    expect(starAt(4)).toHaveAttribute("data-preview", "true");
    // The committed value and the a11y state are untouched.
    expect(screen.getByTestId("star-rating")).toHaveAttribute("data-value", "1");
    expect(
      screen.getByRole("radio", { name: "1 star" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears when the pointer leaves the group", () => {
    render(<StarRating value={2} onChange={() => {}} />);
    const group = screen.getByTestId("star-rating");

    fireEvent.pointerEnter(starAt(5));
    expect(group).toHaveAttribute("data-preview", "5");

    fireEvent.pointerLeave(group);
    expect(group).toHaveAttribute("data-preview", "0");
  });

  it("previews a value BELOW the current rating, for corrections", () => {
    // Correcting a 5 down to a 2 is the case a max()-based preview gets wrong:
    // it would keep showing 5 filled stars and give the instructor no feedback.
    render(<StarRating value={5} onChange={() => {}} />);

    fireEvent.pointerEnter(starAt(2));

    expect(screen.getByTestId("star-rating")).toHaveAttribute(
      "data-preview",
      "2",
    );
    // Stars 3..5 are no longer marked as filled-by-preview, and 4 is not shown
    // as an addition either — the preview is the whole displayed value.
    expect(starAt(4)).not.toHaveAttribute("data-preview");
  });

  it("previews on keyboard focus as well as pointer hover", () => {
    // A keyboard grader gets the same affordance; without this the preview
    // would be a mouse-only feature.
    render(<StarRating value={0} onChange={() => {}} />);

    fireEvent.focus(starAt(3));
    expect(screen.getByTestId("star-rating")).toHaveAttribute(
      "data-preview",
      "3",
    );

    fireEvent.blur(starAt(3));
    expect(screen.getByTestId("star-rating")).toHaveAttribute(
      "data-preview",
      "0",
    );
  });

  it("still commits on click, and the click value wins over the preview", () => {
    const onChange = vi.fn();
    render(<StarRating value={0} onChange={onChange} />);

    fireEvent.pointerEnter(starAt(3));
    fireEvent.click(starAt(3));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(3);
  });

  it("does not preview in read-only mode", () => {
    // A read-only rating must never look interactive — the component decides
    // this from the absence of onChange, so a display usage cannot opt in by
    // accident.
    render(<StarRating value={3} />);
    const group = screen.getByTestId("star-rating");

    fireEvent.pointerEnter(starAt(5));

    expect(group).not.toHaveAttribute("data-preview");
    expect(group).toHaveAttribute("data-value", "3");
  });
});
