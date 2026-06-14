import { useState, useEffect, useCallback } from "react";
import { useGetSettings, useGetTelegramStatus, useUpdateSettings, useGetBotStatus } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Settings2, Key, ShieldCheck, ShieldX, Save,
  Eye, EyeOff, Moon, Sun, Bot, DatabaseBackup,
  RefreshCw, Download, Clock, Zap, Play
} from "lucide-react";

// ─── Time helpers ──────────────────────────────────────────────────────────────

function to24(h12: number, ampm: "AM" | "PM"): number {
  if (ampm === "AM") return h12 === 12 ? 0 : h12;
  return h12 === 12 ? 12 : h12 + 12;
}

function to12(h24: number): { hour: number; ampm: "AM" | "PM" } {
  if (h24 === 0) return { hour: 12, ampm: "AM" };
  if (h24 < 12) return { hour: h24, ampm: "AM" };
  if (h24 === 12) return { hour: 12, ampm: "PM" };
  return { hour: h24 - 12, ampm: "PM" };
}

function formatHourAr(h24: number): string {
  const { hour, ampm } = to12(h24);
  return `${hour}:00 ${ampm === "AM" ? "ص" : "م"}`;
}

function formatHourArFull(h24: number): string {
  const { hour, ampm } = to12(h24);
  return `${hour}:00 ${ampm === "AM" ? "صباحاً" : "مساءً"}`;
}

function isInActiveWindow(h: number, startH: number, durationH = 18): boolean {
  const end = (startH + durationH) % 24;
  if (end > startH) return h >= startH && h < end;
  return h >= startH || h < end;
}

// ─── 24-Hour Timeline Component ───────────────────────────────────────────────

