import { config } from "./config.js";
import { play, bindSounds } from "./sound.js";
import { observe } from "./motion.js";

export const base = new URL("../../", import.meta.url);
export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, cls, textContent) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (textContent != null) node.textContent = textContent;
  return node;
}

export function url(path) {
  return new URL(path, base).href;
}

export function toast(message, isError = false) {
  const host = $("#toasts");
  if (!host) return;
  const node = el("div", `toast ${isError ? "error" : ""}`, message);
  node.setAttribute("role", isError ? "alert" : "status");
  host.append(node);
  if (isError) play("error");
  else play("tick");
  const remove = () => {
    node.classList.add("leaving");
    setTimeout(() => node.remove(), 200);
  };
  setTimeout(remove, isError ? 6500 : 4200);
  node.addEventListener("click", remove);
}

// Runs an action with the button disabled and a label swap, surfacing failures.
export async function busy(button, label, action) {
  if (!button) return action();
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try {
    return await action();
  } catch (error) {
    toast(error.message || "Something went wrong. Please try again.", true);
    throw error;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

// Same thing for form submits. busy already showed the message and inline field
// errors, so the rejection is swallowed here instead of escaping as an unhandled
// promise rejection in the console.
export async function attempt(button, label, action) {
  try {
    return await busy(button, label, action);
  } catch {
    return undefined;
  }
}

// A richer placeholder for a page or grid with nothing in it yet.
export function emptyState({ icon = "▦", title, body, action, href } = {}) {
  const node = el("div", "empty");
  const mark = el("div", "empty-mark");
  mark.setAttribute("aria-hidden", "true");
  mark.textContent = icon;
  node.append(mark);
  if (title) node.append(el("h3", "empty-title", title));
  if (body) node.append(el("p", "empty-body", body));
  if (action) {
    const link = el("a", "button primary", action);
    link.href = href || "#";
    link.dataset.sound = "nav";
    node.append(link);
  }
  return node;
}

// Compact single line placeholder, for stacks and inline panels.
export function empty(root, message) {
  const node = el("div", "empty empty-compact", message);
  node.classList.add("in");
  root.replaceChildren(node);
}

// Shown while a panel is fetching, before it knows whether it is empty.
export function loading(root, message = "Loading…") {
  const node = el("div", "empty empty-compact empty-loading", message);
  node.setAttribute("role", "status");
  node.classList.add("in");
  root.replaceChildren(node);
}

// Replaces the contents with a full placeholder.
export function showEmpty(root, options) {
  root.replaceChildren(emptyState(options));
}

export function date(value) {
  return new Date(value).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function relative(value) {
  const then = new Date(value).getTime();
  const days = Math.round((Date.now() - then) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return date(value);
}

export function shell() {
  document.title = `${document.body.dataset.title} · ${config.SITE_NAME}`;

  const header = el("header", "header");
  const inner = el("div", "nav-wrap");
  const brand = el("a", "brand");
  brand.href = url("");
  const mark = el("span", "brand-mark", "▦");
  mark.setAttribute("aria-hidden", "true");
  brand.append(mark, el("span", "", config.ARCHIVE_NAME));
  brand.setAttribute("aria-label", `${config.ARCHIVE_NAME} home`);

  const toggle = el("button", "menu-toggle", "Menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "navigation");
  toggle.dataset.sound = "tap";

  const nav = el("nav");
  nav.id = "navigation";
  nav.setAttribute("aria-label", "Main navigation");
  const routes = [
    ["", "Home"],
    ["gallery/", "Gallery"],
    ["albums/", "Albums"],
    ["search/", "Search"],
    ["submit/", "Submit"],
    ["messages/", "Messages"],
  ];
  const current = document.body.dataset.page;
  for (const [path, label] of routes) {
    const link = el("a", "", label);
    link.href = url(path);
    link.dataset.sound = "nav";
    if (current === (path.split("/")[0] || "home"))
      link.setAttribute("aria-current", "page");
    nav.append(link);
  }

  toggle.onclick = () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    toggle.textContent = open ? "Close" : "Menu";
    nav.classList.toggle("open", open);
    play("tap");
  };

  inner.append(brand, toggle, nav);
  header.append(inner);
  document.body.prepend(header);

  const footer = el("footer");
  const footerTop = el("div", "footer-top");
  footerTop.append(
    el("span", "footer-name", `${config.ARCHIVE_NAME} ${config.SITE_NAME}`),
    el("span", "footer-tagline", "Built for the community. Kept for the memories."),
  );
  const credits = el("p", "credits", "Made by @cis6led and @yuss.eu");
  footer.append(footerTop, credits);
  document.body.append(footer);

  const toasts = el("div");
  toasts.id = "toasts";
  toasts.setAttribute("aria-live", "polite");
  document.body.append(toasts);

  document.querySelectorAll("[data-href]").forEach((link) => {
    link.href = url(link.dataset.href);
  });

  bindSounds(document);
  observe(document);
}

// A modal with a close button, outside click to dismiss and focus handling.
export function dialog(title, className = "modal") {
  const node = el("dialog", className);
  const top = el("div", "modal-top");
  const heading = el("h2", "", title);
  heading.id = `dialog-${crypto.randomUUID()}`;
  node.setAttribute("aria-labelledby", heading.id);
  const close = el("button", "icon-button", "×");
  close.setAttribute("aria-label", "Close");
  close.dataset.sound = "close";
  close.onclick = () => shut();
    top.append(heading, close);
    // The body has to be in the tree, or every dialog renders as an empty box.
    const body = el("div", "modal-body");
    node.append(top, body);
    document.body.append(node);

  let returnTo = null;
  function shut() {
    node.classList.add("closing");
    node.querySelectorAll("video").forEach((video) => video.pause());
    node.close();
  }
  node.addEventListener("close", () => {
    node.classList.remove("closing");
    node.remove();
    returnTo?.focus?.();
  });
  node.addEventListener("click", (event) => {
    if (event.target !== node) return;
    const box = node.getBoundingClientRect();
    const outside =
      event.clientX < box.left ||
      event.clientX > box.right ||
      event.clientY < box.top ||
      event.clientY > box.bottom;
    if (outside) shut();
  });

  return {
    node,
    body,
    open() {
      returnTo = document.activeElement;
      node.showModal();
      play("open");
    },
    close: shut,
    setTitle(next) {
      heading.textContent = next;
    },
  };
}

export function confirmAction({ title, body, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const modal = dialog(title);
    modal.body.append(el("p", "muted", body));
    const row = el("div", "actions");
    for (const [label, value] of [
      ["Cancel", false],
      [confirmLabel, true],
    ]) {
      const button = el("button", value && danger ? "danger" : value ? "primary" : "subtle", label);
      button.dataset.sound = value ? "tap" : "close";
      button.onclick = () => {
        resolve(value);
        modal.close();
      };
      row.append(button);
    }
    modal.body.append(row);
    modal.node.addEventListener("close", () => resolve(false), { once: true });
    modal.open();
  });
}

export function fieldError(input, message) {
  if (!input) return;
  const host = input.closest(".field") || input.parentElement;
  let node = host?.querySelector(".field-error");
  if (!message) {
    input.classList.remove("invalid");
    node?.remove();
    input.removeAttribute("aria-describedby");
    return;
  }
  input.classList.add("invalid");
  if (!node) {
    node = el("p", "field-error");
    node.id = `err-${crypto.randomUUID()}`;
    host?.append(node);
    input.setAttribute("aria-describedby", node.id);
  }
  node.textContent = message;
  input.setAttribute("aria-invalid", "true");
}

// Wraps a tag input so tags can be typed, pasted and removed.
export function tagField(box) {
  const input = $("#tag-input", box) || $("input", box);
  const count = $("#tag-count");
  let tags = [];

  function paint() {
    $$(".tag", box).forEach((n) => n.remove());
    input.before(
      ...tags.map((tag) => {
        const chip = el("span", "tag");
        chip.append(el("span", "", `#${tag}`));
        const remove = el("button", "", "×");
        remove.type = "button";
        remove.setAttribute("aria-label", `Remove ${tag}`);
        remove.onclick = () => {
          tags = tags.filter((t) => t !== tag);
          paint();
          play("close");
        };
        chip.append(remove);
        return chip;
      }),
    );
    if (count) count.textContent = String(tags.length);
  }

  function add(value) {
    const clean = String(value ?? "")
      .trim()
      .toLowerCase()
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    if (!clean || tags.includes(clean)) return;
    if (tags.length >= config.MAX_TAGS) {
      toast(`You can add up to ${config.MAX_TAGS} tags.`, true);
      return;
    }
    tags.push(clean);
    play("tick");
    paint();
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(input.value);
      input.value = "";
    } else if (event.key === "Backspace" && !input.value && tags.length) {
      tags.pop();
      paint();
      play("close");
    }
  });
  input.addEventListener("blur", () => {
    if (input.value.trim()) {
      add(input.value);
      input.value = "";
    }
  });
  input.addEventListener("paste", (event) => {
    const pasted = (event.clipboardData?.getData("text") || "").split(/[\s,]+/);
    if (pasted.length < 2) return;
    event.preventDefault();
    pasted.forEach(add);
  });
  box.addEventListener("click", (event) => {
    if (event.target === box) input.focus();
  });
  paint();

  return { get value() { return [...tags]; }, add };
}
