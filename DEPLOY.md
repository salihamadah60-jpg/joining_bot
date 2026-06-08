# نشر المشروع على Railway

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new/template)

## ما هو DATABASE_URL؟

`DATABASE_URL` هو رابط الاتصال بقاعدة بيانات PostgreSQL — يحتوي على عنوان السيرفر + اسم المستخدم + كلمة المرور + اسم قاعدة البيانات في رابط واحد.

**مثال:**
```
postgresql://user:password@host:5432/dbname
```

- في **Replit**: يُضبط تلقائياً عند إنشاء قاعدة البيانات
- في **Railway**: يُضبط تلقائياً عند إضافة PostgreSQL Plugin

---

## خطوات النشر على Railway

### 1. ارفع الكود على GitHub

```bash
pnpm --filter @workspace/scripts run push-github
```

> متطلبات:
> - أضف `GITHUB_TOKEN` في Replit Secrets
> - احصل عليه من: https://github.com/settings/tokens/new (فعّل صلاحية `repo`)

### 2. أنشئ مشروعاً على Railway

1. اذهب إلى https://railway.app
2. **New Project** → **Deploy from GitHub repo**
3. اختر الـ repo الذي رُفع في الخطوة السابقة

### 3. أضف قاعدة بيانات PostgreSQL

في لوحة Railway:
1. **New** → **Database** → **Add PostgreSQL**
2. سيُضبط `DATABASE_URL` تلقائياً

### 4. أضف متغيرات البيئة

في **Variables** tab أضف:

| المتغير | القيمة |
|---|---|
| `TELEGRAM_API_ID` | من https://my.telegram.org/apps |
| `TELEGRAM_API_HASH` | من https://my.telegram.org/apps |
| `GEMINI_API_KEY` | من https://aistudio.google.com/apikey |
| `MONGODB_URL` | رابط MongoDB الخاص بك (اختياري) |

### 5. شغّل Migration قاعدة البيانات

بعد اكتمال أول deploy، افتح **Railway Shell** وشغّل:

```bash
psql $DATABASE_URL < schema.sql
```

### 6. اكتمل النشر 🎉

Railway سيبني المشروع تلقائياً عند كل push جديد على GitHub.

---

## تحديث المشروع بعد التطوير

```bash
# 1. صدّر قاعدة البيانات (اختياري)
pnpm --filter @workspace/scripts run export-db

# 2. ارفع التحديثات على GitHub
pnpm --filter @workspace/scripts run push-github
```

Railway سيكتشف التغييرات تلقائياً ويعيد البناء.

---

## متطلبات النشر

| المتطلب | الحالة |
|---|---|
| `railway.toml` | ✅ موجود |
| `nixpacks.toml` | ✅ موجود (Python3 + gcc لبناء better-sqlite3) |
| `schema.sql` | ✅ موجود — شغّله على قاعدة البيانات الجديدة |
| `data.sql` | ✅ موجود — لاستعادة البيانات (اختياري) |