function Timeline({
  startHour,
  activeHours = 18,
  currentHour,
}: {
  startHour: number;
  activeHours?: number;
  currentHour: number;
}) {
  const hours = Array.from({ length: 24 }, (_, i) => i);

  return (
    <div className="space-y-2">
      {/* Hour blocks */}
      <div className="flex w-full rounded-lg overflow-hidden border border-border relative">
        {hours.map((h) => {
          const active = isInActiveWindow(h, startHour, activeHours);
          const isCurrent = h === currentHour;
          return (
            <div
              key={h}
              className={`flex-1 h-8 relative flex items-center justify-center transition-colors ${
                isCurrent
                  ? "bg-yellow-400/90 z-10"
                  : active
                  ? "bg-primary/70"
                  : "bg-muted/30"
              }`}
              title={`${formatHourArFull(h)} — ${active ? "نشط" : "نوم"}`}
            >
              {isCurrent && (
                <span className="text-[9px] font-bold text-black">▼</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Hour labels — show every 3 hours */}
      <div className="flex w-full relative">
        {hours.map((h) => (
          <div key={h} className="flex-1 text-center">
            {h % 3 === 0 && (
              <span className="text-[9px] text-muted-foreground font-mono">
                {formatHourAr(h)}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-primary/70" />
          <span>نشط ({activeHours} ساعة)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-muted/30 border border-border" />
          <span>نوم ({24 - activeHours} ساعة)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-yellow-400/90" />
          <span>الآن</span>
        </div>
      </div>
    </div>
  );
}

// ─── Live Clock ───────────────────────────────────────────────────────────────

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const { hour, ampm } = to12(now.getHours());
  const min = String(now.getMinutes()).padStart(2, "0");
  const sec = String(now.getSeconds()).padStart(2, "0");

  return (
    <div className="flex items-baseline gap-1 font-mono" dir="ltr">
      <span className="text-2xl font-bold text-foreground tabular-nums">
        {hour}:{min}:{sec}
      </span>
      <span className={`text-sm font-bold ${ampm === "AM" ? "text-sky-400" : "text-orange-400"}`}>
        {ampm === "AM" ? "صباحاً" : "مساءً"}
      </span>
    </div>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: settings, refetch: refetchSettings } = useGetSettings();
  const { data: telegramStatus, refetch: refetchStatus } = useGetTelegramStatus();
  const { data: botStatus, refetch: refetchBot } = useGetBotStatus();
  const updateSettings = useUpdateSettings();

  // Telegram API
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [showHash, setShowHash] = useState(false);
  const [saving, setSaving] = useState(false);

  // AI filter
  const [aiFilterEnabled, setAiFilterEnabled] = useState(false);

  // Schedule — user picks STOP time (blackout start), start is auto-calculated
  const [stopHour12, setStopHour12] = useState(2);   // 1-12
  const [stopAmPm, setStopAmPm] = useState<"AM" | "PM">("AM");

  // Auto-sync
  const [autoSyncInterval, setAutoSyncInterval] = useState("30");

  // Timing limits
  const [dailyLimit, setDailyLimit] = useState("85");
  const [activeHoursCount, setActiveHoursCount] = useState("18");

  // Backup
  const [mongoBackupUrl, setMongoBackupUrl] = useState("");
  const [mongoBackupDb, setMongoBackupDb] = useState("tg_backup");
  const [backupLoading, setBackupLoading] = useState(false);
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);

  // Force resume
  const forceResume = useMutation({
    mutationFn: async (hours: number) => {
      const r = await fetch("/api/bot/force-resume", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hours }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] });
      refetchBot();
      const until = new Date(data.forceActiveUntil);
      const { hour, ampm } = to12(until.getHours());
      const min = String(until.getMinutes()).padStart(2, "0");
      toast({
        title: "⚡ تشغيل فوري",
        description: `البوت يعمل الآن حتى ${hour}:${min} ${ampm === "AM" ? "صباحاً" : "مساءً"}`,
      });
    },
    onError: (e: any) => toast({ title: "خطأ في التشغيل", description: e?.message, variant: "destructive" }),
  });

  // Load saved settings into state
  useEffect(() => {
    if (settings) {
      const s = settings as Record<string, string>;
      setApiId(s["telegram_api_id"] ?? "");
      setAutoSyncInterval(s["auto_sync_interval_minutes"] ?? "30");
      setAiFilterEnabled(s["ai_filter_enabled"] === "true");
      setMongoBackupUrl(s["mongo_backup_url"] ?? "");
      setMongoBackupDb(s["mongo_backup_db"] ?? "tg_backup");

        // Load stop time (blackout_start_hour). Fallback: derive from active_start_hour.
      const activeHoursNum = Math.max(6, Math.min(23, Number(s["active_hours_count"] ?? 18)));
      let stopH24: number;
      if (s["blackout_start_hour"] !== undefined) {
        stopH24 = Number(s["blackout_start_hour"]);
      } else {
        // Backward compat: derive stop from start + active_hours
        const startH24 = Number(s["active_start_hour"] ?? 8);
        stopH24 = (startH24 + activeHoursNum) % 24;
      }
      const { hour: stopH, ampm: stopA } = to12(stopH24);
      setStopHour12(stopH);
      setStopAmPm(stopA);

      setDailyLimit(s["default_daily_limit"] ?? "85");
      setActiveHoursCount(s["active_hours_count"] ?? "18");
    }
  }, [settings]);

  // Derived values
  // stopH24 = when the bot stops (user sets this)
  const stopH24 = to24(stopHour12, stopAmPm);
  const activeHoursNum = Math.max(6, Math.min(23, Number(activeHoursCount) || 18));
  const sleepHoursNum = 24 - activeHoursNum;
  // startH24 = auto-calculated from stop time + sleep duration
  const startH24 = ((stopH24 + sleepHoursNum) % 24 + 24) % 24;
  const dailyLimitNum = Math.max(10, Math.min(200, Number(dailyLimit) || 85));
  const safeIntervalSecs = Math.ceil((activeHoursNum * 3600 / dailyLimitNum) * 1.35);
  const currentHour = new Date().getHours();
  const botIsRunning = (botStatus as any)?.running ?? false;
  const forceActiveUntil = (botStatus as any)?.forceActiveUntil
    ? new Date((botStatus as any).forceActiveUntil)
    : null;
  const isForceActive = forceActiveUntil && forceActiveUntil > new Date();
  const isCurrentlyInActiveWindow = isInActiveWindow(currentHour, startH24);
  const isBlackout = !isCurrentlyInActiveWindow;

  const credentialSource = (telegramStatus as any)?.source ?? "none";
  const credentialConfigured = (telegramStatus as any)?.configured ?? false;

  // Handlers
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
    updateSettings.mutate(
      {
        data: {
          blackout_start_hour: String(stopH24),     // NEW: stop time (when bot sleeps)
          active_start_hour: String(startH24),       // keep for backward compat
          auto_sync_interval_minutes: autoSyncInterval,
          default_daily_limit: String(dailyLimitNum),
          active_hours_count: String(activeHoursNum),
        },
      },
      {
        onSuccess: () => {
          toast({
            title: "✅ تم حفظ الجدول",
            description: `البوت يتوقف ${formatHourArFull(stopH24)} ويبدأ ${formatHourArFull(startH24)} — ${dailyLimitNum} انضمام/يوم`,
          });
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
    const r = await fetch(path, { method });
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

      <Tabs defaultValue="schedule" className="w-full">
        <TabsList className="w-full mb-5 grid grid-cols-3 bg-muted/50 border border-border rounded-lg p-1 h-auto gap-1">
          <TabsTrigger value="schedule" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <Clock className="w-3.5 h-3.5" />
            الجدول والتوقيت
          </TabsTrigger>
          <TabsTrigger value="telegram" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <Key className="w-3.5 h-3.5" />
            Telegram API
          </TabsTrigger>
          <TabsTrigger value="backup" className="flex items-center gap-2 text-xs py-2 rounded-md data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-primary/30">
            <DatabaseBackup className="w-3.5 h-3.5" />
            النسخ الاحتياطي
          </TabsTrigger>
        </TabsList>

        {/* ══════════════════════════════════════════
            TAB 1: Schedule — the main redesign
        ══════════════════════════════════════════ */}
        <TabsContent value="schedule" className="space-y-4 mt-0">

          {/* ── Live clock + current status ── */}
          <div className={`rounded-xl border p-4 flex items-center justify-between ${
            isForceActive
              ? "bg-yellow-500/10 border-yellow-500/40"
              : isCurrentlyInActiveWindow
              ? "bg-primary/10 border-primary/30"
              : "bg-muted/30 border-border"
          }`}>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">الوقت الحالي</p>
              <LiveClock />
            </div>

            <div className="text-right space-y-1">
              <p className="text-xs text-muted-foreground">حالة البوت</p>
              {isForceActive ? (
                <div>
                  <Badge className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/40 text-xs gap-1">
                    <Zap className="w-3 h-3" /> تشغيل مؤقت
                  </Badge>
                  <p className="text-[10px] text-yellow-400/80 mt-1">
                    حتى {formatHourArFull(forceActiveUntil!.getHours())}
                  </p>
                </div>
              ) : isCurrentlyInActiveWindow ? (
                <div>
                  <Badge className="bg-primary/20 text-primary border border-primary/30 text-xs gap-1">
                    <Sun className="w-3 h-3" /> وقت النشاط
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    ينتهي الساعة {formatHourArFull(stopH24)}
                  </p>
                </div>
              ) : (
                <div>
                  <Badge variant="secondary" className="text-xs gap-1 border border-border">
                    <Moon className="w-3 h-3" /> وقت الراحة
                  </Badge>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    يستيقظ الساعة {formatHourArFull(startH24)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ── FORCE RESUME — always visible so user can run bot anytime ── */}
          <div className={`rounded-xl border p-4 space-y-3 ${
            isForceActive
              ? "border-yellow-500/40 bg-yellow-500/5"
              : isBlackout
              ? "border-orange-500/30 bg-orange-500/5"
              : "border-primary/20 bg-primary/5"
          }`}>
            <div className="flex items-start gap-2">
              <Zap className={`w-4 h-4 mt-0.5 flex-shrink-0 ${isForceActive ? "text-yellow-400" : isBlackout ? "text-orange-400" : "text-primary"}`} />
              <div className="flex-1">
                <p className={`text-sm font-medium ${isForceActive ? "text-yellow-400" : isBlackout ? "text-orange-400" : "text-foreground"}`}>
                  {isForceActive
                    ? `تشغيل مؤقت نشط حتى ${formatHourArFull(forceActiveUntil!.getHours())}`
                    : isBlackout
                    ? "البوت في وقت راحة — يمكنك تشغيله الآن"
                    : "تشغيل مؤقت — يمكنك تمديد وقت العمل"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  يتجاوز جدول الراحة لمدة محددة ثم يعود تلقائياً للجدول المعتاد
                </p>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {[1, 2, 3, 4, 6, 8].map((h) => (
                <Button
                  key={h}
                  size="sm"
                  onClick={() => forceResume.mutate(h)}
                  disabled={forceResume.isPending}
                  className={`font-mono text-xs gap-1.5 ${
                    isForceActive
                      ? "bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 hover:bg-yellow-500/30"
                      : isBlackout
                      ? "bg-orange-500/20 text-orange-300 border border-orange-500/40 hover:bg-orange-500/30"
                      : "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
                  }`}
                  variant="outline"
                >
                  <Play className="w-3 h-3" />
                  {h} {h === 1 ? "ساعة" : "ساعات"}
                </Button>
              ))}
            </div>
          </div>

          {/* ── 24-hour visual timeline ── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-primary" />
              خريطة النشاط — 24 ساعة
            </p>
            <Timeline startHour={startH24} activeHours={activeHoursNum} currentHour={currentHour} />
          </div>

          {/* ── Time Picker — user sets STOP time, start is auto-calculated ── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <Moon className="w-3.5 h-3.5 text-primary" />
              ضبط وقت التوقف (وقت النوم)
            </p>

            {/* Stop / Start summary — stop is editable, start is auto */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">⏸ وقت التوقف (أنت تحدده)</p>
                <p className="text-xl font-bold text-foreground font-mono">
                  {String(stopHour12).padStart(2, "0")}:00
                </p>
                <p className={`text-sm font-bold mt-0.5 ${stopAmPm === "AM" ? "text-sky-400" : "text-orange-400"}`}>
                  {stopAmPm === "AM" ? "🌙 صباحاً" : "🌆 مساءً"}
                </p>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-1">▶ وقت البداية (تلقائي)</p>
                <p className="text-xl font-bold text-primary font-mono">
                  {String(to12(startH24).hour).padStart(2, "0")}:00
                </p>
                <p className={`text-sm font-bold mt-0.5 ${to12(startH24).ampm === "AM" ? "text-sky-400" : "text-orange-400"}`}>
                  {to12(startH24).ampm === "AM" ? "🌅 صباحاً" : "🌆 مساءً"}
                </p>
                <p className="text-[9px] text-muted-foreground mt-1">
                  = وقت التوقف + {sleepHoursNum}h نوم
                </p>
              </div>
            </div>

            {/* Hour picker: AM/PM toggle + hour buttons */}
            <div className="space-y-3">
              <p className="text-[10px] text-muted-foreground font-semibold">اختر وقت التوقف:</p>
              {/* AM / PM toggle */}
              <div className="flex rounded-lg overflow-hidden border border-border w-full">
                <button
                  onClick={() => setStopAmPm("AM")}
                  className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                    stopAmPm === "AM"
                      ? "bg-sky-500/20 text-sky-400 border-b-2 border-sky-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  🌙 صباحاً (AM)
                  <span className="text-xs font-mono opacity-60">12 – 11</span>
                </button>
                <div className="w-px bg-border" />
                <button
                  onClick={() => setStopAmPm("PM")}
                  className={`flex-1 py-2.5 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${
                    stopAmPm === "PM"
                      ? "bg-orange-500/20 text-orange-400 border-b-2 border-orange-400"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                  }`}
                >
                  🌆 مساءً (PM)
                  <span className="text-xs font-mono opacity-60">12 – 11</span>
                </button>
              </div>

              {/* Hour selector grid — 1 to 12 */}
              <div className="grid grid-cols-6 gap-1.5">
                {[12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => {
                  const isSelected = stopHour12 === h;
                  return (
                    <button
                      key={h}
                      onClick={() => setStopHour12(h)}
                      className={`py-2 rounded-lg text-sm font-bold font-mono transition-all ${
                        isSelected
                          ? stopAmPm === "AM"
                            ? "bg-sky-500/30 text-sky-300 border-2 border-sky-400 shadow-sm"
                            : "bg-orange-500/30 text-orange-300 border-2 border-orange-400 shadow-sm"
                          : "bg-muted/30 text-muted-foreground hover:bg-muted/60 hover:text-foreground border border-transparent"
                      }`}
                    >
                      {h}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Preview sentence */}
            <div className="bg-background border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
              🤖 البوت يعمل من{" "}
              <span className={`font-bold ${to12(startH24).ampm === "AM" ? "text-sky-400" : "text-orange-400"}`}>
                {formatHourArFull(startH24)}
              </span>{" "}
              ويتوقف{" "}
              <span className={`font-bold ${stopAmPm === "AM" ? "text-sky-400" : "text-orange-400"}`}>
                {formatHourArFull(stopH24)}
              </span>{" "}
              ({activeHoursNum}ساعة نشاط + {sleepHoursNum} ساعات نوم)
            </div>
          </div>

          {/* ── Daily Limit + Active Hours + Timing Summary ── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <Zap className="w-3.5 h-3.5 text-primary" />
              إعدادات الانضمام والتوقيت
            </p>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">الحد اليومي / حساب</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="10" max="200"
                    value={dailyLimit}
                    onChange={(e) => setDailyLimit(e.target.value)}
                    className="h-8 w-20 text-sm font-mono text-center bg-background border-border"
                    dir="ltr"
                  />
                  <span className="text-xs text-muted-foreground">انضمام/يوم</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">ساعات النشاط</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="6" max="23"
                    value={activeHoursCount}
                    onChange={(e) => setActiveHoursCount(e.target.value)}
                    className="h-8 w-20 text-sm font-mono text-center bg-background border-border"
                    dir="ltr"
                  />
                  <span className="text-xs text-muted-foreground">ساعة/يوم</span>
                </div>
              </div>
            </div>

            {/* Timing formula summary */}
            <div className="rounded-lg bg-muted/30 border border-border p-3 space-y-2 text-xs font-mono">
              <p className="text-muted-foreground">📐 معادلة التوقيت الآمن:</p>
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-background rounded-md p-2 border border-border">
                  <p className="text-muted-foreground text-[10px]">الفاصل الآمن / حساب</p>
                  <p className="text-foreground font-bold">~{Math.floor(safeIntervalSecs / 60)} دقيقة</p>
                  <p className="text-muted-foreground text-[10px]">{safeIntervalSecs} ثانية</p>
                </div>
                {[1, 3, 7, 15].map((n) => {
                  const tick = Math.max(30, Math.floor(safeIntervalSecs / n));
                  return (
                    <div key={n} className="bg-background rounded-md p-2 border border-border">
                      <p className="text-muted-foreground text-[10px]">{n} حسابات نشطة</p>
                      <p className="text-primary font-bold">تيك كل {tick}ث</p>
                      <p className="text-muted-foreground text-[10px]">
                        ~{Math.ceil(activeHoursNum * 3600 / tick * n)} انضمام/يوم
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ── Auto-sync + Save ── */}
          <div className="bg-card border border-border rounded-xl p-4 space-y-4">
            <p className="text-xs font-semibold text-foreground border-b border-border pb-2 flex items-center gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-primary" />
              المزامنة والحفظ
            </p>
            <div className="flex items-end gap-4">
              <div className="space-y-1.5 flex-shrink-0">
                <Label className="text-xs font-medium text-muted-foreground">تزامن المجموعات كل</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min="5" max="1440"
                    value={autoSyncInterval}
                    onChange={(e) => setAutoSyncInterval(e.target.value)}
                    className="h-8 w-20 text-sm font-mono text-center bg-background border-border"
                    dir="ltr"
                  />
                  <span className="text-xs text-muted-foreground">دقيقة</span>
                </div>
              </div>
              <Button
                onClick={handleSaveSchedule}
                disabled={updateSettings.isPending}
                className="flex items-center gap-2 flex-1"
              >
                <Save className="w-3.5 h-3.5" />
                حفظ الجدول
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ══════════════════════════════════════════
            TAB 2: Telegram API + AI Filter
        ══════════════════════════════════════════ */}
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

        {/* ══════════════════════════════════════════
            TAB 3: MongoDB Backup
        ══════════════════════════════════════════ */}
        <TabsContent value="backup" className="space-y-4 mt-0">
          <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 text-xs text-amber-400 flex items-start gap-2">
            <span className="flex-shrink-0">⚠️</span>
            الجلسات بيانات حساسة — تأكد أن قاعدة MongoDB محمية بكلمة مرور.
          </div>

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
