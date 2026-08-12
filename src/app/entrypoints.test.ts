import { describe, expect, it } from "vitest";
import { routeForWindowLabel } from "./window-route";

describe("routeForWindowLabel", () => {
  it.each<["manager" | "overlay", "/" | "/overlay.html"]>([
    ["manager", "/"],
    ["overlay", "/overlay.html"],
  ])("maps %s", (label, route) => {
    expect(routeForWindowLabel(label)).toBe(route);
  });
});
