import { play } from "./sound.js";

const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let observer = null;

// Fade and lift elements as they scroll into view.
export function observe(root = document) {
  const targets = root.querySelectorAll(".reveal:not(.in), .stagger:not(.in)");
  if (!targets.length) return;
  if (reduced()) {
    targets.forEach((n) => n.classList.add("in"));
    return;
  }
  if (!observer) {
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.05 },
    );
  }
  targets.forEach((node) => observer.observe(node));
}

// Offscreen media stops decoding. Keeps a wall of GIFs cheap.
let mediaObserver = null;
export function watchMedia(root = document) {
  if (!("IntersectionObserver" in window)) return;
  if (!mediaObserver) {
    mediaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target;
          if (node.tagName !== "IMG") continue;
          if (entry.isIntersecting) node.dataset.wasPaused = "";
          else if (node.dataset.paused) {
            delete node.dataset.paused;
            node.src = node.dataset.src || node.src;
          }
        }
      },
      { rootMargin: "150px" },
    );
  }
  root.querySelectorAll("img[data-animate]").forEach((n) => mediaObserver.observe(n));
}

// A GIF only animates while it is hovered or tapped open.
export function bindGif(root) {
  root.querySelectorAll("img[data-gif]").forEach((img) => {
    img.dataset.src = img.src;
    const stop = () => {
      if (img.dataset.paused) return;
      img.dataset.paused = "1";
      img.src = img.dataset.poster || img.dataset.src;
    };
    const play = () => {
      if (!img.dataset.paused) return;
      delete img.dataset.paused;
      img.src = img.dataset.src;
    };
    const card = img.closest(".post-card") || img;
    card.addEventListener("pointerenter", play);
    card.addEventListener("pointerleave", stop);
    card.addEventListener("focusin", play);
    card.addEventListener("focusout", stop);
  });
}

// Shared element transition from a card into the lightbox.
export function flip(from, to, run) {
  if (reduced() || !from || !to || !document.startViewTransition) {
    run();
    return;
  }
  const transition = document.startViewTransition(() => {
    run();
    return to;
  });
  play("open");
  return transition;
}

// Fades a node out, then removes it.
export function fadeOut(node, done) {
  if (reduced() || !node.animate) {
    node.remove();
    done?.();
    return;
  }
  node.animate(
    { opacity: [1, 0], transform: ["none", "translateY(6px)"] },
    { duration: 180, easing: "cubic-bezier(0.55,0,0.65,0.2)" },
  ).onfinish = () => {
    node.remove();
    done?.();
  };
}

// A small nudge for buttons that changed state, like approve or like.
export function nudge(node) {
  if (!node || reduced()) return;
  node.animate(
    { transform: ["scale(1)", "scale(0.97)", "scale(1)"] },
    { duration: 220, easing: "cubic-bezier(0.22,0.61,0.36,1)" },
  );
}

// Swaps a card between a poster and the full media with a short fade.
export function crossfade(node, apply) {
  if (reduced() || !node.animate) {
    apply();
    return;
  }
  node.animate([{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }], {
    duration: 200,
    easing: "ease-in-out",
  });
  apply();
}

export function reducedMotion() {
  return reduced();
}
