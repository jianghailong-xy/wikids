// @vitest-environment jsdom
import { expect, it } from "vitest";

it("provides an opt-in jsdom environment", () => {
  const element = document.createElement("button");
  element.textContent = "投票";
  document.body.append(element);
  expect(document.querySelector("button")?.textContent).toBe("投票");
});
