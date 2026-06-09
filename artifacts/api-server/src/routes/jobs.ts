import { Router, type IRouter } from "express";
import { collections } from "@workspace/db";

const router: IRouter = Router();

router.get("/jobs", async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
  const accountPhone = req.query["accountPhone"] as string | undefined;

  const col = await collections.joinHistory();
  const filter: Record<string, any> = {};
  if (accountPhone) filter["accountPhone"] = accountPhone;

  const jobs = await col.find(filter).sort({ createdAt: -1 }).limit(limit).toArray();

  res.json(jobs.map((j) => ({
    id: j._id.toString(),
    accountPhone: j.accountPhone,
    linkUrl: j.linkUrl,
    status: j.status,
    errorCode: j.errorCode ?? null,
    errorMessage: j.errorMessage ?? null,
    createdAt: j.createdAt ? new Date(j.createdAt).toISOString() : new Date().toISOString(),
  })));
});

export default router;
