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

// Offscreen media stops downloading. A hovered gif is driven by bindGif, so
// nothing here swaps sources, which keeps the two behaviours from fighting.
let mediaObserver = null;
export function watchMedia(root = document) {
  if (!("IntersectionObserver" in window)) return;
  if (!mediaObserver) {
    mediaObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const node = entry.target;
          if (node.tagName !== "IMG") continue;
          node.loading = entry.isIntersecting ? "eager" : "lazy";
        }
      },
      { rootMargin: "300px" },
    );
  }
  root.querySelectorAll("img[data-animate]").forEach((n) => mediaObserver.observe(n));
}

// A card shows the poster frame, and the animation only runs while the card is
// hovered or focused, so a wall of gifs stays cheap.
export function bindGif(root) {
  root.querySelectorAll("img[data-gif][data-gif-src]").forEach((img) => {
    if (img.dataset.gifBound) return;
    img.dataset.gifBound = "1";
    const still = img.src;
    const animated = img.dataset.gifSrc;
    if (!animated || animated === still) return;

    const stop = () => {
      if (img.dataset.gifPlaying) return;
      img.dataset.gifPlaying = "1";
      img.src = still;
    };
    const start = () => {
      if (!img.dataset.gifPlaying) return;
      delete img.dataset.gifPlaying;
      img.src = animated;
    };
    const card = img.closest(".post-card") || img.closest(".album-card") || img;
    card.addEventListener("pointerenter", start);
    card.addEventListener("pointerleave", stop);
    card.addEventListener("focusin", start);
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
