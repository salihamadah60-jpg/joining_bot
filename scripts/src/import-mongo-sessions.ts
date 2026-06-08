import { MongoClient } from "mongodb";
import pg from "pg";

const MONGODB_URL = process.env["MONGODB_URL"];
const DATABASE_URL = process.env["DATABASE_URL"];

if (!MONGODB_URL) throw new Error("MONGODB_URL غير موجود");
if (!DATABASE_URL) throw new Error("DATABASE_URL غير موجود");

const mongo = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
const pgClient = new pg.Client({ connectionString: DATABASE_URL });

await mongo.connect();
await pgClient.connect();
console.log("✓ تم الاتصال بـ MongoDB و PostgreSQL");

const db = mongo.db("Joining_links");
const collections = await db.listCollections().toArray();
console.log("Collections في Joining_links:", collections.map((c) => c.name).join(", "));

const docs = await db.collection("tg_sessions").find({}).toArray();
console.log(`✓ وجدت ${docs.length} سجل في tg_sessions`);

if (docs.length === 0) {
  console.log("لا يوجد بيانات للاستيراد.");
  await mongo.close();
  await pgClient.end();
  process.exit(0);
}

let imported = 0, updated = 0, errors = 0;

for (const doc of docs) {
  const phone = String(doc["phone"] ?? "").trim();
  if (!phone || phone.length < 5) { errors++; continue; }

  const sessionString = (doc["sessionString"] ?? doc["session_string"] ?? null) as string | null;
  const label = (doc["label"] ?? null) as string | null;
  const status = String(doc["status"] ?? "active") === "paused" ? "paused" : "active";
  const joinedCount = Number(doc["joinedCount"] ?? doc["joined_count"] ?? 0);
  const deviceModel = (doc["deviceModel"] ?? doc["device_model"] ?? null) as string | null;
  const systemVersion = (doc["systemVersion"] ?? doc["system_version"] ?? null) as string | null;

  try {
    const res = await pgClient.query(
      `INSERT INTO accounts (phone, label, status, session_string, joined_count, device_model, system_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (phone) DO UPDATE SET
         session_string = COALESCE(EXCLUDED.session_string, accounts.session_string),
         label          = COALESCE(EXCLUDED.label, accounts.label),
         status         = EXCLUDED.status,
         joined_count   = GREATEST(EXCLUDED.joined_count, accounts.joined_count),
         device_model   = COALESCE(EXCLUDED.device_model, accounts.device_model),
         system_version = COALESCE(EXCLUDED.system_version, accounts.system_version),
         updated_at     = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [phone, label, status, sessionString, joinedCount, deviceModel, systemVersion]
    );
    if (res.rows[0]?.inserted) {
      console.log(`  + جديد: ${phone} (${label ?? "—"}) | ${deviceModel ?? "—"} | session: ${sessionString ? "✓" : "✗"}`);
      imported++;
    } else {
      console.log(`  ↺ محدّث: ${phone} (${label ?? "—"})`);
      updated++;
    }
  } catch (e) {
    console.error(`  ✗ خطأ في ${phone}: ${(e as Error).message}`);
    errors++;
  }
}

await mongo.close();
await pgClient.end();

console.log(`\n══════════════════════════════`);
console.log(`المصدر: Joining_links.tg_sessions`);
console.log(`جديد:   ${imported}`);
console.log(`محدّث:  ${updated}`);
console.log(`أخطاء:  ${errors}`);
console.log(`الإجمالي: ${docs.length}`);
