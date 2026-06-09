import { useState, useEffect } from "react";
import { useGetSettings, useGetTelegramStatus, useUpdateSettings } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Settings2, Key, ShieldCheck, ShieldX, Save,
  Eye, EyeOff, Moon, Bot, DatabaseBackup,
  RefreshCw, Download, Clock
} from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, refetch: refetchSettings } = useGetSettings();
  const { data: telegramStatus, refetch: refetchStatus } = useGetTelegramStatus();
  const updateSettings = useUpdateSettings();

  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showHash, setShowHash] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState("30");
  const [activeStartHour, setActiveStartHour] = useState("8");
  const [aiFilterEnabled, setAiFilterEnabled] = useState(false);
  const [mongoBackupUrl, setMongoBackupUrl] = useState("");
  const [mongoBackupDb, setMongoBackupDb] = useState("tg_backup");
  const [saving, setSaving] = useState(false);
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  useEffect(() => {
    if (settings) {
      const s = settings as Record<string, string>;
      setApiId(s["telegram_api_id"] ?? "");
      setAutoSyncInterval(s["auto_sync_interval_minutes"] ?? "30");
      setActiveStartHour(s["active_start_hour"] ?? "8");
      setAiFilterEnabled(s["ai_filter_enabled"] === "true");
      setMongoBackupUrl(s["mongo_backup_url"] ?? "");
      setMongoBackupDb(s["mongo_backup_db"] ?? "tg_backup");
    }
  }, [settings]);

  const credentialSource = (telegramStatus as any)?.source ?? "none";
  const credentialConfigured = (telegramStatus as any)?.configured ?? false;

  const handleSaveTelegram = async () => {
    if (!apiId.trim()) { toast({ title: "خطأ", description: "API ID مطلوب", variant: "destructive" }); return; }
    if (!apiHash.trim()) { toast({ title: "خطأ", description: "API Hash مطلوب", variant: "destructive" }); return; }
    setSaving(true);
    updateSettings.mutate(
      { data: { telegram_api_id: apiId.trim(), telegram_api_hash: apiHash.trim() } },
      {
        onSuccess: () => {
          toast({ title: "✅ تم الحفظ", description: "تم حفظ بيانات Telegram API" });
          setApiHash(""); refetchSettings(); refetchStatus(); setSaving(false);
        },
        onError: () => { toast({ title: "خطأ", description: "فشل الحفظ", variant: "destructive" }); setSaving(false); },
      }
    );
  };

  const handleSaveSchedule = () => {
    const hour = parseInt(activeStartHour, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      toast({ title: "خطأ", description: "ساعة البداية 0–23", variant: "destructive" }); return;
    }
    updateSettings.mutate(
      { data: { active_start_hour: String(hour), auto_sync_interval_minutes: autoSyncInterval } },
      {
        onSuccess: () => {
          toast({ title: "✅ تم الحفظ", description: `النشاط: ${String(hour).padStart(2,"0")}:00 → ${String((hour+18)%24).padStart(2,"0")}:00` });
          refetchSettings();
        },
        onError: () => toast({ title: "خطأ", description: "فشل الحفظ", variant: "destructive" }),
      }
    );
  };

  const handleToggleAiFilter = (enabled: boolean) => {
    setAiFilterEnabled(enabled);
    updateSettings.mutate(
      { data: { ai_filter_enabled: String(enabled) } },
      {
        onSuccess: () => {
          toast({ title: enabled ? "✅ فلتر AI مُفعَّل" : "🔕 فلتر AI معطَّل" });
          refetchSettings();
        },
        onError: () => { setAiFilterEnabled(!enabled); toast({ title: "خطأ", variant: "destructive" }); },
      }
    );
  };

  const handleSaveBackupConfig = () => {
    if (!mongoBackupUrl.trim()) { toast({ title: "خطأ", description: "أدخل رابط MongoDB أولاً", variant: "destructive" }); return; }
    updateSettings.mutate(
      { data: { mongo_backup_url: mongoBackupUrl.trim(), mongo_backup_db: mongoBackupDb.trim() || "tg_backup" } },
      {
        onSuccess: () => { toast({ title: "✅ تم الحفظ" }); refetchSettings(); },
        onError: () => toast({ title: "خطأ", variant: "destructive" }),
      }
    );
  };

  const apiCall = async (path: string, method = "POST") => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const r = await fetch(`${base}${path}`, { method });
    return r.json();
  };

  const handleBackupNow = async () => {
    setBackupLoading(true);
    try {
      const data = await apiCall("/api/sessions/backup");
      if (data.ok) toast({ title: "✅ نسخ احتياطي مكتمل", description: `${data.backedUp} جلسة` });
      else toast({ title: "خطأ", description: data.error, variant: "destructive" });
    } catch { toast({ title: "خطأ في الاتصال", variant: "destructive" }); }
    finally { setBackupLoading(false); }
  };

  const handleRestoreNow = async () => {
    setRestoreLoading(true);
    try {
      const data = await apiCall("/api/sessions/restore");
      if (data.ok) toast({ title: "✅ استعادة مكتملة", description: `${data.restored} جلسة` });
      else toast({ title: "خطأ", description: data.error, variant: "destructive" });
    } catch { toast({ title: "خطأ في الاتصال", variant: "destructive" }); }
    finally { setRestoreLoading(false); }
  };

  const handleImportNow = async () => {
    setImportLoading(true);
    try {
      const data = await apiCall("/api/sessions/import");
      if (data.ok) toast({ title: "✅ استيراد مكتمل", description: `جديد: ${data.imported} | محدّث: ${data.updated}` });
      else toast({ title: "خطأ", description: data.error, variant: "destructive" });
    } catch { toast({ title: "خطأ في الاتصال", variant: "destructive" }); }
    finally { setImportLoading(false); }
  };

  const startH = parseInt(activeStartHour) || 8;
  const endH = (startH + 18) % 24;

  return (
    <div className="font-mono max-w-3xl" dir="rtl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2 rounded-lg bg-primary/10 border border-primary/20">
          <Settings2 className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-foreground">الإعدادات</h1>
          <p className="text-xs text-muted-foreground">إدارة بيانات الاعتماد وإعدادات النظام</p>
        </div>
      </div>

      <Tabs defaultValue="telegram" className="w-full">
        <TabsList className="w-full mb-5 grid grid-cols-3 bg-muted/50 border border-border rounded-lg p-1 h-auto gap-1">
          <TabsTrigger value="telegram" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <Key className="w-3.5 h-3.5" />
            Telegram API
          </TabsTrigger>
          <TabsTrigger value="schedule" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <Clock className="w-3.5 h-3.5" />
            الجدول
          </TabsTrigger>
          <TabsTrigger value="backup" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <DatabaseBackup className="w-3.5 h-3.5" />
            النسخ الاحتياطي
          </TabsTrigger>
        </TabsList>

        {/* ── TAB 1: Telegram API + AI Filter ── */}
        <TabsContent value="telegram" className="space-y-4 mt-0">
          {/* Status bar */}
          <div className="flex items-center justify-between px-4 py-2.5 rounded-lg border bg-card">
            <span className="text-xs text-muted-foreground">حالة الاعتماد</span>
            {credentialConfigured ? (
              <Badge className="bg-primary/10 text-primary border border-primary/20 flex items-center gap-1 text-xs">
                <ShieldCheck className="w-3 h-3" />
                مُفعَّل — {credentialSource === "env" ? "متغيرات البيئة" : "قاعدة البيانات"}
              </Badge>
            ) : (
              <Badge variant="destructive" className="flex items-center gap-1 text-xs">
                <ShieldX className="w-3 h-3" />
                غير مُفعَّل
              </Badge>
            )}
          </div>

          {credentialSource === "env" && (
            <div className="flex items-start gap-2 bg-primary/5 border border-primary/20 rounded-lg p-3 text-xs text-primary">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              البيانات محملة من متغيرات البيئة. يمكنك تجاوزها هنا.
            </div>
          )}

          {/* API credentials — 2-col grid */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2">بيانات my.telegram.org/apps</p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">API ID</Label>
                <Input
                  type="text" placeholder="12345678"
                  value={apiId} onChange={(e) => setApiId(e.target.value)}
                  className="h-8 text-sm font-mono bg-background border-border"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">API Hash</Label>
                <div className="relative">
                  <Input
                    type={showHash ? "text" : "password"}
                    placeholder={credentialConfigured && credentialSource === "database" ? "••••••••••••••••" : "أدخل API Hash"}
                    value={apiHash} onChange={(e) => setApiHash(e.target.value)}
                    className="h-8 text-sm font-mono bg-background border-border pl-8"
                    dir="ltr"
                  />
                  <button
                    type="button" onClick={() => setShowHash(!showHash)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showHash ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
            <Button onClick={handleSaveTelegram} disabled={saving || updateSettings.isPending} size="sm" className="flex items-center gap-2">
              <Save className="w-3.5 h-3.5" />
              {saving ? "جاري الحفظ..." : "حفظ بيانات الاعتماد"}
            </Button>
          </div>

          {/* AI Filter */}
          <div className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-md ${aiFilterEnabled ? "bg-primary/10 border border-primary/20" : "bg-muted border border-border"}`}>
                  <Bot className={`w-4 h-4 ${aiFilterEnabled ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">فلتر Gemini AI</p>
                  <p className="text-xs text-muted-foreground">
                    {aiFilterEnabled ? "يُصنّف المجموعات بالذكاء الاصطناعي" : "يستخدم الكلمات المفتاحية فقط"}
                  </p>
                </div>
              </div>
              <Switch checked={aiFilterEnabled} onCheckedChange={handleToggleAiFilter} disabled={updateSettings.isPending} />
            </div>
            {aiFilterEnabled && (
              <div className="mt-3 text-xs text-primary bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
                ✅ Gemini نشط — كل مجموعة جديدة ستُعرض للتصنيف قبل الانضمام
              </div>
            )}
          </div>
        </TabsContent>

        {/* ── TAB 2: Schedule + Auto-sync ── */}
        <TabsContent value="schedule" className="space-y-4 mt-0">
          <div className="bg-card border border-border rounded-lg p-4 space-y-4">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <Moon className="w-3.5 h-3.5 text-primary" />
              ساعات النشاط اليومي
            </p>

            {/* Visual schedule indicator */}
            <div className="flex items-center gap-3 p-3 bg-background border border-border rounded-lg">
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-0.5">البداية</p>
                <p className="text-lg font-bold text-primary font-mono">{String(startH).padStart(2,"0")}:00</p>
              </div>
              <div className="flex-1 flex items-center gap-1">
                <div className="h-1.5 flex-1 bg-primary/30 rounded-full">
                  <div className="h-full bg-primary rounded-full" style={{width: "100%"}} />
                </div>
                <span className="text-xs text-muted-foreground flex-shrink-0">18 ساعة</span>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground mb-0.5">النهاية</p>
                <p className="text-lg font-bold text-primary font-mono">{String(endH).padStart(2,"0")}:00</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">ساعة البداية (0–23)</Label>
                <Input
                  type="number" min="0" max="23"
                  value={activeStartHour} onChange={(e) => setActiveStartHour(e.target.value)}
                  className="h-8 w-24 text-sm font-mono text-center bg-background border-border"
                  dir="ltr"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">فترة التزامن (دقيقة)</Label>
                <Input
                  type="number" min="5" max="1440"
                  value={autoSyncInterval} onChange={(e) => setAutoSyncInterval(e.target.value)}
                  className="h-8 w-24 text-sm font-mono text-center bg-background border-border"
                  dir="ltr"
                />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              مثال: بداية 8 → نشاط من <span className="text-primary font-mono">08:00</span> حتى <span className="text-primary font-mono">02:00</span>. تباين ±1 ساعة تلقائياً.
            </p>

            <Button onClick={handleSaveSchedule} disabled={updateSettings.isPending} size="sm" className="flex items-center gap-2">
              <Save className="w-3.5 h-3.5" />
              حفظ الجدول
            </Button>
          </div>
        </TabsContent>

        {/* ── TAB 3: MongoDB Backup ── */}
        <TabsContent value="backup" className="space-y-4 mt-0">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
            <span className="flex-shrink-0">⚠️</span>
            الجلسات بيانات حساسة — تأكد أن قاعدة MongoDB محمية بكلمة مرور.
          </div>

          {/* Config */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2">إعدادات قاعدة النسخ الاحتياطي</p>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-muted-foreground">Connection String</Label>
              <Input
                type="password" placeholder="mongodb+srv://user:password@cluster.mongodb.net"
                value={mongoBackupUrl} onChange={(e) => setMongoBackupUrl(e.target.value)}
                className="h-8 text-xs font-mono bg-background border-border"
                dir="ltr"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">اسم قاعدة البيانات</Label>
                <Input
                  placeholder="tg_backup"
                  value={mongoBackupDb} onChange={(e) => setMongoBackupDb(e.target.value)}
                  className="h-8 text-sm font-mono bg-background border-border"
                  dir="ltr"
                />
              </div>
            </div>
            <Button onClick={handleSaveBackupConfig} disabled={updateSettings.isPending} size="sm" variant="outline" className="flex items-center gap-2">
              <Save className="w-3.5 h-3.5" />
              حفظ الإعداد
            </Button>
          </div>

          {/* Actions */}
          <div className="bg-card border border-border rounded-lg p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2">العمليات</p>
            <div className="grid grid-cols-1 gap-2">
              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
                <div>
                  <p className="text-xs font-medium text-foreground">استيراد الحسابات من MongoDB</p>
                  <p className="text-xs text-muted-foreground mt-0.5">يجلب الحسابات والجلسات المحفوظة</p>
                </div>
                <Button onClick={handleImportNow} disabled={importLoading} size="sm" className="flex items-center gap-1.5 flex-shrink-0">
                  {importLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  استيراد
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
                <div>
                  <p className="text-xs font-medium text-foreground">نسخ احتياطي الآن</p>
                  <p className="text-xs text-muted-foreground mt-0.5">حفظ جميع الجلسات في MongoDB</p>
                </div>
                <Button onClick={handleBackupNow} disabled={backupLoading} size="sm" variant="outline" className="flex items-center gap-1.5 flex-shrink-0">
                  {backupLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <DatabaseBackup className="w-3.5 h-3.5" />}
                  نسخ
                </Button>
              </div>

              <div className="flex items-center justify-between p-3 bg-background border border-border rounded-lg">
                <div>
                  <p className="text-xs font-medium text-foreground">استعادة الجلسات</p>
                  <p className="text-xs text-muted-foreground mt-0.5">استعادة الجلسات للحسابات الموجودة فقط</p>
                </div>
                <Button onClick={handleRestoreNow} disabled={restoreLoading} size="sm" variant="outline" className="flex items-center gap-1.5 flex-shrink-0">
                  {restoreLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  استعادة
                </Button>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
