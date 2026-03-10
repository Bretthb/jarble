import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TierBadge } from "../TierBadge";

describe("TierBadge", () => {
  it("renders template tier text", () => {
    render(<TierBadge tier="template" />);
    expect(screen.getByText("template")).toBeDefined();
  });

  it("renders sandbox tier text", () => {
    render(<TierBadge tier="sandbox" />);
    expect(screen.getByText("sandbox")).toBeDefined();
  });

  it("renders unknown tier with fallback styling", () => {
    render(<TierBadge tier="custom" />);
    expect(screen.getByText("custom")).toBeDefined();
  });

  it("passes className prop", () => {
    const { container } = render(<TierBadge tier="template" className="extra" />);
    expect(container.querySelector(".extra")).toBeTruthy();
  });

  it("renders an icon", () => {
    const { container } = render(<TierBadge tier="template" />);
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });
});
