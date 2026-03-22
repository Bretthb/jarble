import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StarRating } from "../StarRating";

describe("StarRating", () => {
  it("renders 5 star icons", () => {
    const { container } = render(<StarRating rating={3} />);
    const stars = container.querySelectorAll("svg");
    expect(stars.length).toBe(5);
  });

  it("shows count when provided", () => {
    render(<StarRating rating={4} count={25} />);
    expect(screen.getByText("(25)")).toBeDefined();
  });

  it("does not show count when undefined", () => {
    render(<StarRating rating={4} />);
    expect(screen.queryByText(/\(/)).toBeNull();
  });

  it("shows count of 0", () => {
    render(<StarRating rating={0} count={0} />);
    expect(screen.getByText("(0)")).toBeDefined();
  });

  it("accepts className prop", () => {
    const { container } = render(<StarRating rating={3} className="custom" />);
    expect(container.querySelector(".custom")).toBeTruthy();
  });

  it("accepts sm size (default)", () => {
    const { container } = render(<StarRating rating={3} />);
    // sm size uses size-3.5 class
    const stars = container.querySelectorAll("svg");
    expect(stars.length).toBe(5);
  });

  it("accepts md size", () => {
    const { container } = render(<StarRating rating={3} size="md" />);
    const stars = container.querySelectorAll("svg");
    expect(stars.length).toBe(5);
  });
});
