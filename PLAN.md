# خطة مشروع بوت تيليجرام متعدد الحسابات — Atomic Plan

> **ملاحظة:** هذا الملف هو المرجع الرئيسي للمشروع. كل نقطة مُصنَّفة بحالتها الراهنة.
> الموقع: `/home/runner/workspace/PLAN.md`

---

## المرحلة الأولى: البنية الأساسية [مكتملة ✅]

### [P1-1] ✅ بوت متعدد الحسابات
- نظام يدعع أكثر من حساب تيليجرام يعمل في وقت واحد
- كل حساب ينضم ثم ينتقل للتالي (التناوب المتسلسل Sequential Rotation)

### [P1-2] ✅ التوقيت الذكي حسب عدد الحسابات
- إذا قلّت الحسابات → فترة انتظار أطول بين كل انضمام
- إذا زادت الحسابات → الفترة تقل تدريجياً لأن التناوب يوفر الوقت الكافي
- الهدف: 80–90 انضمام/حساب/18 ساعة عمل
- المعادلة: `safeInterval = (18h × 3600 / 85) × 1.35 ≈ 1029 ثانية (~17.2 دقيقة)` لكل حساب
- `actionInterval = safeInterval / عدد الحسابات` (لا يقل عن 180 ثانية)
- جيتر عشوائي `±25%` لكسر النمط الروبوتي
- **الملفات:** `artifacts/api-server/src/lib/timing.ts`

### [P1-3] ✅ معالجة الأخطاء الشاملة
| الخطأ | الحل المُطبَّق |
|-------|--------------|
| `FLOOD_WAIT_X` | تعليق الحساب مع انتظار X ثانية + 20% إضافية |
| `CHANNELS_TOO_MUCH` | تغيير حالة الحساب إلى `channels_limit` |
| `INVITE_HASH_EXPIRED` | تعيين الرابط كـ `failed` |
| `INVITE_HASH_INVALID` | تعيين الرابط كـ `failed` |
| `USERS_TOO_MUCH` | تعيين الرابط كـ `failed` |
| `USER_BANNED_IN_CHANNEL` | تعيين الرابط كـ `failed` |
| `PEER_ID_INVALID` | تعيين الرابط كـ `failed` |
| `CHAT_WRITE_FORBIDDEN` | تسجيل + الانضمام ناجح |
| `USER_PRIVACY_RESTRICTED` | تعيين الرابط كـ `failed` |
| `AUTH_KEY_UNREGISTERED` / `SESSION_REVOKED` | وضع الحساب على `needs_auth` + تنبيه فوري |
| `USER_DEACTIVATED_BAN` | وضع الحساب على `banned` + تنبيه فوري |
| `PEER_FLOOD` | تعليق الحساب 24 ساعة + تنبيه فوري |
- **الملفات:** `artifacts/api-server/src/lib/telegramErrors.ts`, `telegramEngine.ts`

### [P1-4] ✅ منع تكرار الانضمام لنفس الرابط
- قيد `UNIQUE` على عمود `url` في جدول `group_links`
- قبل كل انضمام يتم التحقق من حالة الرابط

### [P1-5] ✅ فترة الراحة (ساعات النوم الثابتة — أصبحت قابلة للتخصيص)
- الحظر التلقائي من 2:00 صباحاً حتى 8:00 صباحاً (افتراضي)
- **الملف:** `artifacts/api-server/src/lib/timing.ts` → `isBlackoutHour()`

### [P1-6] ✅ فلترة المجموعات (طبية/بحثية/تعليمية فقط)
- قائمة كلمات مفتاحية بالعربية والإنجليزية
- المجموعات غير المتعلقة لا يُنضم إليها
- لا تُضاف القنوات (channels) أبداً
- **الملف:** `artifacts/api-server/src/lib/groupFilter.ts`

### [P1-7] ✅ نظام السجلات (Logging System)
- كل عملية تُسجَّل في جدول `activity_log`
- تشمل: نوع العملية، الحساب، الرابط، كود الخطأ، وقت الانتظار
- **الصفحة:** Join History في لوحة التحكم

### [P1-8] ✅ حفظ الجلسات في قاعدة البيانات
- كل جلسة تيليجرام تُحفظ كـ `session_string` في جدول `accounts` (PostgreSQL)
- نسخة احتياطية في ملف SQLite محلي لكل حساب
- **الملف:** `artifacts/api-server/src/lib/clientPool.ts`

### [P1-9] ✅ استئناف تلقائي بعد إعادة التشغيل
- عند إعادة تشغيل الخادم، يتحقق المحرك من `bot_state.running`
- إذا كان يعمل قبل الإيقاف يستأنف تلقائياً

### [P1-10] ✅ مصادر MongoDB
- ربط مجموعات MongoDB خارجية كمصادر روابط تلقائية
- مزامنة يدوية + مزامنة تلقائية دورية
- **الملف:** `artifacts/api-server/src/lib/mongoSync.ts`

### [P1-11] ✅ واجهة إدارة بيانات اعتماد Telegram API
- صفحة إعدادات في لوحة التحكم لإدخال API_ID و API_HASH
- تُخزَّن في قاعدة البيانات ولا تحتاج لمتغيرات بيئة
- **الصفحة:** `/settings` في لوحة التحكم

---

## المرحلة الثانية: تحسينات السلامة والخصوصية [مكتملة ✅]

