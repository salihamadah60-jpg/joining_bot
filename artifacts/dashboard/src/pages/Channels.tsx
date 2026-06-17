import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import {
  Radio, Download, LogOut, History, RefreshCw, RotateCcw,
  Loader2, AlertTriangle, CheckCircle2, Search, Zap, Stethoscope,
  XCircle, HelpCircle, ChevronDown, ChevronUp, Clock, Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { useListAccounts } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelLink {
  id: string;
  url: string;
  title: string | null;
  detectedAt: string;
}

interface Dialog {
  id: string;
  chatId: string;
  title: string | null;
  username: string | null;
  url: string | null;
  chatType: string | null;
  syncedAt: string | null;
  classification: "medical" | "non_medical" | "uncertain";
}

interface LeftGroup {
  id: string;
  url: string;
  accountPhone: string;
  title: string | null;
  chatType: string | null;
  reason: string;
  leftAt: string;
}

interface LeaveResultItem {
  url: string;
  title: string | null;
  ok: boolean;
  error?: string;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchDialogs(phone: string): Promise<Dialog[]> {
  const r = await fetch(`/api/accounts/${encodeURIComponent(phone)}/dialogs`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function fetchLeaveHistory(accountPhone?: string): Promise<{ total: number; items: LeftGroup[] }> {
  const params = new URLSearchParams({ limit: "200" });
  if (accountPhone) params.set("accountPhone", accountPhone);
  const r = await fetch(`/api/leave/history?${params}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function batchLeave(
  accountPhone: string,
  groups: Dialog[],
  reason: string
): Promise<{ success: number; failed: number; results: LeaveResultItem[] }> {
  const r = await fetch("/api/leave/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountPhone,
      groups: groups.map((g) => ({
        url: g.url,
        username: g.username,
        chatId: g.chatId,
        title: g.title,
        chatType: g.chatType,
      })),
      reason,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function addToLeaveQueue(
  accountPhone: string,
  groups: Dialog[],
  reason: string
): Promise<{ added: number; existing: number }> {
  const r = await fetch("/api/leave/queue", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accountPhone,
      groups: groups.map((g) => ({
        url: g.url,
        username: g.username,
        chatId: g.chatId,
        title: g.title,
        chatType: g.chatType,
      })),
      reason,
    }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function fetchLeaveQueueStatus(phone: string): Promise<{
  pending: number; processing: number; done: number; failed: number;
  items: { id: string; title: string | null; status: string; addedAt: string; errorMessage: string | null }[];
}> {
  const r = await fetch(`/api/leave/queue/${encodeURIComponent(phone)}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function triggerAutoCleanup(phone: string) {
  const r = await fetch(`/api/leave/auto-cleanup/${encodeURIComponent(phone)}`, { method: "POST" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function rejoinUrls(urls: string[]) {
  const r = await fetch("/api/leave/rejoin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ urls }),
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// ─── Classification badge ─────────────────────────────────────────────────────

function ClassificationBadge({ cls }: { cls: Dialog["classification"] }) {
  if (cls === "medical") {
    return (
      <Badge className="text-[10px] py-0 gap-1 bg-emerald-500/15 text-emerald-400 border-emerald-500/30 border">
        <Stethoscope className="w-2.5 h-2.5" />
        طبي
      </Badge>
    );
  }
  if (cls === "non_medical") {
    return (
      <Badge className="text-[10px] py-0 gap-1 bg-red-500/15 text-red-400 border-red-500/30 border">
        <XCircle className="w-2.5 h-2.5" />
        غير طبي
      </Badge>
    );
  }
  return (
    <Badge className="text-[10px] py-0 gap-1 bg-yellow-500/10 text-yellow-500/80 border-yellow-500/20 border">
      <HelpCircle className="w-2.5 h-2.5" />
      غير محدد
    </Badge>
  );
}

// ─── Leave results panel ──────────────────────────────────────────────────────

function LeaveResultsPanel({
  results,
  onDismiss,
}: {
  results: { success: number; failed: number; results: LeaveResultItem[] };
  onDismiss: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const failedItems = results.results.filter((r) => !r.ok);

  return (
    <Card className="border-card-border bg-card/60">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" />
              نجح: {results.success}
            </span>
            <span className={results.failed > 0 ? "text-red-400 flex items-center gap-1" : "text-muted-foreground"}>
              <XCircle className="w-4 h-4" />
              فشل: {results.failed}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {failedItems.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs font-mono h-6 px-2"
                onClick={() => setShowDetails(!showDetails)}
              >
                {showDetails ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                تفاصيل الأخطاء
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-xs font-mono h-6 px-2" onClick={onDismiss}>
              إغلاق ✕
            </Button>
          </div>
        </div>

        {showDetails && failedItems.length > 0 && (
          <div className="space-y-1 border-t border-card-border pt-2 max-h-40 overflow-y-auto">
            {failedItems.map((item, i) => (
              <div key={i} className="text-xs font-mono flex items-start gap-2 text-red-400/80">
                <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span className="text-primary/70 truncate flex-1">{item.title || item.url}</span>
                <span className="text-red-400/60 truncate max-w-[200px]" title={item.error}>
                  {item.error?.includes("AUTH_KEY_DUPLICATED")
                    ? "جلسة مكررة — أعد المحاولة"
                    : item.error?.includes("No username")
                    ? "لا رابط متاح (مجموعة خاصة)"
                    : item.error?.slice(0, 60)}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Leave Manager Tab ────────────────────────────────────────────────────────

function LeaveManagerTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "non_medical" | "medical" | "uncertain" | "has_url" | "no_url">("all");
  const [sortBy, setSortBy] = useState<"classification" | "title" | "synced">("classification");
  const [leaveResults, setLeaveResults] = useState<{ success: number; failed: number; results: LeaveResultItem[] } | null>(null);

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as any) ?? [];

  const {
    data: dialogs = [],
    isLoading: dialogsLoading,
    refetch: refetchDialogs,
  } = useQuery<Dialog[]>({
    queryKey: ["/api/dialogs", selectedPhone],
    queryFn: () => fetchDialogs(selectedPhone),
    enabled: !!selectedPhone,
  });

  const leaveMutation = useMutation({
    mutationFn: ({ groups, reason }: { groups: Dialog[]; reason: string }) =>
      batchLeave(selectedPhone, groups, reason),
    onSuccess: (data) => {
      setLeaveResults(data);
      if (data.success > 0) {
        toast({
          title: `تمت المغادرة`,
          description: `نجح: ${data.success} | فشل: ${data.failed}`,
        });
      } else {
        toast({
          title: "لم تنجح أي مغادرة",
          description: `فشل: ${data.failed} — انظر تفاصيل الأخطاء أدناه`,
          variant: "destructive",
        });
      }
      setSelected(new Set());
      refetchDialogs();
      qc.invalidateQueries({ queryKey: ["/api/leave/history"] });
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (e: any) => toast({ title: "خطأ في الاتصال", description: e.message, variant: "destructive" }),
  });

  const autoCleanupMutation = useMutation({
    mutationFn: () => triggerAutoCleanup(selectedPhone),
    onSuccess: (data) => {
      toast({
        title: "اكتمل التنظيف التلقائي",
        description: `فُحص: ${data.checked} | غادر: ${data.left} | إعادة تفعيل: ${data.reactivated ? "نعم ✅" : "لا"}`,
      });
      refetchDialogs();
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/leave/history"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const queueMutation = useMutation({
    mutationFn: ({ groups, reason }: { groups: Dialog[]; reason: string }) =>
      addToLeaveQueue(selectedPhone, groups, reason),
    onSuccess: (data) => {
      toast({
        title: `✅ أُضيف للطابور`,
        description: `جديد: ${data.added} | موجود مسبقاً: ${data.existing}`,
      });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["/api/leave/queue", selectedPhone] });
    },
    onError: (e: any) => toast({ title: "خطأ في الطابور", description: e.message, variant: "destructive" }),
  });

  const { data: queueStatus, refetch: refetchQueue } = useQuery({
    queryKey: ["/api/leave/queue", selectedPhone],
    queryFn: () => fetchLeaveQueueStatus(selectedPhone),
    enabled: !!selectedPhone,
    refetchInterval: 10_000,
  });

  // Classification counts
  const counts = useMemo(() => {
    const medical = dialogs.filter((d) => d.classification === "medical").length;
    const non_medical = dialogs.filter((d) => d.classification === "non_medical").length;
    const uncertain = dialogs.filter((d) => d.classification === "uncertain").length;
    return { medical, non_medical, uncertain, total: dialogs.length };
  }, [dialogs]);

  // Filter + sort
  const filtered = useMemo(() => {
    let list = [...dialogs];

    // Filter by mode
    if (filterMode === "non_medical") list = list.filter((d) => d.classification === "non_medical");
    else if (filterMode === "medical") list = list.filter((d) => d.classification === "medical");
    else if (filterMode === "uncertain") list = list.filter((d) => d.classification === "uncertain");
    else if (filterMode === "has_url") list = list.filter((d) => d.url || d.username);
    else if (filterMode === "no_url") list = list.filter((d) => !d.url && !d.username);

    // Search
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter(
        (d) =>
          (d.title ?? "").toLowerCase().includes(q) ||
          (d.url ?? "").toLowerCase().includes(q)
      );
    }

    // Sort
    if (sortBy === "classification") {
      const order = { non_medical: 0, uncertain: 1, medical: 2 };
      list.sort((a, b) => order[a.classification] - order[b.classification]);
    } else if (sortBy === "title") {
      list.sort((a, b) => (a.title ?? "").localeCompare(b.title ?? "", "ar"));
    }

    return list;
  }, [dialogs, filterMode, searchQ, sortBy]);

  const selectedDialogs = filtered.filter((d) => selected.has(d.chatId));

  const toggleAll = () => {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.chatId)));
    }
  };

  // Auto-select all non-medical dialogs
  const autoSelectNonMedical = () => {
    const nonMedical = dialogs.filter((d) => d.classification === "non_medical");
    setSelected(new Set(nonMedical.map((d) => d.chatId)));
    setFilterMode("all");
    setSortBy("classification");
    toast({
      title: `تم تحديد ${nonMedical.length} مجموعة غير طبية`,
      description: "راجع القائمة وأزل أي مجموعة تريد الاحتفاظ بها قبل المغادرة",
    });
  };

  const selectedAccount = accounts.find((a: any) => a.phone === selectedPhone);
  const isChannelsLimit = selectedAccount?.status === "channels_limit";

  return (
    <div className="space-y-4">
      {/* Account selector + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Select
          value={selectedPhone}
          onValueChange={(v) => {
            setSelectedPhone(v);
            setSelected(new Set());
            setLeaveResults(null);
          }}
        >
          <SelectTrigger className="w-64 font-mono text-sm border-card-border bg-card/40">
            <SelectValue placeholder="اختر حساباً..." />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((acc: any) => (
              <SelectItem key={acc.phone} value={acc.phone}>
                <span className="font-mono text-xs">{acc.phone}</span>
                {acc.label && (
                  <span className="mr-2 text-muted-foreground text-xs">({acc.label})</span>
                )}
                {acc.status === "channels_limit" && (
                  <Badge variant="destructive" className="mr-2 text-[10px] py-0">
                    ممتلئ
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedPhone && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchDialogs()}
              className="font-mono gap-2 border-card-border"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              تحديث
            </Button>

            {counts.non_medical > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={autoSelectNonMedical}
                className="font-mono gap-2 border-red-500/40 text-red-400 hover:bg-red-500/10"
              >
                <XCircle className="w-3.5 h-3.5" />
                تحديد غير الطبية ({counts.non_medical})
              </Button>
            )}

            {isChannelsLimit && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => autoCleanupMutation.mutate()}
                disabled={autoCleanupMutation.isPending}
                className="font-mono gap-2 border-orange-500/50 text-orange-400 hover:bg-orange-500/10"
              >
                {autoCleanupMutation.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Zap className="w-3.5 h-3.5" />
                )}
                تنظيف تلقائي
              </Button>
            )}
          </>
        )}

        {selectedDialogs.length > 0 && (
          <div className="mr-auto flex gap-2">
            <Button
              size="sm"
              onClick={() => queueMutation.mutate({ groups: selectedDialogs, reason: "manual" })}
              disabled={queueMutation.isPending}
              className="font-mono gap-2 bg-orange-600 hover:bg-orange-700 text-white"
            >
              {queueMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Clock className="w-3.5 h-3.5" />
              )}
              إضافة للطابور ({selectedDialogs.length})
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => leaveMutation.mutate({ groups: selectedDialogs, reason: "manual" })}
              disabled={leaveMutation.isPending}
              className="font-mono gap-2"
            >
              {leaveMutation.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <LogOut className="w-3.5 h-3.5" />
              )}
              مغادرة فورية ({selectedDialogs.length})
            </Button>
          </div>
        )}
      </div>

      {/* Leave results panel */}
      {leaveResults && (
        <LeaveResultsPanel results={leaveResults} onDismiss={() => setLeaveResults(null)} />
      )}

      {/* Leave Queue status panel */}
      {queueStatus && (queueStatus.pending > 0 || queueStatus.processing > 0 || queueStatus.failed > 0) && (
        <Card className="border-orange-500/30 bg-orange-950/20">
          <CardContent className="p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2 text-xs font-mono text-orange-300">
                <Clock className="w-3.5 h-3.5" />
                <span>طابور المغادرة</span>
                {queueStatus.processing > 0 && (
                  <span className="flex items-center gap-1 text-yellow-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    يعالج {queueStatus.processing}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 text-xs font-mono">
                {queueStatus.pending > 0 && <span className="text-orange-400">⏳ {queueStatus.pending} معلق</span>}
                {queueStatus.failed > 0 && <span className="text-red-400">❌ {queueStatus.failed} فشل</span>}
                <button
                  onClick={() => refetchQueue()}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="تحديث"
                >
                  <RefreshCw className="w-3 h-3" />
                </button>
              </div>
            </div>
            {queueStatus.items.slice(0, 5).map((item) => (
              <div key={item.id} className="text-xs font-mono text-muted-foreground py-0.5 flex items-center gap-2">
                {item.status === "processing" ? (
                  <Loader2 className="w-3 h-3 animate-spin text-yellow-400 flex-shrink-0" />
                ) : item.status === "failed" ? (
                  <XCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
                ) : (
                  <Clock className="w-3 h-3 text-orange-400/60 flex-shrink-0" />
                )}
                <span className="truncate">{item.title ?? item.id}</span>
                {item.errorMessage && <span className="text-red-400/70 truncate">— {item.errorMessage}</span>}
              </div>
            ))}
            {queueStatus.items.length > 5 && (
              <div className="text-xs font-mono text-muted-foreground mt-1">
                … و {queueStatus.items.length - 5} آخرين
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info banner for channels_limit */}
      {isChannelsLimit && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-3 text-xs font-mono text-orange-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              الحساب وصل لحد القنوات (500). استخدم "تحديد غير الطبية" ثم "مغادرة المحددة"،
              أو "تنظيف تلقائي" لإزالة كل غير الطبية تلقائياً وإعادة تفعيل الحساب.
            </span>
          </CardContent>
        </Card>
      )}

      {/* Classification summary */}
      {selectedPhone && !dialogsLoading && dialogs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setFilterMode("all")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${filterMode === "all" ? "border-primary/50 bg-primary/10 text-primary" : "border-card-border text-muted-foreground hover:border-primary/30"}`}
          >
            الكل: {counts.total}
          </button>
          <button
            onClick={() => setFilterMode("non_medical")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${filterMode === "non_medical" ? "border-red-500/50 bg-red-500/10 text-red-400" : "border-card-border text-muted-foreground hover:border-red-500/30"}`}
          >
            🔴 غير طبي: {counts.non_medical}
          </button>
          <button
            onClick={() => setFilterMode("medical")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${filterMode === "medical" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400" : "border-card-border text-muted-foreground hover:border-emerald-500/30"}`}
          >
            🟢 طبي: {counts.medical}
          </button>
          <button
            onClick={() => setFilterMode("uncertain")}
            className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${filterMode === "uncertain" ? "border-yellow-500/50 bg-yellow-500/10 text-yellow-400" : "border-card-border text-muted-foreground hover:border-yellow-500/30"}`}
          >
            🟡 غير محدد: {counts.uncertain}
          </button>
          <div className="mr-auto flex items-center gap-2">
            <span className="text-xs text-muted-foreground font-mono">ترتيب:</span>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="text-xs font-mono bg-card border border-card-border rounded px-2 py-1 text-muted-foreground"
            >
              <option value="classification">غير طبي أولاً</option>
              <option value="title">الاسم</option>
              <option value="synced">تاريخ المزامنة</option>
            </select>
          </div>
        </div>
      )}

      {selectedPhone && (
        <>
          {/* Search */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute right-3 top-2.5 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرابط..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                className="pr-9 font-mono text-sm h-8 border-card-border bg-card/40"
              />
            </div>
            <span className="text-xs font-mono text-muted-foreground">
              {selected.size > 0
                ? `${selected.size} محدد من ${filtered.length}`
                : `${filtered.length} مجموعة`}
            </span>
          </div>

          {/* Dialogs table */}
          <Card className="border-card-border">
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow className="border-card-border hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={filtered.length > 0 && selected.size === filtered.length}
                        onCheckedChange={toggleAll}
                        className="border-muted-foreground"
                      />
                    </TableHead>
                    <TableHead className="font-mono text-xs">TITLE</TableHead>
                    <TableHead className="font-mono text-xs w-20">CLASS</TableHead>
                    <TableHead className="font-mono text-xs">URL</TableHead>
                    <TableHead className="font-mono text-xs">TYPE</TableHead>
                    <TableHead className="font-mono text-xs text-right">SYNCED</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-sm">
                  {dialogsLoading && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!dialogsLoading && filtered.length === 0 && selectedPhone && (
                    <TableRow>
                      <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-xs">
                        {dialogs.length === 0
                          ? "لا توجد مجموعات — قد تحتاج مزامنة الحوارات أولاً"
                          : "لا توجد نتائج بهذا الفلتر"}
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((d) => (
                    <TableRow
                      key={d.chatId}
                      className={`border-card-border cursor-pointer transition-colors ${
                        selected.has(d.chatId)
                          ? "bg-destructive/10 hover:bg-destructive/15"
                          : d.classification === "non_medical"
                          ? "hover:bg-red-500/5"
                          : d.classification === "medical"
                          ? "hover:bg-emerald-500/5"
                          : "hover:bg-muted/30"
                      }`}
                      onClick={() => {
                        const next = new Set(selected);
                        if (next.has(d.chatId)) next.delete(d.chatId);
                        else next.add(d.chatId);
                        setSelected(next);
                      }}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(d.chatId)}
                          onCheckedChange={(v) => {
                            const next = new Set(selected);
                            if (v) next.add(d.chatId);
                            else next.delete(d.chatId);
                            setSelected(next);
                          }}
                          className="border-muted-foreground"
                        />
                      </TableCell>
                      <TableCell
                        className="max-w-[200px] truncate font-medium"
                        title={d.title ?? ""}
                        style={{
                          color: d.classification === "medical"
                            ? "rgba(52,211,153,0.9)"
                            : d.classification === "non_medical"
                            ? "rgba(248,113,113,0.85)"
                            : "rgba(255,255,255,0.7)",
                        }}
                      >
                        {d.title || <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell>
                        <ClassificationBadge cls={d.classification} />
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary/60 hover:text-primary hover:underline text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {d.url.replace("https://t.me/", "@")}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">خاصة — لا رابط</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 border-muted-foreground/30"
                        >
                          {d.chatType ?? "?"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-xs whitespace-nowrap">
                        {d.syncedAt ? format(new Date(d.syncedAt), "MM-dd HH:mm") : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ─── Leave History Tab ────────────────────────────────────────────────────────

function LeaveHistoryTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterPhone, setFilterPhone] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: accountsData } = useListAccounts();
  const accounts = (accountsData as any) ?? [];

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/leave/history", filterPhone],
    queryFn: () => fetchLeaveHistory(filterPhone === "all" ? undefined : filterPhone),
    refetchInterval: 30_000,
  });

  const items: LeftGroup[] = data?.items ?? [];

  const rejoinMutation = useMutation({
    mutationFn: (urls: string[]) => rejoinUrls(urls),
    onSuccess: (data) => {
      toast({
        title: "تمت إعادة الإضافة للطابور",
        description: `أُضيف: ${data.added} | موجود مسبقاً: ${data.skipped}`,
      });
      setSelectedIds(new Set());
      qc.invalidateQueries({ queryKey: ["/api/links"] });
    },
    onError: (e: any) =>
      toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const selectedItems = items.filter((i) => selectedIds.has(i.id));
  const rejoinableItems = selectedItems.filter((i) => !!i.url);

  const toggleAll = () => {
    if (selectedIds.size === items.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(items.map((i) => i.id)));
  };

  const reasonLabel: Record<string, string> = {
    manual: "يدوي",
    auto_cleanup: "تنظيف تلقائي",
    not_relevant: "غير ذي صلة",
    channels_limit: "حد القنوات",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={filterPhone} onValueChange={setFilterPhone}>
          <SelectTrigger className="w-64 font-mono text-sm border-card-border bg-card/40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحسابات</SelectItem>
            {accounts.map((acc: any) => (
              <SelectItem key={acc.phone} value={acc.phone}>
                <span className="font-mono text-xs">{acc.phone}</span>
                {acc.label && (
                  <span className="mr-1 text-muted-foreground text-xs">({acc.label})</span>
                )}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="font-mono gap-2 border-card-border"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          تحديث
        </Button>

        <span className="text-xs font-mono text-muted-foreground">
          {data?.total ?? 0} إجمالي المغادرات
        </span>

        {rejoinableItems.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => rejoinMutation.mutate(rejoinableItems.map((i) => i.url))}
            disabled={rejoinMutation.isPending}
            className="font-mono gap-2 mr-auto border-primary/40 text-primary hover:bg-primary/10"
          >
            {rejoinMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RotateCcw className="w-3.5 h-3.5" />
            )}
            إعادة الانضمام ({rejoinableItems.length})
          </Button>
        )}
      </div>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    checked={items.length > 0 && selectedIds.size === items.length}
                    onCheckedChange={toggleAll}
                    className="border-muted-foreground"
                  />
                </TableHead>
                <TableHead className="font-mono text-xs">TITLE</TableHead>
                <TableHead className="font-mono text-xs">URL</TableHead>
                <TableHead className="font-mono text-xs">ACCOUNT</TableHead>
                <TableHead className="font-mono text-xs">REASON</TableHead>
                <TableHead className="font-mono text-xs text-right">LEFT_AT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground text-xs">
                    لا توجد مغادرات مسجلة بعد
                  </TableCell>
                </TableRow>
              )}
              {items.map((item) => (
                <TableRow
                  key={item.id}
                  className={`border-card-border cursor-pointer ${
                    selectedIds.has(item.id) ? "bg-primary/5" : "hover:bg-muted/30"
                  }`}
                  onClick={() => {
                    const next = new Set(selectedIds);
                    if (next.has(item.id)) next.delete(item.id);
                    else next.add(item.id);
                    setSelectedIds(next);
                  }}
                >
                  <TableCell onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      checked={selectedIds.has(item.id)}
                      onCheckedChange={(v) => {
                        const next = new Set(selectedIds);
                        if (v) next.add(item.id);
                        else next.delete(item.id);
                        setSelectedIds(next);
                      }}
                      className="border-muted-foreground"
                    />
                  </TableCell>
                  <TableCell
                    className="max-w-[180px] truncate text-primary/90"
                    title={item.title ?? ""}
                  >
                    {item.title || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="max-w-[220px] truncate">
                    {item.url ? (
                      <a
                        href={item.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary/70 hover:text-primary hover:underline text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {item.url.replace("https://t.me/", "@")}
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">لا رابط</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.accountPhone}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={item.reason === "auto_cleanup" ? "secondary" : "outline"}
                      className="text-[10px] py-0"
                    >
                      {reasonLabel[item.reason] ?? item.reason}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground text-xs whitespace-nowrap">
                    {format(new Date(item.leftAt), "yyyy-MM-dd HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedIds.size > 0 && rejoinableItems.length < selectedIds.size && (
        <p className="text-xs text-muted-foreground font-mono">
          ⚠️ {selectedIds.size - rejoinableItems.length} من المحددة ليس لها روابط قابلة للإعادة
        </p>
      )}
    </div>
  );
}

// ─── Channel Links Tab ────────────────────────────────────────────────────────

function ChannelLinksTab() {
  const { data: channels, isLoading } = useQuery<ChannelLink[]>({
    queryKey: ["/api/channels"],
    queryFn: async () => {
      const r = await fetch("/api/channels");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 15000,
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">
            {channels?.length ?? 0} قناة مكتشفة
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.open("/api/channels/export", "_blank")}
            disabled={!channels?.length}
            className="font-mono gap-2 border-primary text-primary hover:bg-primary/10"
          >
            <Download className="w-3.5 h-3.5" />
            تصدير .txt
          </Button>
        </div>
      </div>

      <Card className="border-card-border bg-card/40 text-sm font-mono text-muted-foreground px-4 py-3 rounded-lg">
        <p>📡 هذه القنوات اكتُشفت أثناء عملية الانضمام — التطبيق يحفظ روابطها هنا فقط ولا ينضم لها تلقائياً.</p>
      </Card>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono text-xs">#</TableHead>
                <TableHead className="font-mono text-xs">TITLE</TableHead>
                <TableHead className="font-mono text-xs">URL</TableHead>
                <TableHead className="font-mono text-xs text-right">DETECTED_AT</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                    <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                  </TableCell>
                </TableRow>
              )}
              {channels?.map((ch, i) => (
                <TableRow key={ch.id} className="border-card-border">
                  <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                  <TableCell
                    className="text-primary font-medium max-w-[200px] truncate"
                    title={ch.title ?? ""}
                  >
                    {ch.title || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary/80 hover:text-primary hover:underline"
                    >
                      {ch.url}
                    </a>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground whitespace-nowrap">
                    {format(new Date(ch.detectedAt), "yyyy-MM-dd HH:mm")}
                  </TableCell>
                </TableRow>
              ))}
              {!isLoading && channels?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground text-xs">
                    NO_CHANNELS_YET — ستظهر القنوات هنا تلقائياً أثناء عمل البوت
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

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Channels() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" />
          CHANNELS_&amp;_LEAVE
        </h1>
      </div>

      <Tabs defaultValue="leave" className="w-full">
        <TabsList className="bg-card/40 border border-card-border mb-4">
          <TabsTrigger
            value="leave"
            className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" />
            إدارة المغادرة
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            سجل المغادرة
          </TabsTrigger>
          <TabsTrigger
            value="channels"
            className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5"
          >
            <Radio className="w-3.5 h-3.5" />
            القنوات المكتشفة
          </TabsTrigger>
        </TabsList>

        <TabsContent value="leave">
          <LeaveManagerTab />
        </TabsContent>
        <TabsContent value="history">
          <LeaveHistoryTab />
        </TabsContent>
        <TabsContent value="channels">
          <ChannelLinksTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
