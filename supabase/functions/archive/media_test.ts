import { matchesMagic } from "./media.ts";
Deno.test("rejects fake media and checks supported magic signatures", () => {
  const encode = (s: string) => new TextEncoder().encode(s);
  for (const mime of [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "video/mp4",
    "video/webm",
  ])
    if (matchesMagic(encode("<script>alert(1)</script>"), mime))
      throw Error("Accepted spoof");
  if (
    !matchesMagic(
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
      "image/png",
    )
  )
    throw Error("PNG rejected");
  if (!matchesMagic(encode("GIF89a"), "image/gif")) throw Error("GIF rejected");
  if (!matchesMagic(new Uint8Array([255, 216, 255]), "image/jpeg"))
    throw Error("JPEG rejected");
  if (!matchesMagic(encode("RIFF0000WEBP"), "image/webp"))
    throw Error("WebP rejected");
  if (!matchesMagic(encode("0000ftypisom"), "video/mp4"))
    throw Error("MP4 rejected");
  if (!matchesMagic(new Uint8Array([26, 69, 223, 163]), "video/webm"))
    throw Error("WebM rejected");
});
