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

router.post("/links/bulk", async (req, res): Promise<void> => {
  const parsed = BulkAddLinksBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { urls, source } = parsed.data;
  let added = 0;
  let duplicates = 0;
  for (const url of urls) {
    try {
      await db.insert(groupLinksTable).values({ url, source: source ?? null });
      added++;
    } catch (e: any) {
      if (e.code === "23505") { duplicates++; } else { throw e; }
    }
  }
  res.status(201).json({ added, duplicates, total: urls.length });
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
