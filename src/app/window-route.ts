export function routeForWindowLabel(
  label: "manager" | "overlay",
): "/" | "/overlay.html" {
  return label === "manager" ? "/" : "/overlay.html";
}
