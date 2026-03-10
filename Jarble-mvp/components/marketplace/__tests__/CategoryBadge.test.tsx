import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CategoryBadge } from "../CategoryBadge";

describe("CategoryBadge", () => {
  it("renders the category text", () => {
    render(<CategoryBadge category="chart" />);
    expect(screen.getByText("chart")).toBeDefined();
  });

  it("renders unknown categories with fallback styling", () => {
    render(<CategoryBadge category="unknown-cat" />);
    expect(screen.getByText("unknown-cat")).toBeDefined();
  });

  const KNOWN_CATEGORIES = [
    "dashboard", "chart", "form", "media", "utility",
    "game", "visualization", "layout", "social",
  ];

  for (const cat of KNOWN_CATEGORIES) {
    it(`renders ${cat} category`, () => {
      render(<CategoryBadge category={cat} />);
      expect(screen.getByText(cat)).toBeDefined();
    });
  }

  it("passes className prop", () => {
    const { container } = render(<CategoryBadge category="chart" className="extra" />);
    expect(container.querySelector(".extra")).toBeTruthy();
  });
});