### [P2-1] ✅ تنويع بيانات الجهاز لكل حساب
- `device_model` و `system_version` و `app_version` مختلفة لكل حساب
- مخزَّنة في جدول `accounts` وتُستخدم عند إنشاء العميل
- **الملفات:**
  - `artifacts/api-server/src/lib/deviceProfiles.ts` — قاعدة 20 جهاز حقيقي (Samsung, Xiaomi, Huawei, Oppo, iPhone...)
  - `lib/db/src/schema/accounts.ts` — عمود `device_model`, `system_version`, `app_version`, `system_lang_code`
  - `artifacts/api-server/src/lib/clientPool.ts` — تمرير بيانات الجهاز عند إنشاء `TelegramClient`
  - `artifacts/api-server/src/routes/accounts.ts` — توليد بصمة جهاز مختلفة عند كل حساب جديد

### [P2-2] ✅ مشاهدة المحتوى بعد الانضمام (تأخير بشري)
- بعد الانضمام: انتظار 3–10 ثواني عشوائية (محاكاة قراءة الرسائل)
- قراءة آخر 8 رسائل من المجموعة (للمجموعات العامة)
- الرسائل تُستخدم كمدخلات لفلتر الذكاء الاصطناعي
- **الملف:** `artifacts/api-server/src/lib/groupFilter.ts` → `observeGroupAfterJoin()`

### [P2-3] ✅ ساعات النشاط المُخصَّصة (Sleep Schedule)
- المستخدم يحدد **ساعة بدء النشاط اليومي** من لوحة التحكم (0–23)
- النظام يحسب تلقائياً وقت الانتهاء (بداية + 18 ساعة)
- تباين يومي عشوائي `±1 ساعة` لكسر النمط
- **الملفات:**
  - `artifacts/api-server/src/lib/timing.ts` → `isBlackoutHourConfigurable()`, `msUntilActiveStartConfigurable()`
  - `artifacts/dashboard/src/pages/Settings.tsx` → بطاقة "جدول النشاط اليومي"

### [P2-4] ✅ إعلام المستخدم عند انتهاء صلاحية الجلسة
- عند `AUTH_KEY_UNREGISTERED` / `SESSION_REVOKED`: وضع الحساب على `needs_auth`
- إرسال تنبيه فوري (SSE) في لوحة التحكم
- المستخدم يُكمل إعادة تسجيل الدخول من صفحة Accounts
- **الملف:** `artifacts/api-server/src/lib/telegramEngine.ts` → `handleJoinError()` → emit `account_needs_auth`

### [P2-5] ✅ نظام التنبيهات الفورية (Real-time Notifications)
- تنبيهات في الوقت الفعلي لـ: حساب محظور، FLOOD_WAIT طويل، وصل لحد القنوات، روابط نفدت
- **الملفات:**
  - `artifacts/api-server/src/lib/eventBus.ts` — EventEmitter مشترك
  - `artifacts/api-server/src/routes/events.ts` — SSE endpoint: `GET /api/events`
  - `artifacts/dashboard/src/components/NotificationBell.tsx` — جرس التنبيهات في Sidebar
  - `artifacts/dashboard/src/components/Layout.tsx` — دمج الجرس في الشريط الجانبي

---

## المرحلة الثالثة: الذكاء والتحليل [مكتملة جزئياً 🔄]

### [P3-1] ✅ فلتر ذكاء اصطناعي لمحتوى المجموعات
- استخدام **Google Gemini** (GEMINI_API_KEY) لتصنيف المجموعات
- يتجاوز الفلتر بالكلمات المفتاحية ويفهم السياق
- يستخدم عينة الرسائل المجمَّعة بعد الانضمام (P2-2)
- تُفعَّل/تُعطَّل من صفحة الإعدادات
- **الملفات:**
  - `artifacts/api-server/src/lib/aiFilter.ts` — دالة `aiClassifyGroup()` بـ Gemini
  - `artifacts/api-server/src/lib/groupFilter.ts` → `isRelevantGroupAsync()`
  - `artifacts/dashboard/src/pages/Settings.tsx` → بطاقة "فلتر الذكاء الاصطناعي"

### [P3-2] ❌ إحصاءات متقدمة ورسوم بيانية
- رسم بياني لمعدل الانضمام اليومي/الأسبوعي
- توزيع الأخطاء حسب نوعها
- تحليل أداء كل حساب

### [P3-3] ❌ MongoDB كتخزين رئيسي للجلسات (اختياري)
- حفظ الجلسات والمعلومات المهمة في MongoDB
- حالياً: PostgreSQL + SQLite (يعمل جيداً)
- **ملاحظة:** التبديل الكامل لـ MongoDB غير ضروري ما دام النظام يعمل بكفاءة

---

## ملخص الحالة

| المرحلة | المُنجَز | المتبقي |
|---------|---------|---------|
| P1: الأساسيات | 11/11 ✅ | 0 |
| P2: السلامة | 5/5 ✅ | 0 |
| P3: الذكاء | 1/3 🔄 | 2 |

---

## متغيرات البيئة

| المتغير | الوضع | الملاحظة |
|--------|-------|---------|
| `DATABASE_URL` | ✅ مطلوب | PostgreSQL connection string |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | ✅ مطلوب | PostgreSQL credentials |
| `GEMINI_API_KEY` | ✅ مُستخدَم | فلتر الذكاء الاصطناعي (P3-1) — يُفعَّل تلقائياً إن وُجد |
| `TELEGRAM_API_ID` | ⚠️ اختياري | يمكن إدخاله من صفحة الإعدادات |
| `TELEGRAM_API_HASH` | ⚠️ اختياري | يمكن إدخاله من صفحة الإعدادات |

**تمت إزالة:** `SESSION_SECRET` — لم يكن مطلوباً لهذا المشروع.
