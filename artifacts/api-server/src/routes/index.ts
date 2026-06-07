import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import linksRouter from "./links";
import jobsRouter from "./jobs";
import collectionsRouter from "./collections";
import botRouter from "./bot";
import authRouter from "./auth";
import settingsRouter from "./settings";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(linksRouter);
router.use(jobsRouter);
router.use(collectionsRouter);
router.use(botRouter);
router.use(authRouter);
router.use(settingsRouter);

export default router;
