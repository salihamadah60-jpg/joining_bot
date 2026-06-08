import { Router, type IRouter } from "express";
import healthRouter from "./health";
import accountsRouter from "./accounts";
import linksRouter from "./links";
import jobsRouter from "./jobs";
import collectionsRouter from "./collections";
import channelsRouter from "./channels";
import botRouter from "./bot";
import authRouter from "./auth";
import settingsRouter from "./settings";
import eventsRouter from "./events";
import analyticsRouter from "./analytics";
import sessionsRouter from "./sessions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(accountsRouter);
router.use(linksRouter);
router.use(jobsRouter);
router.use(collectionsRouter);
router.use(channelsRouter);
router.use(botRouter);
router.use(authRouter);
router.use(settingsRouter);
router.use(eventsRouter);
router.use(analyticsRouter);
router.use(sessionsRouter);

export default router;
