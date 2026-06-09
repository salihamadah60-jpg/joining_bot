/**
 * Import sessions from tg_sessions collection into the accounts collection.
 * Both collections are in the same MongoDB database (Joining_links).
 * No PostgreSQL dependency.
 */
import { MongoClient, ObjectId } from "mongodb";

const MONGODB_URL = process.env["MONGODB_URL"];
if (!MONGODB_URL) throw new Error("MONGODB_URL غير موجود");

const mongo = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
await mongo.connect();
console.log("✓ تم الاتصال بـ MongoDB");

function extractDbName(url: string): string {
  try {
    const match = url.match(/\/([^/?#]+)(\?|$)/);
    if (match && match[1] && !match[1].startsWith("mongodb")) return match[1];
  } catch {}
  return "Joining_links";
}

const dbName = extractDbName(MONGODB_URL);
const db = mongo.db(dbName);
const collections = await db.listCollections().toArray();
console.log(`Collections في ${dbName}:`, collections.map((c) => c.name).join(", "));

const docs = await db.collection("tg_sessions").find({}).toArray();
console.log(`✓ وجدت ${docs.length} سجل في tg_sessions`);

if (docs.length === 0) {
  console.log("لا يوجد بيانات للاستيراد.");
  await mongo.close();
  process.exit(0);
}

const accountsCol = db.collection("accounts");
// Ensure unique index on phone
await accountsCol.createIndex({ phone: 1 }, { unique: true });

let imported = 0, updated = 0, errors = 0;

function getDefaultDevice(phone: string) {
  const hash = phone.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const devices = [
    { deviceModel: "Samsung Galaxy S23", systemVersion: "Android 14", appVersion: "10.9.1", systemLangCode: "ar" },
    { deviceModel: "Xiaomi 13 Pro", systemVersion: "Android 13", appVersion: "10.9.0", systemLangCode: "ar" },
    { deviceModel: "iPhone 14 Pro", systemVersion: "iOS 17.0", appVersion: "10.9.1", systemLangCode: "ar" },
    { deviceModel: "OnePlus 11", systemVersion: "Android 13", appVersion: "10.8.9", systemLangCode: "ar" },
  ];
  return devices[hash % devices.length]!;
}

for (const doc of docs) {
  const phone = String(doc["phone"] ?? "").trim();
  if (!phone || phone.length < 5) { errors++; continue; }

  const sessionString = (doc["sessionString"] ?? doc["session_string"] ?? null) as string | null;
  const label = (doc["label"] ?? null) as string | null;
  const status = String(doc["status"] ?? "active") === "paused" ? "paused" : "active";
  const joinedCount = Number(doc["joinedCount"] ?? doc["joined_count"] ?? 0);
  const deviceModel = (doc["deviceModel"] ?? doc["device_model"] ?? null) as string | null;
  const systemVersion = (doc["systemVersion"] ?? doc["system_version"] ?? null) as string | null;
  const device = getDefaultDevice(phone);

  try {
    const existing = await accountsCol.findOne({ phone }, { projection: { _id: 1, sessionString: 1 } });

    if (!existing) {
      const now = new Date();
      await accountsCol.insertOne({
        _id: new ObjectId(),
        phone,
        label,
        status,
        sessionString,
        joinedCount,
        failedCount: 0,
        joinedToday: 0,
        dailyLimit: 85,
        currentDelay: 1030,
        floodWaitUntil: null,
        lastJoinAt: null,
        nextJoinAllowedAt: null,
        dailyResetAt: null,
        channelsCount: 0,
        isPremium: false,
        deviceModel: deviceModel ?? device.deviceModel,
        systemVersion: systemVersion ?? device.systemVersion,
        appVersion: device.appVersion,
        systemLangCode: device.systemLangCode,
        createdAt: now,
        updatedAt: now,
      });
      console.log(`  + جديد: ${phone} (${label ?? "—"}) | ${deviceModel ?? device.deviceModel} | session: ${sessionString ? "✓" : "✗"}`);
      imported++;
    } else {
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (label) updates["label"] = label;
      if (deviceModel) updates["deviceModel"] = deviceModel;
      if (systemVersion) updates["systemVersion"] = systemVersion;
      if (joinedCount > 0) updates["joinedCount"] = joinedCount;
      if (sessionString && !existing.sessionString) updates["sessionString"] = sessionString;

      if (Object.keys(updates).length > 1) {
        await accountsCol.updateOne({ phone }, { $set: updates });
        console.log(`  ↺ محدّث: ${phone} (${label ?? "—"})`);
        updated++;
      } else {
        console.log(`  = بدون تغيير: ${phone}`);
      }
    }
  } catch (e) {
    console.error(`  ✗ خطأ في ${phone}: ${(e as Error).message}`);
    errors++;
  }
}

await mongo.close();

console.log(`\n══════════════════════════════`);
console.log(`المصدر: ${dbName}.tg_sessions`);
console.log(`الهدف:  ${dbName}.accounts`);
console.log(`جديد:   ${imported}`);
console.log(`محدّث:  ${updated}`);
console.log(`أخطاء:  ${errors}`);
console.log(`الإجمالي: ${docs.length}`);
