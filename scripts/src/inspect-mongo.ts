import { MongoClient } from "mongodb";

const MONGODB_URL = process.env["MONGODB_URL"];
if (!MONGODB_URL) throw new Error("MONGODB_URL غير موجود");

const mongo = new MongoClient(MONGODB_URL, { serverSelectionTimeoutMS: 15000 });
await mongo.connect();
console.log("✓ متصل");

const db = mongo.db();
const collections = await db.listCollections().toArray();

for (const col of collections) {
  const count = await db.collection(col.name).countDocuments();
  console.log(`\n=== ${col.name} (${count} سجل) ===`);
  if (count > 0) {
    const sample = await db.collection(col.name).find({}).limit(2).toArray();
    for (const doc of sample) {
      const keys = Object.keys(doc);
      console.log("  Keys:", keys.join(", "));
      // Print non-sensitive fields
      for (const k of keys) {
        if (k === "sessionString" || k === "session_string" || k === "password") {
          console.log(`  ${k}: [مخفي]`);
        } else {
          console.log(`  ${k}:`, JSON.stringify(doc[k])?.substring(0, 80));
        }
      }
      console.log("  ---");
    }
  }
}

await mongo.close();
