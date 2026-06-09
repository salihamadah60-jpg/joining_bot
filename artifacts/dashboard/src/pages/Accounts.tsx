import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
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
import { Users, Plus, Trash2, KeyRound, CheckCircle2, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
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

// ─── Auth Dialog ──────────────────────────────────────────────────────────────

type AuthStep = "idle" | "sending" | "entering_code" | "entering_password" | "done";

function AuthDialog({ phone, onDone }: { phone: string; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<AuthStep>("idle");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [codeLength, setCodeLength] = useState(5);
  const { toast } = useToast();

  const sendCode = useAuthSendCode();
  const verifyCode = useAuthVerifyCode();
  const verifyPassword = useAuthVerifyPassword();
  const cancel = useAuthCancel();

  const handleOpen = (o: boolean) => {
    if (!o) {
      // Cancel any pending auth when dialog closes
      if (step !== "idle" && step !== "done") {
        cancel.mutate({ data: { phone } });
      }
      setStep("idle");
      setCode("");
      setPassword("");
    }
    setOpen(o);
  };

  const handleSend = () => {
    setStep("sending");
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
            <p className="text-sm text-muted-foreground font-mono">
              أدخل الرمز المكون من {codeLength} أرقام
            </p>
            <div className="flex justify-center" dir="ltr">
              <InputOTP
                maxLength={codeLength}
                value={code}
                onChange={setCode}
              >
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          ACCOUNTS_REGISTRY
        </h1>

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
                <TableRow key={acc.id} className="border-card-border">
                  <TableCell className="font-medium text-sm">
                    <div className="flex items-center gap-2">
                      {acc.hasSession ? (
                        <Wifi className="w-3 h-3 text-primary" />
                      ) : (
                        <WifiOff className="w-3 h-3 text-yellow-500" />
                      )}
                      {acc.phone}
                      {acc.isPremium && (
                        <Badge variant="outline" className="text-xs text-yellow-500 border-yellow-500">★</Badge>
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
                    <div className="flex items-center justify-end gap-2">
                      {/* Sync dialogs count button */}
                      {acc.hasSession && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => { setSyncingId(acc.id); syncDialogs.mutate(acc.id); }}
                          disabled={syncingId === acc.id}
                          className="font-mono text-xs gap-1 border-muted-foreground/30 text-muted-foreground hover:text-foreground"
                          title="مزامنة عدد القنوات الحقيقي من تيليجرام"
                        >
                          <RefreshCw className={`w-3 h-3 ${syncingId === acc.id ? "animate-spin" : ""}`} />
                          SYNC
                        </Button>
                      )}

                      {/* Auth button — shown for all accounts (can re-auth at any time) */}
                      <AuthDialog phone={acc.phone} onDone={invalidate} />

                      {/* Pause / resume toggle */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">
                          {acc.status === "paused" ? "▶" : "⏸"}
                        </span>
                        <Switch
                          checked={acc.status !== "paused" && acc.status !== "banned"}
                          disabled={acc.status === "banned"}
                          onCheckedChange={() => handleToggleStatus(acc.id, acc.status)}
                        />
                      </div>

                      {/* Delete */}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(acc.id)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive h-7 w-7"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
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
