import test from "node:test";
import assert from "node:assert/strict";
import { validateFile, text } from "../assets/js/validation.js";
import { readFile } from "node:fs/promises";
test("rejects spoofed MIME, active formats, empty files and oversized uploads", () => {
  for (const file of [
    { name: "x.svg", type: "image/svg+xml", size: 12 },
    { name: "x.jpg", type: "text/html", size: 12 },
    { name: "x.png", type: "image/png", size: 0 },
    { name: "x.mp4", type: "video/mp4", size: 101 },
  ])
    assert.throws(() => validateFile(file, 20, 100));
  assert.equal(
    validateFile(
      { name: "MY PHOTO.JPG", type: "image/jpeg", size: 20 },
      20,
      100,
    ),
    "jpg",
  );
  assert.equal(
    validateFile({ name: "x.webm", type: "video/webm", size: 100 }, 20, 100),
    "webm",
  );
});
test("text validation trims and enforces nonempty bounds", () => {
  assert.equal(text(" hi ", 5, "Name"), "hi");
  assert.throws(() => text("  ", 5, "Name"));
  assert.throws(() => text("123456", 5, "Name"));
});
test("all public routes have relative assets and no admin navigation", async () => {
  for (const path of [
    "index.html",
    "gallery/index.html",
    "submit/index.html",
    "messages/index.html",
  ]) {
    const html = await readFile(path, "utf8");
    assert.ok(!html.includes('href="/'));
    assert.ok(!html.includes('src="/'));
    assert.ok(!html.includes("adminpanel"));
    assert.ok(html.includes('id="main"'));
  }
  const ui = await readFile("assets/js/ui.js", "utf8");
  assert.ok(!ui.includes("adminpanel"));
});
