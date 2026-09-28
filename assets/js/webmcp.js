import { connected, result, signPosts } from "./data.js";
import { openLightbox } from "./lightbox.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS =
  "id,username,caption,storage_path,poster_path,media_type,width,height,likes,pinned,created_at,tags(name),comments(count)";

// Lets an assistant open a memory directly. Browsers without this just skip it.
export async function openById(id) {
  if (typeof id !== "string" || !UUID.test(id)) throw new Error("A valid memory id is required.");
  const post = await result(
    connected()
      .from("posts")
      .select(FIELDS)
      .eq("id", id)
      .eq("status", "approved")
      .single(),
  );
  const [signed] = await signPosts([post]);
  openLightbox(signed, [signed]);
  return { id: signed.id, username: signed.username };
}

const context = document.modelContext;
if (context?.registerTool && ["home", "gallery", "search"].includes(document.body.dataset.page)) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(
      context.registerTool(
        {
          name: "open_archive_memory",
          description: "Open an approved memory from the Community Archive in the viewer.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", format: "uuid" } },
            required: ["id"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            return openById(input?.id);
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Not supported in this browser. The normal UI is unaffected. */
  }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
