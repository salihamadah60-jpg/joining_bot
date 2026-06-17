/**
 * FOLDER ROUTES — Feature 5: Telegram Folder Management
 *
 * GET  /api/accounts/:phone/folders             — list all folders on an account
 * POST /api/accounts/:phone/folders/medical     — create "medical groups" folder
 * POST /api/accounts/:phone/folders             — create custom folder
 * DELETE /api/accounts/:phone/folders/:id       — delete a folder by ID
 */

import { Router, type IRouter } from "express";
import {
  getAccountFolders,
  createAccountFolder,
  createMedicalGroupsFolder,
  deleteAccountFolder,
} from "../lib/folderEngine.js";

const router: IRouter = Router();

// GET /api/accounts/:phone/folders
router.get("/accounts/:phone/folders", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const folders = await getAccountFolders(phone);
    res.json({ folders });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/accounts/:phone/folders/medical
router.post("/accounts/:phone/folders/medical", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const { title } = (req.body ?? {}) as { title?: string };
    const result = await createMedicalGroupsFolder(phone, title);
    if (!result.ok) {
      res.status(400).json(result);
    } else {
      res.json(result);
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/accounts/:phone/folders — create custom folder with explicit dialogs
router.post("/accounts/:phone/folders", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const { title, dialogs, emoticon } = req.body as {
      title: string;
      dialogs: { username?: string; chatId?: string; chatType?: string }[];
      emoticon?: string;
    };
    if (!title) { res.status(400).json({ error: "title required" }); return; }
    if (!Array.isArray(dialogs) || dialogs.length === 0) { res.status(400).json({ error: "dialogs array required" }); return; }

    const result = await createAccountFolder(phone, title, dialogs, emoticon);
    if (!result.ok) res.status(400).json(result);
    else res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/accounts/:phone/folders/:id
router.delete("/accounts/:phone/folders/:id", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const id = Number(req.params["id"]);
    if (isNaN(id)) { res.status(400).json({ error: "invalid folder id" }); return; }
    const result = await deleteAccountFolder(phone, id);
    if (!result.ok) res.status(400).json(result);
    else res.json(result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
