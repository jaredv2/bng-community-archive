import { $, el, toast, attempt, fieldError, tagField } from "./ui.js";
import { validateFile, parseTags, text } from "./validation.js";
import { reserve, finalize } from "./data-actions.js";
import { play } from "./sound.js";
import { reducedMotion } from "./motion.js";

const POSTER_MAX = 720;

// Draws a small still on a canvas so the grid never loads a full size image.
// Works for photos and for the first frame of a GIF.
async function makePoster(file) {
  if (file.type.startsWith("video/")) return null;
  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    const scale = Math.min(1, POSTER_MAX / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, width, height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
    return blob && blob.size < file.size ? blob : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(source);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function readSize(file) {
  return file.size < 1024 * 1024
    ? `${Math.round(file.size / 1024)} KB`
    : `${(file.size / 1024 / 1024).toFixed(1)} MB`;
}

export function submission() {
  const form = $("#submit-form");
  if (!form) return;
  const input = $("#file");
  const zone = $("#dropzone");
  const choose = $("#choose-file");
  const preview = $("#preview");
  const progress = $("#upload-progress");
  const progressBlock = progress.closest(".progress-block");
  const label = $("#upload-label");
  const caption = $("#caption");
  const username = $("#username");
  const tags = tagField($("#tag-box"));

  let file = null;
  let objectUrl = null;
  let poster = null;

  function reset() {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
    file = null;
    poster = null;
    preview.replaceChildren();
    input.value = "";
  }

  function describe(node) {
    const isVideo = file.type.startsWith("video/");
    node.src = objectUrl;
    if (isVideo) {
      node.controls = true;
      node.preload = "metadata";
    } else {
      node.alt = "Selected media preview";
    }
  }

  function paint() {
    if (!file) {
      preview.replaceChildren();
      return;
    }
    const node = el(file.type.startsWith("video/") ? "video" : "img", "upload-preview");
    describe(node);
    const row = el("div", "preview-row");
    const text = el("span", "", `${file.name} · ${readSize(file)}`);
    const swap = el("button", "subtle", "Choose another");
    swap.type = "button";
    swap.dataset.sound = "tap";
    swap.onclick = () => input.click();
    row.append(text, swap);
    preview.replaceChildren(node, row);
    if (node.tagName === "VIDEO" && !reducedMotion()) node.play().catch(() => {});
  }

  async function accept(candidate) {
    try {
      validateFile(candidate);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      file = candidate;
      objectUrl = URL.createObjectURL(file);
      fieldError(input, null);
      paint();
      label.textContent = "Preparing preview…";
      const made = await makePoster(file);
      if (file === candidate) {
        poster = made;
        label.textContent = made
          ? "Ready to send."
          : "Ready to send. This one has no preview thumbnail.";
      }
    } catch (error) {
      reset();
      toast(error.message, true);
    }
  }

  input.onchange = () => {
    if (input.files[0]) accept(input.files[0]);
  };
  choose.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    input.click();
  };
  zone.onclick = (event) => {
    if (event.target.closest("#choose-file")) return;
    input.click();
  };
  zone.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  };
  for (const type of ["dragover", "dragenter"]) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.add("dragging");
    });
  }
  for (const type of ["dragleave", "drop"]) {
    zone.addEventListener(type, (event) => {
      event.preventDefault();
      zone.classList.remove("dragging");
    });
  }
  zone.addEventListener("drop", (event) => {
    const dropped = event.dataTransfer?.files?.[0];
    if (dropped) accept(dropped);
  });
  window.addEventListener("pagehide", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  // Live tag suggestions taken from the caption as you type.
  caption?.addEventListener("input", () => {
    const found = parseTags(caption.value);
    if (!found.length) return;
    for (const tag of found) {
      const already = tags.value.includes(tag);
      if (!already) tags.add(tag);
    }
    $("#tag-count")?.replaceChildren(document.createTextNode(String(tags.value.length)));
  });

  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = $("#submit-button");
    await attempt(button, "Preparing…", async () => {
      // Everything that can be checked locally is checked before any request,
      // so a bad field never turns into a network round trip.
      let ok = true;
      for (const [field, value, max, name] of [
        [username, username.value, 60, "Name"],
        [caption, caption.value, 1000, "Caption"],
      ]) {
        try {
          text(value, max, name);
          fieldError(field, null);
        } catch (problem) {
          fieldError(field, problem.message);
          ok = false;
        }
      }
      if (!file) {
        fieldError(input, "Choose a file first.");
        ok = false;
      } else {
        fieldError(input, null);
      }
      if (!ok) {
        (username.closest(".invalid, :has(.invalid)") || username).focus?.();
        throw new Error("Check the highlighted fields.");
      }

      try {
        const ext = validateFile(file);
        const wanted = tags.value.length ? tags.value : parseTags(caption.value);
        const reservation = await reserve({
          username: username.value,
          caption: caption.value,
          tags: wanted,
          ext,
          mime: file.type,
          size: file.size,
        });

        progressBlock.hidden = false;
        progress.value = 0;
        label.textContent = "Uploading 0%";
        play("drag");

        const jobs = [
          upload(reservation.url, file, (percent) => {
            progress.value = percent;
            label.textContent = `Uploading ${percent}%`;
          }),
        ];
        if (poster) jobs.push(upload(reservation.poster_url, poster, () => {}));
        await Promise.all(jobs);

        label.textContent = "Checking your media…";
        await finalize(reservation.id, reservation.token);

        play("success");
        form.reset();
        reset();
        if ($("#tag-count")) $("#tag-count").textContent = "0";
        label.textContent = "Posted. It is live in the archive now.";
        toast("Posted to the archive.");
        setTimeout(() => {
          progressBlock.hidden = true;
          label.textContent = "";
        }, 4000);
      } catch (error) {
        label.textContent = "";
        throw error;
      }
    });
  };
}

function upload(url, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.timeout = 15 * 60 * 1000;
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("The upload did not finish. Please try again."));
    xhr.onerror = xhr.ontimeout = () =>
      reject(new Error("The upload connection dropped. Please try again."));
    xhr.send(file);
  });
}
