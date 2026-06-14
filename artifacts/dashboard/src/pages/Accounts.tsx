import { useState, useEffect, useRef, Fragment } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  useListAccounts,
  useUpdateAccount,
  useDeleteAccount,
  useCreateAccount,
  useAuthSendCode,
  useAuthVerifyCode,
  useAuthVerifyPassword,
  useAuthCancel,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, Trash2, KeyRound, CheckCircle2, XCircle, Wifi, WifiOff, RefreshCw, Radio, ChevronDown, ChevronRight, ExternalLink, List, Copy, Hash, Bug } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";

// ─── Status badge ─────────────────────────────────────────────────────────────

function getStatusBadge(status: string, floodWaitUntil?: string | null, hasSession?: boolean) {
  switch (status) {
    case "active":
      return (
        <div className="flex items-center gap-1.5">
          <Badge className="bg-primary text-primary-foreground font-mono text-xs">ACTIVE</Badge>
          {!hasSession && <Badge variant="outline" className="border-yellow-500 text-yellow-500 font-mono text-xs">NO_SESSION</Badge>}
        </div>
      );
    case "paused":
      return <Badge variant="secondary" className="font-mono text-xs">PAUSED</Badge>;
    case "banned":
      return <Badge variant="destructive" className="font-mono text-xs">BANNED</Badge>;
    case "channels_limit":
      return <Badge variant="destructive" className="font-mono text-xs">CHANNELS_FULL</Badge>;
    case "needs_auth":
      return <Badge variant="outline" className="border-yellow-500 text-yellow-500 font-mono text-xs animate-pulse">NEEDS_AUTH</Badge>;
    case "flood_wait":
      return (
        <Badge variant="outline" className="border-orange-500 text-orange-500 font-mono text-xs">
          FLOOD_WAIT {floodWaitUntil ? `(${formatDistanceToNow(new Date(floodWaitUntil))})` : ""}
        </Badge>
      );
    default:
      return <Badge variant="outline" className="font-mono text-xs">{status.toUpperCase()}</Badge>;
  }
}

// ─── Groups Panel ─────────────────────────────────────────────────────────────

interface GroupEntry {
  id: string;
  url: string;
  groupTitle: string | null;
  groupType: string | null;
  joinedAt: string;
}

