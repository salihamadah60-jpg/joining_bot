import { Router, type IRouter } from "express";
import { collections } from "@workspace/db";

const router: IRouter = Router();

router.get("/channels", async (req, res): Promise<void> => {
  const col = await collections.channels();
  const channels = await col.find({}).sort({ detectedAt: -1 }).toArray();
  res.json(channels.map((c) => ({
    id: c._id.toString(),
    url: c.url,
    title: c.title ?? null,
    detectedAt: c.detectedAt ? new Date(c.detectedAt).toISOString() : new Date().toISOString(),
  })));
});

/**
 * Export all channel links as a plain-text file (UTF-8, numbered list).
 */
router.get("/channels/export", async (req, res): Promise<void> => {
  const col = await collections.channels();
  const channels = await col.find({}).sort({ detectedAt: -1 }).toArray();

  const dateStr = new Date().toLocaleString("ar-SA", { timeZone: "Asia/Riyadh" });
  const lines = channels.map(
    (c, i) => `${i + 1}. ${c.title ? `${c.title}  —  ` : ""}${c.url}`
  );

  const content = [
    `قائمة القنوات المكتشفة`,
    `عدد القنوات: ${channels.length}`,
    `تاريخ التصدير: ${dateStr}`,
    ``,
    ...lines,
  ].join("\n");

  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="channels_${Date.now()}.txt"; filename*=UTF-8''channels_${Date.now()}.txt`
  );
  res.send(content);
});

export default router;
