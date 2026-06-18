/**
 * FOLDER ROUTES — Feature 5: Telegram Folder Management
 *
 * GET  /api/accounts/:phone/folders             — list all folders on an account
 * POST /api/accounts/:phone/folders/medical     — create "medical groups" folder
 * POST /api/accounts/:phone/folders             — create custom folder
 * DELETE /api/accounts/:phone/folders/:id       — delete a folder by ID
 */

import { Router, type IRouter } from "express";
import { ObjectId } from "mongodb";
import { collections } from "@workspace/db";
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

// GET /api/accounts/:phone/synced-dialogs — return synced_dialogs for this account
router.get("/accounts/:phone/synced-dialogs", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const syncedCol = await collections.syncedDialogs();
    const dialogs = await syncedCol.find({ accountPhone: phone }).sort({ title: 1 }).toArray();
    res.json({
      dialogs: dialogs.map((d) => ({
        _id: d._id.toString(),
        accountPhone: d.accountPhone,
        chatId: d.chatId,
        title: d.title,
        username: d.username,
        url: d.url,
        chatType: d.chatType,
        syncedAt: d.syncedAt,
        folderId: (d as any).folderId ?? null,
        folderTitle: (d as any).folderTitle ?? null,
      })),
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/accounts/:phone/folders/from-ids — create folder from selected dialog IDs + record assignments
router.post("/accounts/:phone/folders/from-ids", async (req, res): Promise<void> => {
  try {
    const phone = decodeURIComponent(req.params["phone"]!);
    const { title, dialogIds, emoticon } = req.body as {
      title: string;
      dialogIds: string[];
      emoticon?: string;
    };

    if (!title?.trim()) { res.status(400).json({ error: "title required" }); return; }
    if (!Array.isArray(dialogIds) || dialogIds.length === 0) { res.status(400).json({ error: "dialogIds array required" }); return; }

    const syncedCol = await collections.syncedDialogs();

    // Fetch selected dialogs from DB
    const objectIds = dialogIds.map((id) => new ObjectId(id));
    const selectedDocs = await syncedCol.find({
      accountPhone: phone,
      _id: { $in: objectIds },
    }).toArray();

    if (selectedDocs.length === 0) {
      res.status(400).json({ error: "None of the provided IDs found in synced_dialogs" });
      return;
    }

    // Create folder on Telegram
    const result = await createAccountFolder(
      phone,
      title.trim(),
      selectedDocs.map((d) => ({ username: d.username, chatId: d.chatId, chatType: d.chatType })),
      emoticon
    );

    // Record folder assignment in synced_dialogs (even if partially added)
    if (result.ok) {
      await syncedCol.updateMany(
        { accountPhone: phone, _id: { $in: selectedDocs.map((d) => d._id) } },
        { $set: { folderId: result.folderId, folderTitle: title.trim() } }
      );
    }

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
