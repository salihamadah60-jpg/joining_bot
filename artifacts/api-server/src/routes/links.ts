import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, groupLinksTable } from "@workspace/db";
import {
  ListLinksQueryParams,
  ListLinksResponse,
  AddLinkBody,
  BulkAddLinksBody,
  DeleteLinkParams,
  GetLinksStatsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/links/stats", async (req, res): Promise<void> => {
  const links = await db.select().from(groupLinksTable);
  const stats = {
    total: links.length,
    pending: links.filter((l) => l.status === "pending").length,
    joined: links.filter((l) => l.status === "joined").length,
    failed: links.filter((l) => l.status === "failed").length,
    skipped: links.filter((l) => l.status === "skipped").length,
  };
  res.json(GetLinksStatsResponse.parse(stats));
});

router.get("/links", async (req, res): Promise<void> => {
  const params = ListLinksQueryParams.safeParse(req.query);
  let query = db.select().from(groupLinksTable);
  const filters = [];
  if (params.success && params.data.status) {
    filters.push(eq(groupLinksTable.status, params.data.status));
  }
  if (params.success && params.data.source) {
    filters.push(eq(groupLinksTable.source, params.data.source));
  }
  let links;
  if (filters.length === 1) {
    links = await db.select().from(groupLinksTable).where(filters[0]).orderBy(groupLinksTable.createdAt);
  } else {
    links = await db.select().from(groupLinksTable).orderBy(groupLinksTable.createdAt);
  }
  res.json(ListLinksResponse.parse(links.map(serializeLink)));
});

router.post("/links", async (req, res): Promise<void> => {
  const parsed = AddLinkBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  try {
    const [link] = await db.insert(groupLinksTable).values({ url: parsed.data.url, source: parsed.data.source ?? null }).returning();
    res.status(201).json(serializeLink(link));
  } catch (e: any) {
    if (e.code === "23505") { res.status(409).json({ error: "Link already exists" }); return; }
    throw e;
  }
});

/** Extract all valid Telegram URLs from a raw text blob (mixed text + links). */
function extractTelegramUrls(rawText: string): string[] {
  // Match: https://t.me/..., t.me/..., @username
  const pattern = /(?:https?:\/\/t\.me\/[^\s"'<>\u0600-\u06FF]+|t\.me\/[^\s"'<>\u0600-\u06FF]+|@[a-zA-Z][a-zA-Z0-9_]{3,})/gi;
  const matches = rawText.match(pattern) ?? [];
  // Normalise: ensure https:// prefix, strip trailing punctuation
  const normalised = matches.map((u) => {
    let url = u.trim().replace(/[,;.،؛]+$/, "");
    if (url.startsWith("@")) return `https://t.me/${url.slice(1)}`;
    if (!url.startsWith("http")) return `https://${url}`;
    return url;
  });
  // Deduplicate (case-insensitive)
  const seen = new Set<string>();
  return normalised.filter((u) => {
    const key = u.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

router.post("/links/bulk", async (req, res): Promise<void> => {
  // Accept either { urls: string[] } or { rawText: string } or plain text body
  let rawUrls: string[] = [];
  const body = req.body as any;

  if (body?.rawText && typeof body.rawText === "string") {
    // Extract URLs from mixed text
    rawUrls = extractTelegramUrls(body.rawText);
  } else {
    const parsed = BulkAddLinksBody.safeParse(body);
    if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
    // Each entry in urls may itself be a mixed-text line — re-extract to be safe
    const allText = parsed.data.urls.join("\n");
    rawUrls = extractTelegramUrls(allText);
    // If no telegram URLs found, use the original list as-is (non-telegram links)
    if (rawUrls.length === 0) rawUrls = parsed.data.urls;
  }

  const source = body?.source ?? null;
  let added = 0;
  let duplicates = 0;
  let errors = 0;

  for (const url of rawUrls) {
    try {
      await db.insert(groupLinksTable).values({ url, source });
      added++;
    } catch (e: any) {
      if (e.code === "23505") { duplicates++; } else { errors++; }
    }
  }
  res.status(201).json({ added, duplicates, errors, total: rawUrls.length, extracted: rawUrls.length });
});

router.post("/links/:id/retry", async (req, res): Promise<void> => {
  const id = Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [updated] = await db
    .update(groupLinksTable)
    .set({ status: "pending", retryAfter: null, failReason: null })
    .where(eq(groupLinksTable.id, id))
    .returning();
  if (!updated) { res.status(404).json({ error: "Link not found" }); return; }
  res.json(serializeLink(updated));
});

router.delete("/links/:id", async (req, res): Promise<void> => {
  const params = DeleteLinkParams.safeParse({ id: Number(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id) });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }
  const [deleted] = await db.delete(groupLinksTable).where(eq(groupLinksTable.id, params.data.id)).returning();
  if (!deleted) { res.status(404).json({ error: "Link not found" }); return; }
  res.sendStatus(204);
});

function serializeLink(l: typeof groupLinksTable.$inferSelect) {
  return {
    ...l,
    createdAt: l.createdAt.toISOString(),
    processedAt: l.processedAt ? l.processedAt.toISOString() : null,
  };
}

export default router;
