import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, joinJobsTable, accountsTable, groupLinksTable } from "@workspace/db";
import { ListJobsQueryParams, ListJobsResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/jobs", async (req, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  const limit = params.success && params.data.limit ? Number(params.data.limit) : 50;
  const accountId = params.success && params.data.accountId ? Number(params.data.accountId) : null;

  let jobs;
  if (accountId) {
    jobs = await db
      .select({
        id: joinJobsTable.id,
        accountId: joinJobsTable.accountId,
        accountPhone: accountsTable.phone,
        linkId: joinJobsTable.linkId,
        linkUrl: groupLinksTable.url,
        status: joinJobsTable.status,
        errorCode: joinJobsTable.errorCode,
        errorMessage: joinJobsTable.errorMessage,
        createdAt: joinJobsTable.createdAt,
      })
      .from(joinJobsTable)
      .leftJoin(accountsTable, eq(joinJobsTable.accountId, accountsTable.id))
      .leftJoin(groupLinksTable, eq(joinJobsTable.linkId, groupLinksTable.id))
      .where(eq(joinJobsTable.accountId, accountId))
      .orderBy(desc(joinJobsTable.createdAt))
      .limit(limit);
  } else {
    jobs = await db
      .select({
        id: joinJobsTable.id,
        accountId: joinJobsTable.accountId,
        accountPhone: accountsTable.phone,
        linkId: joinJobsTable.linkId,
        linkUrl: groupLinksTable.url,
        status: joinJobsTable.status,
        errorCode: joinJobsTable.errorCode,
        errorMessage: joinJobsTable.errorMessage,
        createdAt: joinJobsTable.createdAt,
      })
      .from(joinJobsTable)
      .leftJoin(accountsTable, eq(joinJobsTable.accountId, accountsTable.id))
      .leftJoin(groupLinksTable, eq(joinJobsTable.linkId, groupLinksTable.id))
      .orderBy(desc(joinJobsTable.createdAt))
      .limit(limit);
  }

  res.json(ListJobsResponse.parse(jobs.map((j) => ({
    ...j,
    createdAt: j.createdAt.toISOString(),
  }))));
});

export default router;
