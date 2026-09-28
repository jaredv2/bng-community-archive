export const types: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  webm: "video/webm",
};

const GIFS = new Set(["image/gif"]);

// First bytes of each supported format, so a renamed file cannot get in.
const signatures: Record<string, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  ],
  "image/webp": [],
  "video/mp4": [],
  "video/webm": [[0x1a, 0x45, 0xdf, 0xa3]],
};

const at = (bytes: Uint8Array, index: number) => bytes[index];

const startsWith = (bytes: Uint8Array, pattern: number[]) =>
  pattern.every((value, index) => at(bytes, index) === value);

export function matchesMagic(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/webp")
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  // ISO base media files carry ftyp at byte 4.
  if (mime === "video/mp4") return String.fromCharCode(...bytes.slice(4, 8)) === "ftyp";
  const patterns = signatures[mime];
  if (!patterns) return false;
  return patterns.some((pattern) => startsWith(bytes, pattern));
}

export const isGif = (mime: string) => GIFS.has(mime);