function GroupsPanel({ accountId }: { accountId: string }) {
  const { data: groups = [], isLoading } = useQuery<GroupEntry[]>({
    queryKey: [`/api/accounts/${accountId}/groups`],
    queryFn: () => fetch(`/api/accounts/${accountId}/groups`).then((r) => r.json()),
  });

  if (isLoading) return (
    <p className="text-xs text-muted-foreground py-2 font-mono">⏳ جاري تحميل المجموعات...</p>
  );

  if (groups.length === 0) return (
    <p className="text-xs text-muted-foreground py-2 font-mono">لا توجد مجموعات مسجلة لهذا الحساب في قاعدة البيانات</p>
  );

  return (
    <div className="max-h-56 overflow-y-auto space-y-1.5 font-mono">
      <p className="text-xs text-muted-foreground pb-1">
        <span className="text-primary font-bold">{groups.length}</span> مجموعة / قناة
      </p>
      {groups.map((g) => (
        <div key={g.id} className="flex items-center gap-2 text-xs">
          <a
            href={g.url}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline flex items-center gap-1 truncate max-w-xs"
            title={g.url}
          >
            {g.groupTitle ?? g.url}
            <ExternalLink className="w-2.5 h-2.5 flex-shrink-0 opacity-60" />
          </a>
          {g.groupType && (
            <Badge variant="outline" className="text-xs py-0 px-1 font-mono">{g.groupType}</Badge>
          )}
          <span className="text-muted-foreground flex-shrink-0">
            {formatDistanceToNow(new Date(g.joinedAt), { addSuffix: true, locale: ar })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Auth Dialog ──────────────────────────────────────────────────────────────

type AuthStep = "idle" | "sending" | "entering_code" | "entering_password" | "done";

function AuthDialog({ phone, onDone }: { phone: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthStep>("idle");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeLength, setCodeLength] = useState(5);
  const [otpAutoFound, setOtpAutoFound] = useState(false);
  const otpPollerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { toast } = useToast();

  // timestamp (Unix seconds) when send-code was called — used to filter old codes
  const sendCodeTimestampRef = useRef<number>(0);

  // Debug panel state
  const [showDebug, setShowDebug] = useState(false);
  const [debugLoading, setDebugLoading] = useState(false);
  const [debugData, setDebugData] = useState<Array<{
    sender: string;
    status: "ok" | "error";
    error?: string;
    messages: Array<{ text: string; date: number; extractedCode: string | null }>;
  }>>([]);

  const fetchDebugMessages = async () => {
    setDebugLoading(true);
    try {
      const r = await fetch(`/api/auth/debug-messages/${encodeURIComponent(phone)}`);
      const data = await r.json();
      setDebugData(data.senders ?? []);
      setShowDebug(true);
    } catch (_) {
      toast({ title: "خطأ", description: "فشل جلب الرسائل التشخيصية", variant: "destructive" });
    } finally {
      setDebugLoading(false);
    }
  };

  // ── OTP auto-capture polling ──
  useEffect(() => {
    if (step !== "entering_code") {
      if (otpPollerRef.current) { clearInterval(otpPollerRef.current); otpPollerRef.current = null; }
      return;
    }
    // Use the timestamp from when we sent the code so we only catch NEW codes
    const after = sendCodeTimestampRef.current || Math.floor(Date.now() / 1000) - 30;
    const poll = async () => {
      try {
        const r = await fetch(`/api/auth/pending-code/${encodeURIComponent(phone)}?after=${after}`);
        const data = await r.json();
        if (data.found && data.code && !otpAutoFound) {
          setCode(data.code);
          setOtpAutoFound(true);
          toast({ title: "📱 تم التقاط الكود تلقائياً", description: `الكود: ${data.code}` });
          if (otpPollerRef.current) { clearInterval(otpPollerRef.current); otpPollerRef.current = null; }
        }
      } catch (_) {}
    };
    poll();
    otpPollerRef.current = setInterval(poll, 2000);
    return () => { if (otpPollerRef.current) { clearInterval(otpPollerRef.current); otpPollerRef.current = null; } };
  }, [step, phone, otpAutoFound]);

  const sendCode = useAuthSendCode();
  const verifyCode = useAuthVerifyCode();
  const verifyPassword = useAuthVerifyPassword();
  const cancel = useAuthCancel();

  const handleOpen = (o: boolean) => {
    if (!o) {
      if (step !== "idle" && step !== "done") cancel.mutate({ data: { phone } });
      setStep("idle");
      setCode("");
      setPassword("");
      setOtpAutoFound(false);
      if (otpPollerRef.current) { clearInterval(otpPollerRef.current); otpPollerRef.current = null; }
    }
    setOpen(o);
  };

  const handleSend = () => {
    setStep("sending");
    // Record timestamp so polling only picks up codes received AFTER this moment
    sendCodeTimestampRef.current = Math.floor(Date.now() / 1000);
    sendCode.mutate(
      { data: { phone } },
      {
        onSuccess: (res) => {
          if (res.alreadyLoggedIn) {
            setStep("done");
            toast({ title: "✅ الحساب متصل", description: "تم التحقق من الجلسة بنجاح" });
            onDone();
            return;
          }
          setCodeLength(res.length ?? 5);
          setStep("entering_code");
        },
        onError: (e: any) => {
          setStep("idle");
          toast({ title: "❌ خطأ", description: e?.message ?? "فشل إرسال الكود", variant: "destructive" });
        },
      }
    );
  };

  const handleVerifyCode = () => {
    verifyCode.mutate(
      { data: { phone, code } },
      {
        onSuccess: (res) => {
          if (res.needPassword) {
            setStep("entering_password");
          } else {
            setStep("done");
            toast({ title: "✅ تم تسجيل الدخول", description: `مرحباً ${res.firstName ?? ""}` });
            onDone();
          }
        },
        onError: (e: any) => {
          toast({ title: "❌ كود خاطئ", description: e?.message ?? "رمز التحقق غير صحيح", variant: "destructive" });
        },
      }
    );
  };

  const handleVerifyPassword = () => {
    verifyPassword.mutate(
      { data: { phone, password } },
      {
        onSuccess: () => {
          setStep("done");
          toast({ title: "✅ تم تسجيل الدخول", description: "تم التحقق بكلمة المرور" });
          onDone();
        },
        onError: (e: any) => {
          toast({ title: "❌ كلمة مرور خاطئة", description: e?.message ?? "كلمة المرور غير صحيحة", variant: "destructive" });
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="font-mono text-xs gap-1 border-yellow-500 text-yellow-500 hover:bg-yellow-500/10">
          <KeyRound className="w-3 h-3" /> AUTH
        </Button>
      </DialogTrigger>
      <DialogContent className="border-card-border bg-card max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">TELEGRAM_AUTH</DialogTitle>
          <DialogDescription className="font-mono text-xs text-muted-foreground">{phone}</DialogDescription>
        </DialogHeader>

        {/* Step: idle → send code */}
        {step === "idle" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground font-mono">
              سيتم إرسال رمز تحقق إلى التطبيق أو عبر SMS
            </p>
            <Button
              onClick={handleSend}
              disabled={sendCode.isPending}
              className="w-full font-mono"
            >
              {sendCode.isPending ? "جاري الإرسال..." : "إرسال الرمز"}
            </Button>
          </div>
        )}

        {/* Step: sending (loading state) */}
        {step === "sending" && (
          <div className="py-6 text-center text-muted-foreground font-mono text-sm animate-pulse">
            ⏳ جاري إرسال الرمز...
          </div>
        )}

        {/* Step: enter OTP */}
        {step === "entering_code" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground font-mono flex-1">
                أدخل الرمز المكون من {codeLength} أرقام
              </p>
              {!otpAutoFound && (
                <p className="text-xs text-yellow-400 font-mono animate-pulse">🔍 بحث...</p>
              )}
              {otpAutoFound && (
                <p className="text-xs text-primary font-mono">✅ تلقائي</p>
              )}
            </div>

            <div className="flex justify-center" dir="ltr">
              <InputOTP maxLength={codeLength} value={code} onChange={setCode}>
                <InputOTPGroup>
                  {Array.from({ length: codeLength }).map((_, i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>

            <Button
              onClick={handleVerifyCode}
              disabled={code.length < codeLength || verifyCode.isPending}
              className="w-full font-mono"
            >
              {verifyCode.isPending ? "جاري التحقق..." : "تأكيد الرمز"}
            </Button>

            {/* ── Debug Panel ── */}
            <div className="border border-border rounded-lg overflow-hidden">
              <button
                onClick={() => showDebug ? setShowDebug(false) : fetchDebugMessages()}
                disabled={debugLoading}
                className="w-full flex items-center gap-2 px-3 py-2 bg-muted/30 hover:bg-muted/50 transition-colors text-xs text-muted-foreground"
              >
                <Bug className="w-3 h-3 text-yellow-500 flex-shrink-0" />
                <span className="flex-1 text-right font-mono">
                  {debugLoading ? "جاري الجلب..." : "🔬 فحص رسائل المُرسِل (777000 / +42777)"}
                </span>
                {showDebug ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              </button>

              {showDebug && (
                <div className="p-3 space-y-3 bg-background border-t border-border max-h-64 overflow-y-auto">
                  {/* Refresh button */}
                  <button
                    onClick={fetchDebugMessages}
                    disabled={debugLoading}
                    className="text-[10px] text-primary hover:underline font-mono flex items-center gap-1"
                  >
                    <RefreshCw className="w-2.5 h-2.5" />
                    تحديث
                  </button>

                  {debugData.length === 0 && (
                    <p className="text-xs text-muted-foreground font-mono">لا توجد بيانات</p>
                  )}

                  {debugData.map((senderData) => (
                    <div key={senderData.sender} className="space-y-1.5">
                      {/* Sender header */}
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${
                          senderData.status === "ok"
                            ? "bg-primary/10 text-primary border border-primary/20"
                            : "bg-destructive/10 text-destructive border border-destructive/20"
                        }`}>
                          {senderData.sender === "777000" ? "Telegram 777000" : "+42777"}
                        </span>
                        {senderData.status === "error" && (
                          <span className="text-[10px] text-destructive font-mono truncate">
                            ✗ {senderData.error?.substring(0, 40)}
                          </span>
                        )}
                        {senderData.status === "ok" && senderData.messages.length === 0 && (
                          <span className="text-[10px] text-muted-foreground font-mono">لا رسائل</span>
                        )}
                      </div>

                      {/* Messages */}
                      {senderData.messages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`rounded-md p-2 border text-xs font-mono space-y-1 ${
                            msg.extractedCode
                              ? "border-primary/30 bg-primary/5"
                              : "border-border bg-muted/20"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-muted-foreground leading-snug break-all flex-1" dir="ltr">
                              {msg.text || "(رسالة فارغة)"}
                            </p>
                            {msg.extractedCode && (
                              <button
                                onClick={() => {
                                  setCode(msg.extractedCode!);
                                  setOtpAutoFound(true);
                                  setShowDebug(false);
                                  toast({ title: "✅ تم استخدام الكود", description: `الكود: ${msg.extractedCode}` });
                                }}
                                className="flex-shrink-0 bg-primary text-primary-foreground text-[10px] font-bold px-2 py-0.5 rounded hover:bg-primary/90 transition-colors"
                              >
                                {msg.extractedCode} ←
                              </button>
                            )}
                          </div>
                          <p className="text-[10px] text-muted-foreground">
                            {msg.date ? new Date(msg.date * 1000).toLocaleTimeString("ar-SA") : "—"}
                            {msg.extractedCode
                              ? <span className="text-primary font-bold mr-2">كود مستخرج: {msg.extractedCode}</span>
                              : <span className="text-muted-foreground mr-2">لم يُكتشف كود</span>
                            }
                          </p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step: 2FA password */}
        {step === "entering_password" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground font-mono">
              🔐 التحقق بخطوتين مفعّل. أدخل كلمة المرور
            </p>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="كلمة المرور"
              className="bg-background font-mono"
              dir="ltr"
              onKeyDown={(e) => e.key === "Enter" && handleVerifyPassword()}
            />
            <Button
              onClick={handleVerifyPassword}
              disabled={!password || verifyPassword.isPending}
              className="w-full font-mono"
            >
              {verifyPassword.isPending ? "جاري التحقق..." : "تأكيد كلمة المرور"}
            </Button>
          </div>
        )}

        {/* Step: done */}
        {step === "done" && (
          <div className="py-6 flex flex-col items-center gap-3">
            <CheckCircle2 className="w-10 h-10 text-primary" />
            <p className="font-mono text-sm text-primary">SESSION_SAVED</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Code Watch Panel ─────────────────────────────────────────────────────────

interface CodeWatchPanelProps {
  phone: string;
  startedAt: number; // Unix seconds — only return codes newer than this
  onClose: () => void;
}

function CodeWatchPanel({ phone, startedAt, onClose }: CodeWatchPanelProps) {
  const [code, setCode] = useState<string | null>(null);
  const [found, setFound] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(300); // 5 minutes
  const { toast } = useToast();

  // Countdown timer
  useEffect(() => {
    if (found) return;
    const t = setInterval(() => setSecondsLeft((prev) => Math.max(0, prev - 1)), 1000);
    return () => clearInterval(t);
  }, [found]);

  // Polling every 3 seconds for a fresh code from 777000
  useEffect(() => {
    if (found) return;

    let stopped = false;

    const doPoll = async () => {
      if (stopped) return;
      try {
        const r = await fetch(
          `/api/auth/pending-code/${encodeURIComponent(phone)}?after=${startedAt}`
        );
        const data: { found: boolean; code?: string } = await r.json();
        if (data.found && data.code && !stopped) {
          stopped = true;
          setCode(data.code);
          setFound(true);
          toast({
            title: "🎉 وصل كود التحقق!",
            description: `الكود: ${data.code} — الحساب ${phone}`,
            duration: 20_000,
          });
        }
      } catch { /* ignore network errors */ }
    };

    doPoll(); // immediate first check
    const intervalId = setInterval(doPoll, 3_000);
    // Auto-stop after 5 minutes
    const timeoutId = setTimeout(() => { stopped = true; clearInterval(intervalId); }, 300_000);

    return () => {
      stopped = true;
      clearInterval(intervalId);
      clearTimeout(timeoutId);
    };
  }, [found]);

  const copyCode = () => {
    if (!code) return;
    navigator.clipboard.writeText(code).catch(() => {});
    toast({ title: "✅ تم نسخ الكود", description: code, duration: 4_000 });
  };

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;

  return (
    <div className="flex flex-wrap items-center gap-3 py-1 font-mono" dir="rtl">
      {!found ? (
        <>
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
            <span className="text-xs text-muted-foreground">
              في انتظار كود التحقق من
            </span>
            <span className="text-xs font-bold text-primary">777000</span>
            <span className="text-xs text-muted-foreground/50">({phone})</span>
          </div>
          {secondsLeft > 0 ? (
            <span className="text-xs text-muted-foreground/60 bg-muted px-2 py-0.5 rounded">
              {mins}:{secs.toString().padStart(2, "0")} متبقي
            </span>
          ) : (
            <span className="text-xs text-yellow-500">انتهى وقت الانتظار — لم يصل كود</span>
          )}
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            إلغاء
          </button>
        </>
      ) : (
        <>
          <CheckCircle2 className="w-4 h-4 text-primary flex-shrink-0" />
          <span className="text-xs text-muted-foreground">كود التحقق:</span>
          <span className="text-xl font-bold tracking-[0.4em] text-primary bg-primary/10 border border-primary/40 px-4 py-1 rounded-md select-all cursor-text">
            {code}
          </span>
          <button
            onClick={copyCode}
            className="flex items-center gap-1.5 text-sm bg-primary text-primary-foreground px-3 py-1.5 rounded hover:bg-primary/90 transition-colors"
          >
            <Copy className="w-3.5 h-3.5" />
            نسخ الكود
          </button>
          <span className="text-xs text-muted-foreground/50">({phone})</span>
          <button
            onClick={onClose}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            إغلاق
          </button>
        </>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Accounts() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: accounts, isLoading } = useListAccounts();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const createAccount = useCreateAccount();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
  };

  const handleToggleStatus = (id: string, currentStatus: string) => {
    const newStatus = currentStatus === "paused" ? "active" : "paused";
    updateAccount.mutate(
      { id, data: { status: newStatus as any } },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "الحساب محدَّث", description: `الحالة: ${newStatus}` });
        },
      }
    );
  };

  const handleDelete = (id: string) => {
    if (confirm("هل أنت متأكد من حذف هذا الحساب؟")) {
      deleteAccount.mutate(
        { id },
        { onSuccess: () => { invalidate(); toast({ title: "تم الحذف" }); } }
      );
    }
  };

  const handleAdd = () => {
    if (!newPhone.startsWith("+")) {
      toast({ title: "رقم الهاتف يجب أن يبدأ بـ +", variant: "destructive" });
      return;
    }
    createAccount.mutate(
      { data: { phone: newPhone, label: newLabel || undefined } },
      {
        onSuccess: () => {
          invalidate();
          setIsAddOpen(false);
          setNewPhone("");
          setNewLabel("");
          toast({ title: "تم إضافة الحساب" });
        },
        onError: (e: any) => {
          toast({ title: "فشل الإضافة", description: e?.message, variant: "destructive" });
        },
      }
    );
  };

  const [syncingId, setSyncingId] = useState<string | null>(null);
  const [pingingId, setPingingId] = useState<string | null>(null);
  const [pingResults, setPingResults] = useState<Record<string, { ok: boolean; name?: string; error?: string }>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [codeWatcherId, setCodeWatcherId] = useState<string | null>(null);
  const [codeWatchStart, setCodeWatchStart] = useState<number>(0); // Unix seconds

  const startCodeWatcher = (id: string) => {
    setCodeWatcherId(id);
    setCodeWatchStart(Math.floor(Date.now() / 1000));
  };

  const reuseJoined = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/links/reuse-joined", { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ added: number; reset: number; skipped: number; total: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: "✅ تم إعادة إضافة الروابط المنضم إليها",
        description: `جديد: ${data.added} — أُعيد تفعيله: ${data.reset} — موجود: ${data.skipped} (إجمالي: ${data.total})`,
      });
    },
    onError: (e: any) => toast({ title: "خطأ في إعادة الإضافة", description: e?.message, variant: "destructive" }),
  });

  const pingAccount = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/accounts/${id}/ping`);
      if (!r.ok) throw new Error(await r.text());
      return r.json() as Promise<{ ok: boolean; firstName?: string; username?: string; error?: string }>;
    },
    onSuccess: (data, id) => {
      setPingingId(null);
      setPingResults((prev) => ({
        ...prev,
        [id]: { ok: data.ok, name: data.firstName ?? data.username, error: data.error },
      }));
      if (data.ok) {
        toast({ title: `✅ متصل — ${data.firstName ?? data.username ?? ""}`, description: "الجلسة نشطة" });
      } else {
        toast({ title: "❌ الاتصال فشل", description: data.error ?? "الجلسة منتهية", variant: "destructive" });
      }
    },
    onError: (e: any, id) => {
      setPingingId(null);
      setPingResults((prev) => ({ ...prev, [id]: { ok: false, error: e?.message } }));
      toast({ title: "❌ خطأ في الفحص", description: e?.message, variant: "destructive" });
    },
  });

  const syncDialogs = useMutation({
    mutationFn: async (id: string) => {
      const r = await fetch(`/api/accounts/${id}/sync-dialogs`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: (data, id) => {
      invalidate();
      setSyncingId(null);
      toast({ title: "✅ تم مزامنة عدد القنوات", description: `العدد الحقيقي: ${data.channelsCount}` });
    },
    onError: (e: any, id) => {
      setSyncingId(null);
      toast({ title: "فشل المزامنة", description: e?.message, variant: "destructive" });
    },
  });

  const needsAuthAccounts = accounts?.filter((a) => a.status === "needs_auth" || !a.hasSession) ?? [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          ACCOUNTS_REGISTRY
        </h1>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => reuseJoined.mutate()}
            disabled={reuseJoined.isPending}
            className="font-mono text-xs gap-1.5 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
            title="إعادة إضافة الروابط من JOINED لحسابات جديدة"
          >
            <Copy className="w-3.5 h-3.5" />
            {reuseJoined.isPending ? "جاري..." : "إعادة إضافة JOINED"}
          </Button>

        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono">
              <Plus className="w-4 h-4 mr-2" /> REGISTER_ACCOUNT
            </Button>
          </DialogTrigger>
          <DialogContent className="border-card-border bg-card">
            <DialogHeader>
              <DialogTitle className="font-mono">ADD_NEW_ACCOUNT</DialogTitle>
              <DialogDescription className="font-mono text-xs text-muted-foreground">
                أضف الحساب أولاً ثم استخدم زر AUTH لتسجيل الدخول
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4 font-mono">
              <div className="space-y-2">
                <Label>رقم الهاتف (يبدأ بـ +)</Label>
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+9661234567890"
                  className="bg-background border-input"
                  dir="ltr"
                />
              </div>
              <div className="space-y-2">
                <Label>التسمية (اختياري)</Label>
                <Input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="حساب رئيسي"
                  className="bg-background border-input"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={handleAdd}
                disabled={!newPhone || createAccount.isPending}
                className="font-mono w-full"
              >
                SUBMIT_REGISTRATION
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Needs-auth banner */}
      {needsAuthAccounts.length > 0 && (
        <Card className="border-yellow-500/40 bg-yellow-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <WifiOff className="w-4 h-4 text-yellow-500 shrink-0" />
            <p className="font-mono text-xs text-yellow-500">
              {needsAuthAccounts.length} حساب يحتاج تسجيل دخول — اضغط زر AUTH بجانب كل حساب
            </p>
          </CardContent>
        </Card>
      )}

      {/* Accounts table */}
      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono text-xs">PHONE</TableHead>
                <TableHead className="font-mono text-xs">LABEL</TableHead>
                <TableHead className="font-mono text-xs">STATUS</TableHead>
                <TableHead className="font-mono text-xs text-right">TODAY</TableHead>
                <TableHead className="font-mono text-xs text-right">TOTAL</TableHead>
                <TableHead className="font-mono text-xs text-right">CHANNELS</TableHead>
                <TableHead className="font-mono text-xs text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono">
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                    LOADING...
                  </TableCell>
                </TableRow>
              )}
              {accounts?.map((acc) => (
                <Fragment key={acc.id}>
                <TableRow className="border-card-border">
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-1.5">
                      {/* Expand groups button — clear hit area */}
                      <button
                        onClick={() => setExpandedId((prev) => prev === acc.id ? null : acc.id)}
                        className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="عرض المجموعات المنضم إليها"
                      >
                        {expandedId === acc.id
                          ? <ChevronDown className="w-4 h-4" />
                          : <ChevronRight className="w-4 h-4" />
                        }
                      </button>
                      {acc.hasSession ? (
                        <Wifi className="w-3 h-3 flex-shrink-0 text-primary" />
                      ) : (
                        <WifiOff className="w-3 h-3 flex-shrink-0 text-yellow-500" />
                      )}
                      <span className="truncate">{acc.phone}</span>
                      {acc.isPremium && (
                        <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500 flex-shrink-0">★</Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-xs">{acc.label || "—"}</TableCell>
                  <TableCell>{getStatusBadge(acc.status, acc.floodWaitUntil, acc.hasSession)}</TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="text-primary">{acc.joinedToday}</span>
                    <span className="text-muted-foreground text-xs ml-1">/ {acc.dailyLimit}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    <span className="text-primary">{acc.joinedCount}</span>
                    <span className="text-muted-foreground mx-0.5">/</span>
                    <span className="text-destructive">{acc.failedCount}</span>
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {acc.channelsCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {/* Ping — icon-only with tooltip */}
                      {acc.hasSession && (
                        <button
                          onClick={() => { setPingingId(acc.id); pingAccount.mutate(acc.id); }}
                          disabled={pingingId === acc.id}
                          title="PING — فحص الاتصال بتيليجرام"
                          className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
                            pingResults[acc.id]?.ok === true
                              ? "border-primary/50 text-primary hover:bg-primary/10"
                              : pingResults[acc.id]?.ok === false
                              ? "border-destructive/50 text-destructive hover:bg-destructive/10"
                              : "border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60"
                          }`}
                        >
                          {pingingId === acc.id ? (
                            <Radio className="w-3.5 h-3.5 animate-pulse" />
                          ) : pingResults[acc.id]?.ok === true ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : pingResults[acc.id]?.ok === false ? (
                            <XCircle className="w-3.5 h-3.5" />
                          ) : (
                            <Radio className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}

                      {/* Sync — icon-only with tooltip */}
                      {acc.hasSession && (
                        <button
                          onClick={() => { setSyncingId(acc.id); syncDialogs.mutate(acc.id); }}
                          disabled={syncingId === acc.id}
                          title="SYNC — مزامنة عدد القنوات"
                          className="w-7 h-7 flex items-center justify-center rounded border border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60 transition-colors"
                        >
                          <RefreshCw className={`w-3.5 h-3.5 ${syncingId === acc.id ? "animate-spin" : ""}`} />
                        </button>
                      )}

                      {/* Code watcher — capture OTP from 777000 for active sessions */}
                      {acc.hasSession && (
                        <button
                          onClick={() =>
                            codeWatcherId === acc.id
                              ? setCodeWatcherId(null)
                              : startCodeWatcher(acc.id)
                          }
                          title="التقاط كود التحقق من 777000"
                          className={`w-7 h-7 flex items-center justify-center rounded border transition-colors ${
                            codeWatcherId === acc.id
                              ? "border-primary text-primary bg-primary/15 animate-pulse"
                              : "border-muted-foreground/30 text-muted-foreground hover:text-foreground hover:border-muted-foreground/60"
                          }`}
                        >
                          <Hash className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Auth button */}
                      <AuthDialog phone={acc.phone} onDone={invalidate} />

                      {/* Pause / resume toggle — no redundant text label */}
                      <Switch
                        checked={acc.status !== "paused" && acc.status !== "banned"}
                        disabled={acc.status === "banned"}
                        onCheckedChange={() => handleToggleStatus(acc.id, acc.status)}
                        title={acc.status === "paused" ? "استئناف الحساب" : "إيقاف مؤقت"}
                      />

                      {/* Delete */}
                      <button
                        onClick={() => handleDelete(acc.id)}
                        title="حذف الحساب"
                        className="w-7 h-7 flex items-center justify-center rounded text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
                {expandedId === acc.id && (
                  <TableRow className="border-card-border bg-muted/10 hover:bg-muted/10">
                    <TableCell colSpan={7} className="py-3 px-6">
                      <div className="border border-border rounded-lg p-3 bg-background">
                        <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                          <List className="w-3.5 h-3.5 text-primary" />
                          المجموعات المنضم إليها — {acc.phone}
                        </p>
                        <GroupsPanel accountId={acc.id} />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {codeWatcherId === acc.id && (
                  <TableRow className="border-card-border bg-primary/5 hover:bg-primary/5">
                    <TableCell colSpan={7} className="py-2.5 px-6">
                      <div className="border border-primary/20 rounded-lg px-4 py-2 bg-background">
                        <div className="flex items-center gap-2 mb-1.5">
                          <Hash className="w-3.5 h-3.5 text-primary" />
                          <span className="text-xs font-semibold text-foreground font-mono">
                            مراقبة كود التحقق — 777000
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                            اذهب للتطبيق الآخر واطلب الكود، سيظهر هنا تلقائياً
                          </span>
                        </div>
                        <CodeWatchPanel
                          phone={acc.phone}
                          startedAt={codeWatchStart}
                          onClose={() => setCodeWatcherId(null)}
                        />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
              {!isLoading && accounts?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center text-muted-foreground font-mono text-sm">
                    NO_ACCOUNTS — اضغط REGISTER_ACCOUNT للبدء
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
