import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { types, matchesMagic } from "./media.ts";

const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anon = Deno.env.get("SUPABASE_ANON_KEY")!;

const service = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const media = service.storage.from("community-media");
const posters = service.storage.from("community-posters");

const origins = (Deno.env.get("ALLOWED_ORIGINS") || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const number = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const LIMITS = {
  image: number(Deno.env.get("MAX_IMAGE_SIZE"), 26214400),
  video: number(Deno.env.get("MAX_VIDEO_SIZE"), 52428800),
  gif: number(Deno.env.get("MAX_GIF_SIZE"), 26214400),
  poster: number(Deno.env.get("MAX_POSTER_SIZE"), 2097152),
  total: number(Deno.env.get("MAX_TOTAL_BYTES"), 858993459),
  albums: number(Deno.env.get("ALBUMS_PER_HOUR"), 5),
  reports: number(Deno.env.get("REPORTS_PER_HOUR"), 10),
  items: number(Deno.env.get("ITEMS_PER_ALBUM"), 200),
};

const ALLOWED_TAG = /^[a-z0-9][a-z0-9_-]{0,31}$/;

const check = (value: unknown, max: number, label: string): string => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max)
    throw new Error(`Invalid ${label}.`);
  return value.trim();
};

const cleanTag = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^#+/, "")
    .replace(/[^a-z0-9_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);

const tagList = (caption: string, extra: unknown) => {
  const out: string[] = [];
  const push = (raw: string) => {
    const tag = cleanTag(raw);
    if (!tag || !ALLOWED_TAG.test(tag) || out.includes(tag)) return;
    if (out.length < 5) out.push(tag);
  };
  for (const found of caption.match(/#[a-z0-9_-]+/gi) || []) push(found);
  if (Array.isArray(extra))
    for (const raw of extra.slice(0, 5)) if (typeof raw === "string") push(raw);
  return out;
};

const hash = async (value: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

async function result<T>(promise: PromiseLike<{ data: T; error: unknown }>) {
  const { data, error } = await promise;
  if (error) throw new Error("The archive could not complete this request. Please try again.");
  return data as NonNullable<T>;
}

async function authorize(req: Request) {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Administrator sign-in required.");
  const client = createClient(url, anon, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user || !(await result(client.rpc("is_admin"))))
    throw new Error("Administrator access expired or denied.");
}

async function readBody(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Request body required.");
  const bytes: number[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (bytes.length + value.length > 8192) throw new Error("Request too large.");
      bytes.push(...value);
    }
  } finally {
    await reader.cancel();
  }
  return JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
}

const clientKey = (req: Request, scope: string) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return hash(`${scope}:${ip}`);
};

const limit = (key: string, allowed: number, seconds = 3600) =>
  result(service.rpc("consume_limit", { rate_key: key, allowed, window_seconds: seconds }));

const mediaType = (mime: string) =>
  mime.startsWith("video/") ? "video" : mime === "image/gif" ? "gif" : "image";

const uniqueSlug = async (title: string) => {
  const base =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "album";
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix ? `${base}-${suffix + 1}` : base;
    if (await result(service.rpc("is_unique_slug", { candidate }))) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
};

const uuid = (value: unknown) =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const headers = {
    "Access-Control-Allow-Origin": origins.includes(origin) ? origin : "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
    "Content-Type": "application/json",
  };
  if (req.method === "OPTIONS") {
    // Answer the preflight only for allowed origins. Returning "null" here is
    // what produces the confusing browser error people hit when this is unset.
    if (!origins.includes(origin))
      return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    return new Response(null, { status: 204, headers });
  }
  if (req.method !== "POST")
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405, headers });

  try {
    if (!origins.includes(origin)) {
      // A rejected preflight is opaque in the browser, so name the offender.
      console.warn(
        `archive: origin not allowed: ${origin || "(none)"}. ALLOWED_ORIGINS=${origins.join(", ") || "(empty)"}`,
      );
      throw new Error("This address is not allowed to connect.");
    }
    if (Number(req.headers.get("content-length") || 0) > 8192)
      throw new Error("Request too large.");
    const body = await readBody(req);
    let output: unknown;

    if (body.action === "reserve") {
      if (!(await limit(clientKey(req, "upload"), 10))) throw new Error("Too many uploads. Try again in an hour.");
      const used = Number(await result(service.rpc("used_storage")));
      if (used + Number(body.size) > LIMITS.total)
        throw new Error("The archive is full right now. Please try again later.");

      const username = check(body.username, 60, "name");
      const caption = check(body.caption, 1000, "caption");
      if (!Object.hasOwn(types, body.ext) || types[body.ext] !== body.mime)
        throw new Error("Unsupported media type.");
      const kind = mediaType(body.mime);
      const max = kind === "video" ? LIMITS.video : kind === "gif" ? LIMITS.gif : LIMITS.image;
      if (!Number.isSafeInteger(body.size) || body.size <= 0 || body.size > max)
        throw new Error("That file is too large or empty.");

      const id = crypto.randomUUID();
      const token = crypto.randomUUID() + crypto.randomUUID();
      const path = `${id}_${Date.now()}.${body.ext}`;
      // A poster slot is only created when the caller genuinely has one, and
      // the two urls are always issued together so neither can come back null.
      const posterPath = body.has_poster === true ? `${id}_poster.webp` : null;

      await result(
        service.from("posts").insert({
          id,
          username,
          caption,
          storage_path: path,
          poster_path: posterPath,
          mime: body.mime,
          media_type: kind,
          expected_size: body.size,
          width: Number.isSafeInteger(body.width) ? body.width : null,
          height: Number.isSafeInteger(body.height) ? body.height : null,
          upload_token_hash: await hash(token),
        }),
      );
      await result(
        service.rpc("attach_tags", { post_id: id, tag_list: tagList(caption, body.tags) }),
      );

      try {
        const signed = await result(media.createSignedUploadUrl(path, { upsert: false }));
        if (!signed.signedUrl) throw new Error("Could not open an upload slot.");
        let posterUrl: string | null = null;
        if (posterPath) {
          const posterSlot = await result(
            posters.createSignedUploadUrl(posterPath, { upsert: false }),
          );
          posterUrl = posterSlot.signedUrl || null;
        }
        // Both slots are resolved before anything is handed back, so the client
        // never receives a half filled reservation.
        output = { id, token, url: signed.signedUrl, poster_url: posterUrl };
      } catch (error) {
        await service.from("posts").delete().eq("id", id);
        if (posterPath) await posters.remove([posterPath]).catch(() => {});
        throw error;
      }
    } else if (body.action === "finalize") {
      const id = check(body.id, 36, "submission");
      const token = check(body.token, 100, "upload token");
      const post = await result(service.from("posts").select("*").eq("id", id).single());
      if (post.upload_token_hash !== (await hash(token)) || post.status !== "pending")
        throw new Error("Upload verification failed.");

      if (!post.uploaded) {
        const meta = await result(service.rpc("storage_metadata", { object_path: post.storage_path }));
        if (!meta || Number(meta.size) !== post.expected_size || meta.mimetype !== post.mime)
          throw new Error("The uploaded file does not match the submission.");

        const signed = await result(media.createSignedUrl(post.storage_path, 60));
        const response = await fetch(signed.signedUrl, { headers: { Range: "bytes=0-511" } });
        if (!response.ok || !response.body) throw new Error("Could not verify the media.");
        const reader = response.body.getReader();
        const chunks: number[] = [];
        while (chunks.length < 512) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(...value.slice(0, 512 - chunks.length));
        }
        await reader.cancel();
        if (!matchesMagic(new Uint8Array(chunks), post.mime)) {
          await media.remove([post.storage_path]);
          if (post.poster_path) await posters.remove([post.poster_path]);
          await service.from("posts").update({ status: "rejected" }).eq("id", id);
          throw new Error("That file is not really the type you picked.");
        }

        if (post.poster_path) {
          const posterMeta = await result(
            service.rpc("poster_metadata", { object_path: post.poster_path }),
          );
          if (posterMeta && Number(posterMeta.size) > LIMITS.poster)
            await posters.remove([post.poster_path]).then(() =>
              service.from("posts").update({ poster_path: null }).eq("id", id),
            );
        }
        // Verified, so it goes live. The row is inserted pending because the
        // table refuses to mark anything approved before it has been uploaded.
        const published = await result(
          service
            .from("posts")
            .update({
              uploaded: true,
              status: "approved",
              approved_at: new Date().toISOString(),
            })
            .eq("id", id)
            .eq("status", "pending")
            .select("id"),
        );
        if (!published.length) throw new Error("That one has already been dealt with.");
      }
      output = { success: true, published: true };
    } else if (body.action === "create-album") {
      if (!(await limit(clientKey(req, "album"), LIMITS.albums)))
        throw new Error("You have made a few albums already. Try again in an hour.");
      const title = check(body.title, 80, "title");
      output = await result(
        service
          .from("albums")
          .insert({
            title,
            description: check(body.description, 400, "description"),
            creator_name: check(body.creator_name, 60, "name"),
            slug: await uniqueSlug(title),
          })
          .select("id,slug,title,description,creator_name,created_at")
          .single(),
      );
    } else if (body.action === "album-add") {
      if (!(await limit(clientKey(req, "album-item"), 40)))
        throw new Error("Slow down a moment before adding more memories.");
      const albumId = check(body.album_id, 36, "album");
      const postId = check(body.post_id, 36, "memory");
      const album = await result(service.from("albums").select("id").eq("id", albumId).maybeSingle());
      if (!album || album.hidden) throw new Error("That album is not available.");
      const size = Number(await result(service.rpc("album_size", { album_id: albumId })));
      if (size >= LIMITS.items) throw new Error("That album is full.");
      const post = await result(
        service.from("posts").select("id").eq("id", postId).eq("status", "approved").maybeSingle(),
      );
      if (!post) throw new Error("That memory is not available.");
      await result(
        service.from("album_items").insert({ album_id: albumId, post_id: postId, position: size }),
      );
      output = { success: true };
    } else if (body.action === "album-remove") {
      const albumId = check(body.album_id, 36, "album");
      const postId = check(body.post_id, 36, "memory");
      await result(
        service
          .from("album_items")
          .delete()
          .eq("album_id", albumId)
          .eq("post_id", postId),
      );
      output = { success: true };
    } else if (body.action === "report") {
      if (!(await limit(clientKey(req, "report"), LIMITS.reports)))
        throw new Error("You have sent a few reports already. Try again in an hour.");
      const targetType = check(body.target_type, 10, "target");
      if (!["post", "album", "comment"].includes(targetType)) throw new Error("Invalid target.");
      const targetId = check(body.target_id, 36, "target");
      output = await result(
        service
          .from("reports")
          .insert({ target_type: targetType, target_id: targetId, reason: check(body.reason, 300, "reason") })
          .select("id")
          .single(),
      );
    } else {
      await authorize(req);
      const id = uuid(body.id) ? body.id : check(body.id, 36, "item");

      if (body.action === "list") {
        if (!["pending", "approved"].includes(body.status)) throw new Error("Invalid status.");
        const page = Number.isInteger(body.page) && body.page >= 0 ? body.page : 0;
        const posts = await result(
          service
            .from("posts")
            .select("id,username,caption,storage_path,poster_path,media_type,mime,width,height,pinned,created_at,tags(name)")
            .eq("status", body.status)
            .eq("uploaded", true)
            .order("created_at", { ascending: false })
            .order("id")
            .range(page * 20, page * 20 + 19),
        );
        const paths = posts.map((post) => post.storage_path);
        const posterPaths = posts.map((post) => post.poster_path).filter(Boolean) as string[];
        const [signed, signedPosters] = await Promise.all([
          paths.length ? result(media.createSignedUrls(paths, 3600)) : [],
          posterPaths.length ? result(posters.createSignedUrls(posterPaths, 3600)) : [],
        ]);
        let posterAt = 0;
        output = {
          posts: posts.map((post, index) => ({
            ...post,
            url: signed[index]?.signedUrl || null,
            poster: post.poster_path ? signedPosters[posterAt++]?.signedUrl || null : null,
          })),
        };
      } else if (body.action === "approve") {
        // Only ever used for a row that was reserved but never finalised.
        const rows = await result(
          service
            .from("posts")
            .update({ status: "approved", approved_at: new Date().toISOString() })
            .eq("id", id)
            .eq("uploaded", true)
            .eq("status", "pending")
            .select("id"),
        );
        if (!rows.length) throw new Error("That one has already been dealt with.");
        output = { success: true };
      } else if (body.action === "unpublish") {
        // Takes a live memory down and frees its files. This is the only
        // removal path now that everything publishes on arrival.
        const rows = await result(
          service
            .from("posts")
            .update({ status: "rejected" })
            .eq("id", id)
            .eq("status", "approved")
            .select("storage_path,poster_path"),
        );
        if (!rows.length) throw new Error("That one is not live.");
        const originals: string[] = [];
        const thumbnails: string[] = [];
        for (const row of rows) {
          if (row.storage_path) originals.push(row.storage_path);
          if (row.poster_path) thumbnails.push(row.poster_path);
        }
        if (originals.length) await result(media.remove(originals));
        if (thumbnails.length) await result(posters.remove(thumbnails));
        output = { success: true };
      } else if (body.action === "reject") {
        const rows = await result(
          service
            .from("posts")
            .update({ status: "rejected" })
            .eq("id", id)
            .eq("status", "pending")
            .select("storage_path,poster_path"),
        );
        if (!rows.length) throw new Error("That one has already been reviewed.");
        const files: string[] = [];
        for (const row of rows) {
          if (row.storage_path) files.push(row.storage_path);
          if (row.poster_path) files.push(row.poster_path);
        }
        await result(media.remove(files.filter((path) => !path.endsWith("_poster.webp"))));
        await result(posters.remove(files.filter((path) => path.endsWith("_poster.webp"))));
        output = { success: true };
      } else if (body.action === "pin") {
        if (typeof body.pinned !== "boolean") throw new Error("Invalid pin state.");
        const rows = await result(
          service
            .from("posts")
            .update({ pinned: body.pinned })
            .eq("id", id)
            .eq("status", "approved")
            .select("id"),
        );
        if (!rows.length) throw new Error("That one is not available.");
        output = { success: true };
      } else if (body.action === "admin-albums") {
        const albums = await result(
          service
            .from("albums")
            .select("id,title,creator_name,created_at,hidden,album_items(count)")
            .order("created_at", { ascending: false })
            .limit(200),
        );
        output = {
          albums: albums.map((album) => ({
            ...album,
            count: (album.album_items as unknown as { count: number }[])?.[0]?.count || 0,
          })),
        };
      } else if (body.action === "album-hide" || body.action === "album-show") {
        const rows = await result(
          service.from("albums").update({ hidden: body.action === "album-hide" }).eq("id", id).select("id"),
        );
        if (!rows.length) throw new Error("That album is not available.");
        output = { success: true };
      } else if (body.action === "album-delete") {
        await result(service.from("albums").delete().eq("id", id));
        output = { success: true };
      } else if (body.action === "admin-reports") {
        const reports = await result(
          service
            .from("reports")
            .select("id,target_type,target_id,reason,resolved,created_at")
            .eq("resolved", false)
            .order("created_at", { ascending: false })
            .limit(100),
        );
        const titles = await Promise.all(
          reports.map(async (report) => {
            const table =
              report.target_type === "album"
                ? "albums"
                : report.target_type === "post"
                  ? "posts"
                  : "comments";
            const column = report.target_type === "album" ? "title" : table === "posts" ? "caption" : "content";
            const row = await result(
              service.from(table).select(column).eq("id", report.target_id).maybeSingle(),
            );
            return { id: report.id, title: row ? String((row as Record<string, unknown>)[column]).slice(0, 90) : null };
          }),
        );
        output = {
          reports: reports.map((report, index) => ({ ...report, title: titles[index].title })),
        };
      } else if (body.action === "report-dismiss" || body.action === "report-hide-item") {
        if (body.action === "report-hide-item") {
          if (body.target_type === "album")
            await result(service.from("albums").update({ hidden: true }).eq("id", body.target_id));
          else if (body.target_type === "post")
            await result(
              service.from("posts").update({ status: "rejected" }).eq("id", body.target_id).eq("status", "approved"),
            );
        }
        await result(service.from("reports").update({ resolved: true }).eq("id", id));
        output = { success: true };
      } else throw new Error("Unknown action.");
    }
    return new Response(JSON.stringify(output), { headers });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Request failed." }),
      { status: 400, headers },
    );
  }
});
