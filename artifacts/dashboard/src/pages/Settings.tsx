import { useState, useEffect } from "react";
import { useGetSettings, useGetTelegramStatus, useUpdateSettings } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Settings2, Key, ShieldCheck, ShieldX, Save, Eye, EyeOff, Moon, Bot } from "lucide-react";

export default function Settings() {
  const { toast } = useToast();
  const { data: settings, refetch: refetchSettings } = useGetSettings();
  const { data: telegramStatus, refetch: refetchStatus } = useGetTelegramStatus();
  const updateSettings = useUpdateSettings();

  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showHash, setShowHash] = useState(false);
  const [autoSyncInterval, setAutoSyncInterval] = useState("30");
  // P2-3: Sleep schedule
  const [activeStartHour, setActiveStartHour] = useState("8");
  // P3-1: AI filter
  const [aiFilterEnabled, setAiFilterEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (settings) {
      const s = settings as Record<string, string>;
      setApiId(s["telegram_api_id"] ?? "");
      setAutoSyncInterval(s["auto_sync_interval_minutes"] ?? "30");
      setActiveStartHour(s["active_start_hour"] ?? "8");
      setAiFilterEnabled(s["ai_filter_enabled"] === "true");
    }
  }, [settings]);

  const handleSaveTelegram = async () => {
    if (!apiId.trim()) {
      toast({ title: "خطأ", description: "API ID مطلوب", variant: "destructive" });
      return;
    }
    if (!apiHash.trim()) {
      toast({ title: "خطأ", description: "API Hash مطلوب", variant: "destructive" });
      return;
    }
    setSaving(true);
    updateSettings.mutate(
      { data: { telegram_api_id: apiId.trim(), telegram_api_hash: apiHash.trim() } },
      {
        onSuccess: () => {
          toast({ title: "✅ تم الحفظ", description: "تم حفظ بيانات اعتماد Telegram API بنجاح" });
          setApiHash("");
          refetchSettings();
          refetchStatus();
          setSaving(false);
        },
        onError: () => {
          toast({ title: "خطأ", description: "فشل حفظ الإعدادات", variant: "destructive" });
          setSaving(false);
        },
      }
    );
  };

  const handleSaveSync = async () => {
    updateSettings.mutate(
      { data: { auto_sync_interval_minutes: autoSyncInterval } },
      {
        onSuccess: () => {
          toast({ title: "✅ تم الحفظ", description: "تم حفظ إعدادات التزامن" });
          refetchSettings();
        },
        onError: () => {
          toast({ title: "خطأ", description: "فشل حفظ الإعدادات", variant: "destructive" });
        },
      }
    );
  };

  // P2-3: Save sleep schedule setting
  const handleSaveSleep = () => {
    const hour = parseInt(activeStartHour, 10);
    if (isNaN(hour) || hour < 0 || hour > 23) {
      toast({ title: "خطأ", description: "ساعة البداية يجب أن تكون بين 0 و 23", variant: "destructive" });
      return;
    }
    updateSettings.mutate(
      { data: { active_start_hour: String(hour) } },
      {
        onSuccess: () => {
          toast({ title: "✅ تم الحفظ", description: `ساعة البداية: ${hour}:00 — ينتهي النشاط الساعة ${(hour + 18) % 24}:00` });
          refetchSettings();
        },
        onError: () => toast({ title: "خطأ", description: "فشل حفظ الإعدادات", variant: "destructive" }),
      }
    );
  };

  // P3-1: Save AI filter setting
  const handleToggleAiFilter = (enabled: boolean) => {
    setAiFilterEnabled(enabled);
    updateSettings.mutate(
      { data: { ai_filter_enabled: String(enabled) } },
      {
        onSuccess: () => {
          toast({ title: enabled ? "✅ تم تفعيل فلتر AI" : "🔕 تم تعطيل فلتر AI", description: enabled ? "سيتم استخدام Gemini لتصنيف المجموعات" : "سيُستخدم فقط الفلتر بالكلمات المفتاحية" });
          refetchSettings();
        },
        onError: () => { setAiFilterEnabled(!enabled); toast({ title: "خطأ", description: "فشل حفظ الإعداد", variant: "destructive" }); },
      }
    );
  };

  const credentialSource = (telegramStatus as any)?.source ?? "none";
  const credentialConfigured = (telegramStatus as any)?.configured ?? false;

  return (
    <div className="space-y-8 font-mono" dir="rtl">
      <div className="flex items-center gap-3">
        <Settings2 className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
          <p className="text-sm text-muted-foreground">إدارة بيانات الاعتماد وإعدادات النظام</p>
        </div>
      </div>

      {/* Telegram API Credentials */}
      <Card className="border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Key className="w-4 h-4 text-primary" />
              بيانات اعتماد Telegram API
            </CardTitle>
            <div className="flex items-center gap-2">
              {credentialConfigured ? (
                <Badge className="bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  مُفعَّل ({credentialSource === "env" ? "متغيرات البيئة" : "قاعدة البيانات"})
                </Badge>
              ) : (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <ShieldX className="w-3 h-3" />
                  غير مُفعَّل
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {credentialSource === "env" && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 text-sm text-primary">
              ✅ البيانات محملة من متغيرات البيئة (TELEGRAM_API_ID / TELEGRAM_API_HASH). يمكنك تجاوزها هنا.
            </div>
          )}

          <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 border border-border">
            <p className="font-semibold mb-1 text-foreground">كيفية الحصول على بيانات الاعتماد:</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>افتح <span className="text-primary">my.telegram.org/apps</span></li>
              <li>سجل الدخول برقم هاتفك</li>
              <li>أنشئ تطبيقاً جديداً للحصول على <code className="bg-muted px-1 rounded">API ID</code> و <code className="bg-muted px-1 rounded">API Hash</code></li>
            </ol>
          </div>

          <div className="grid gap-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">API ID</Label>
              <Input
                type="text"
                placeholder="مثال: 12345678"
                value={apiId}
                onChange={(e) => setApiId(e.target.value)}
                className="font-mono bg-background border-border text-foreground"
                dir="ltr"
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium text-foreground">API Hash</Label>
              <div className="relative">
                <Input
                  type={showHash ? "text" : "password"}
                  placeholder={credentialConfigured && credentialSource === "database" ? "••••••••••••••••" : "أدخل API Hash"}
                  value={apiHash}
                  onChange={(e) => setApiHash(e.target.value)}
                  className="font-mono bg-background border-border text-foreground pr-10"
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowHash(!showHash)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showHash ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {credentialConfigured && credentialSource === "database" && (
                <p className="text-xs text-muted-foreground">اتركه فارغاً للاحتفاظ بالقيمة الحالية</p>
              )}
            </div>
          </div>

          <Button
            onClick={handleSaveTelegram}
            disabled={saving || updateSettings.isPending}
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "جاري الحفظ..." : "حفظ بيانات الاعتماد"}
          </Button>
        </CardContent>
      </Card>

      {/* Auto-Sync Settings */}
      <Card className="border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Settings2 className="w-4 h-4 text-primary" />
            إعدادات التزامن التلقائي (MongoDB)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">فترة التزامن التلقائي (بالدقائق)</Label>
            <Input
              type="number"
              min="5"
              max="1440"
              value={autoSyncInterval}
              onChange={(e) => setAutoSyncInterval(e.target.value)}
              className="w-40 font-mono bg-background border-border text-foreground"
              dir="ltr"
            />
            <p className="text-xs text-muted-foreground">
              القيمة الافتراضية: 30 دقيقة. تغيير هذه القيمة يسري عند إعادة تشغيل الخادم.
            </p>
          </div>
          <Button
            onClick={handleSaveSync}
            disabled={updateSettings.isPending}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            حفظ إعدادات التزامن
          </Button>
        </CardContent>
      </Card>

      {/* P2-3: Sleep Schedule */}
      <Card className="border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Moon className="w-4 h-4 text-primary" />
            جدول النشاط اليومي (ساعات العمل)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <p>البوت يعمل <span className="text-foreground font-semibold">18 ساعة</span> يومياً ثم يدخل في وضع الراحة.</p>
            <p>يمكنك تحديد ساعة بداية النشاط — النظام يحسب نهاية النشاط تلقائياً (بداية + 18 ساعة).</p>
            <p className="text-yellow-400">التغيير يسري فوراً على دورة العمل القادمة.</p>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium text-foreground">
              ساعة بداية النشاط (0–23)
            </Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min="0"
                max="23"
                value={activeStartHour}
                onChange={(e) => setActiveStartHour(e.target.value)}
                className="w-24 font-mono bg-background border-border text-foreground text-center"
                dir="ltr"
              />
              <div className="text-sm text-muted-foreground">
                النشاط:{" "}
                <span className="text-primary font-mono">
                  {String(parseInt(activeStartHour) || 8).padStart(2, "0")}:00
                </span>
                {" → "}
                <span className="text-primary font-mono">
                  {String(((parseInt(activeStartHour) || 8) + 18) % 24).padStart(2, "0")}:00
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              مثال: 8 = ينشط من 8:00 صباحاً حتى 2:00 صباحاً (18 ساعة). التباين اليومي ±1 ساعة تلقائياً.
            </p>
          </div>

          <Button
            onClick={handleSaveSleep}
            disabled={updateSettings.isPending}
            variant="outline"
            className="flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            حفظ جدول النشاط
          </Button>
        </CardContent>
      </Card>

      {/* P3-1: AI Filter */}
      <Card className="border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Bot className="w-4 h-4 text-primary" />
            فلتر الذكاء الاصطناعي (Gemini)
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="bg-muted/30 border border-border rounded-md p-3 text-xs text-muted-foreground space-y-1">
            <p>عند التفعيل، يستخدم البوت <span className="text-primary font-semibold">Google Gemini</span> لتصنيف المجموعات كمجموعة طبية/بحثية/تعليمية.</p>
            <p>يتجاوز حدود الفلتر بالكلمات المفتاحية ويفهم السياق بدقة أعلى.</p>
            <p>يتطلب وجود <code className="bg-muted px-1 rounded font-mono">GEMINI_API_KEY</code> في متغيرات البيئة.</p>
          </div>

          <div className="flex items-center justify-between p-4 bg-background border border-border rounded-lg">
            <div className="space-y-1">
              <Label className="text-sm font-medium text-foreground cursor-pointer">
                {aiFilterEnabled ? "🤖 فلتر AI مُفعَّل" : "💤 فلتر AI معطَّل"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {aiFilterEnabled
                  ? "يُستخدم Gemini لكل مجموعة جديدة"
                  : "يُستخدم فقط الفلتر بالكلمات المفتاحية"}
              </p>
            </div>
            <Switch
              checked={aiFilterEnabled}
              onCheckedChange={handleToggleAiFilter}
              disabled={updateSettings.isPending}
            />
          </div>

          {aiFilterEnabled && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 text-xs text-primary">
              ✅ الفلتر نشط — كل مجموعة ستُعرض على Gemini قبل تسجيلها كمرتبطة/غير مرتبطة.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
