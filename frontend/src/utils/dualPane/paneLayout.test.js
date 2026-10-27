import { describe, expect, it } from "vitest";
import { closestInDirection, isCardMode, modeForSize, paneColumns, paneItemStyles } from "./paneLayout.js";

// A card grid: width 100, height 100, 10px gaps; a short last row, then a new group lower down
const cell = (column, top) => ({ left: column * 110, right: column * 110 + 100, top, bottom: top + 100 });
const grid = [
  cell(0, 0), cell(1, 0), cell(2, 0),
  cell(0, 110), cell(1, 110),
  cell(0, 260), cell(1, 260), cell(2, 260),
];

describe("paneLayout", () => {
  it("tells card layouts from list layouts", () => {
    expect(["normal", "icons", "gallery"].every(isCardMode)).toBe(true);
    expect(["list", "compact", undefined].some(isCardMode)).toBe(false);
  });

  it("fits normal-layout columns to the pane's width", () => {
    // Size 5: a 500px column, as for the main listing
    expect(paneColumns("normal", 1499, 5)).toBe(2);
    expect(paneColumns("normal", 1500, 5)).toBe(3);
    expect(paneColumns("normal", 300, 5)).toBe(1);
    // Hidden (no width yet) and the other layouts: one column
    expect(paneColumns("normal", 0, 5)).toBe(1);
    expect(paneColumns("icons", 1500, 5)).toBe(1);
  });

  it("sizes entries as the main listing does", () => {
    expect(paneItemStyles("list", 5, 1)).toEqual({
      "--item-width": "calc(100.00% - 1em)",
      "--item-height": "65px",
      "--icon-size": "2.60em",
      "--icon-font-size": "2.10em",
    });
    expect(paneItemStyles("compact", 2, 1)["--item-height"]).toBe("44px");
    expect(paneItemStyles("normal", 5, 3)).toEqual({
      "--item-width": `calc(${100 / 3}% - 1em)`,
      "--item-height": "auto",
      "--icon-size": "3.95em",
      "--icon-font-size": "2.80em",
    });
    expect(paneItemStyles("icons", 3, 1)).toEqual({
      "--icon-size": "65px",
      "--icon-font-size": "65px",
      "--icons-view-cell-size": "95px",
    });
    expect(paneItemStyles("gallery", 5, 1)).toEqual({ "--icon-font-size": "5.50em", "--item-width": "205px", "--item-height": "246px" });
    expect(paneItemStyles("gallery", 9, 1)["--item-width"]).toBe("365px");
  });

  it("picks the family member the size slider would", () => {
    expect([modeForSize("list", 3), modeForSize("compact", 4)]).toEqual(["compact", "list"]);
    expect([modeForSize("gallery", 4), modeForSize("icons", 5)]).toEqual(["icons", "gallery"]);
    expect(modeForSize("normal", 1)).toBe("normal");
  });

  it("goes to the nearest entry in the next row up or down", () => {
    expect(closestInDirection(grid, 1, "down")).toBe(4);
    // A short row: the nearest entry in it, not one further down in the same column
    expect(closestInDirection(grid, 2, "down")).toBe(4);
    // Across a group break
    expect(closestInDirection(grid, 4, "down")).toBe(6);
    expect(closestInDirection(grid, 7, "up")).toBe(4);
    expect(closestInDirection(grid, 3, "up")).toBe(0);
    // A page keeps to the starting column across a short row
    expect(closestInDirection(grid, 4, "down", 270)).toBe(7);
  });

  it("finds nothing past the first or last row, or for an entry not on screen", () => {
    expect(closestInDirection(grid, 1, "up")).toBe(-1);
    expect(closestInDirection(grid, 6, "down")).toBe(-1);
    expect(closestInDirection([null, ...grid.slice(1)], 0, "down")).toBe(-1);
    // Entries not on screen are skipped
    expect(closestInDirection([grid[0], null, grid[3]], 0, "down")).toBe(2);
  });
});
