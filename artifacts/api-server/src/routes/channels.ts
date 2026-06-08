import { Router, type IRouter } from "express";
import { db, channelLinksTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();

router.get("/channels", async (req, res): Promise<void> => {
  const channels = await db
    .select()
    .from(channelLinksTable)
    .orderBy(desc(channelLinksTable.detectedAt));
  res.json(
    channels.map((c) => ({
      id: c.id,
      url: c.url,
      title: c.title,
      detectedAt: c.detectedAt.toISOString(),
    }))
  );
});

/**
 * Export all channel links as a plain-text file (UTF-8, numbered list).
 * The file can be opened directly in Word/LibreOffice.
 */
router.get("/channels/export", async (req, res): Promise<void> => {
  const channels = await db
    .select()
    .from(channelLinksTable)
    .orderBy(desc(channelLinksTable.detectedAt));

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
