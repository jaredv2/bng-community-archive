import { config } from "./config.js";
export const base = new URL("../../", import.meta.url);
export const $ = (s, root = document) => root.querySelector(s);
export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
export function toast(message, error = false) {
  const n = el("div", `toast ${error ? "error" : ""}`, message);
  n.setAttribute("role", error ? "alert" : "status");
  $("#toasts").append(n);
  setTimeout(() => n.remove(), 6000);
}
export async function busy(button, text, fn) {
  const old = button.textContent;
  button.disabled = true;
  button.textContent = text;
  try {
    return await fn();
  } catch (e) {
    toast(e.message || "Something went wrong. Please try again.", true);
  } finally {
    button.disabled = false;
    button.textContent = old;
  }
}
export function empty(root, text) {
  root.replaceChildren(el("div", "empty", text));
}
export function date(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
export function shell() {
  document.title = `${document.body.dataset.title} · ${config.SITE_NAME}`;
  const header = el("header", "header");
  const inner = el("div", "nav-wrap");
  const logo = el("a", "brand", "▦  COMMUNITY ARCHIVE");
  logo.href = base.href;
  const toggle = el("button", "menu-toggle", "Menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "navigation");
  const nav = el("nav");
  nav.id = "navigation";
  nav.setAttribute("aria-label", "Main navigation");
  for (const [path, label] of [
    ["", "Home"],
    ["gallery/", "Gallery"],
    ["submit/", "Submit"],
    ["messages/", "Messages"],
  ]) {
    const a = el("a", "", label);
    a.href = new URL(path, base).href;
    if (document.body.dataset.page === (path.split("/")[0] || "home"))
      a.setAttribute("aria-current", "page");
    nav.append(a);
  }
  toggle.onclick = () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    nav.classList.toggle("open", open);
  };
  inner.append(logo, toggle, nav);
  header.append(inner);
  document.body.prepend(header);
  const footer = el("footer");
  footer.append(
    el("span", "", "COMMUNITY ARCHIVE"),
    el("span", "", "Built for the community. Kept for the memories."),
  );
  document.body.append(footer);
  const toasts = el("div");
  toasts.id = "toasts";
  toasts.setAttribute("aria-live", "polite");
  document.body.append(toasts);
  document
    .querySelectorAll("[data-href]")
    .forEach((a) => (a.href = new URL(a.dataset.href, base).href));
}
export function dialog(title) {
  const d = el("dialog", "modal");
  const top = el("div", "modal-top");
  const heading = el("h2", "", title);
  heading.id = `dialog-${crypto.randomUUID()}`;
  d.setAttribute("aria-labelledby", heading.id);
  const close = el("button", "icon-button", "×");
  close.setAttribute("aria-label", "Close dialog");
  close.onclick = () => d.close();
  top.append(heading, close);
  d.append(top);
  document.body.append(d);
  d.addEventListener("click", (e) => {
    if (e.target === d) {
      const r = d.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        d.close();
    }
  });
  d.addEventListener("close", () => {
    d.querySelectorAll("video").forEach((v) => v.pause());
    d.remove();
  });
  return d;
}
export function confirmReject() {
  return new Promise((resolve) => {
    const d = dialog("Reject this submission?");
    d.append(el("p", "muted", "It will not appear in the public gallery."));
    const row = el("div", "actions");
    for (const [label, value] of [
      ["Cancel", false],
      ["Reject", true],
    ]) {
      const b = el("button", value ? "danger" : "", label);
      b.onclick = () => {
        resolve(value);
        d.close();
      };
      row.append(b);
    }
    d.append(row);
    d.addEventListener("close", () => resolve(false));
    d.showModal();
  });
}
