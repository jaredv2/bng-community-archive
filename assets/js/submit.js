import { api } from "./supabase.js";
import { config } from "./config.js";
import { $, el, busy, toast } from "./ui.js";
import { text, validateFile } from "./validation.js";
export function submission() {
  const form = $("#submit-form"),
    input = $("#file"),
    zone = $("#dropzone"),
    preview = $("#preview"),
    progress = $("#upload-progress");
  let file, objectUrl;
  function choose(candidate) {
    try {
      validateFile(candidate, config.MAX_IMAGE_SIZE, config.MAX_VIDEO_SIZE);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      file = candidate;
      objectUrl = URL.createObjectURL(file);
      const n = el(
        file.type.startsWith("video/") ? "video" : "img",
        "upload-preview",
      );
      n.src = objectUrl;
      if (n.tagName === "VIDEO") {
        n.controls = true;
        n.preload = "metadata";
      } else n.alt = "Selected media preview";
      preview.replaceChildren(
        n,
        el(
          "p",
          "muted",
          `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`,
        ),
      );
    } catch (e) {
      file = null;
      input.value = "";
      preview.replaceChildren();
      toast(e.message, true);
    }
  }
  input.onchange = () => {
    if (input.files[0]) choose(input.files[0]);
  };
  for (const event of ["dragover", "dragenter"])
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.add("dragging");
    });
  for (const event of ["dragleave", "drop"])
    zone.addEventListener(event, (e) => {
      e.preventDefault();
      zone.classList.remove("dragging");
    });
  zone.addEventListener("drop", (e) => {
    if (e.dataTransfer.files[0]) choose(e.dataTransfer.files[0]);
  });
  window.addEventListener("pagehide", () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });
  form.onsubmit = (e) => {
    e.preventDefault();
    busy($("#submit-button"), "Preparing upload…", async () => {
      if (!file) throw new Error("Choose a media file first.");
      const selected = file;
      const ext = validateFile(
        selected,
        config.MAX_IMAGE_SIZE,
        config.MAX_VIDEO_SIZE,
      );
      const data = new FormData(form);
      const reservation = await api("reserve", {
        username: text(data.get("username"), 60, "Username"),
        caption: text(data.get("caption"), 1000, "Caption"),
        ext,
        mime: selected.type,
        size: selected.size,
      });
      progress.hidden = false;
      try {
        await upload(reservation.url, selected, (percent) => {
          progress.value = percent;
          $("#upload-label").textContent = `Uploading ${percent}%`;
        });
        $("#upload-label").textContent = "Verifying your media…";
        await api("finalize", { id: reservation.id, token: reservation.token });
        form.reset();
        preview.replaceChildren();
        file = null;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        $("#upload-label").textContent =
          "Your submission has been sent for approval.";
        toast("Your submission has been sent for approval.");
      } catch (e) {
        $("#upload-label").textContent = "Upload failed. Please try again.";
        throw e;
      } finally {
        progress.hidden = true;
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
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new Error("Upload failed. Please try again."));
    xhr.onerror = xhr.ontimeout = () =>
      reject(new Error("Upload connection failed. Please try again."));
    xhr.send(file);
  });
}
