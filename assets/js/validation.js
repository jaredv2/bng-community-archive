import { config } from "./config.js";

export const types = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

export const GIF_LIMIT = 25 * 1024 * 1024;

export function validateFile(file, imageLimit = config.MAX_IMAGE_SIZE, videoLimit = config.MAX_VIDEO_SIZE) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!types[ext] || types[ext] !== file.type)
    throw new Error(
      "This file type is not supported. Choose JPG, PNG, WebP, GIF, MP4 or WebM.",
    );
  if (!file.size)
    throw new Error("That file is empty.");
  const limit =
    file.type.startsWith("video/") ? videoLimit : file.type === "image/gif" ? GIF_LIMIT : imageLimit;
  if (file.size > limit)
    throw new Error(
      `That file is ${formatSize(file.size)}. The limit is ${formatSize(limit)}.`,
    );
  return ext;
}

export function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function text(value, max, label) {
  const v = String(value ?? "").trim();
  if (!v || v.length > max)
    throw new Error(`${label} must be between 1 and ${max} characters.`);
  return v;
}

// Tags are lowercase, a single word, and capped at 32 characters.
export function cleanTag(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_-]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

export function parseTags(caption, max = config.MAX_TAGS) {
  const found = String(caption ?? "").match(/#[\p{L}\p{N}_-]+/gu) || [];
  const out = [];
  for (const raw of found) {
    const tag = cleanTag(raw);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}

export function validateTags(tags, max = config.MAX_TAGS) {
  if (!Array.isArray(tags)) throw new Error("Invalid tags.");
  if (tags.length > max) throw new Error(`You can add up to ${max} tags.`);
  const out = [];
  for (const tag of tags) {
    const clean = cleanTag(tag);
    if (!clean) continue;
    if (out.includes(clean)) continue;
    out.push(clean);
  }
  return out;
}

export function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}
