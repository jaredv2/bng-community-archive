import { connected, result } from "./supabase.js";
import { openPost } from "./gallery.js";

// Optional browser support: this opens the same approved post viewer as a card.
const context = document.modelContext;
if (
  context?.registerTool &&
  ["home", "gallery"].includes(document.body.dataset.page)
) {
  const lifecycle = new AbortController();
  try {
    Promise.resolve(
      context.registerTool(
        {
          name: "open_archive_post",
          description:
            "Open an approved Community Archive post in the visible post viewer.",
          inputSchema: {
            type: "object",
            properties: { id: { type: "string", format: "uuid" } },
            required: ["id"],
            additionalProperties: false,
          },
        annotations: { readOnlyHint: false, untrustedContentHint: true },
          async execute(input) {
            if (
              !input ||
              typeof input.id !== "string" ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                input.id,
              )
            )
              throw new Error("A valid post UUID is required.");
            const post = await result(
              connected()
                .from("posts")
                .select(
                  "id,username,caption,storage_path,media_type,likes,pinned,created_at",
                )
                .eq("id", input.id)
                .eq("status", "approved")
                .single(),
            );
            await openPost(post);
            if (!document.querySelector("dialog[open]"))
              throw new Error("Could not open the post.");
            return { id: post.id, opened: true };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
  } catch {
    /* Browsers without this experimental capability keep the normal UI. */
  }
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
