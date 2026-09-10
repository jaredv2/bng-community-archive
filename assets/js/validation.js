export const types = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};
export function validateFile(file, imageLimit, videoLimit) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!types[ext] || types[ext] !== file.type)
    throw new Error(
      "This file type isn't supported. Choose JPG, PNG, WebP, GIF, MP4 or WebM.",
    );
  if (
    !file.size ||
    file.size > (file.type.startsWith("video/") ? videoLimit : imageLimit)
  )
    throw new Error("This file is too large or empty.");
  return ext;
}
export function text(value, max, label) {
  const v = String(value || "").trim();
  if (!v || v.length > max)
    throw new Error(`${label} must contain 1–${max} characters.`);
  return v;
}
