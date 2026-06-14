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
import { Radio, Download, LogOut, History, RefreshCw, RotateCcw, Loader2, AlertTriangle, CheckCircle2, Search, Zap } from "lucide-react";
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

async function batchLeave(accountPhone: string, groups: Dialog[], reason: string) {
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

// ─── Leave Manager Tab ────────────────────────────────────────────────────────

function LeaveManagerTab() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedPhone, setSelectedPhone] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [searchQ, setSearchQ] = useState("");
  const [filterMode, setFilterMode] = useState<"all" | "has_url" | "no_url">("all");

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
      toast({
        title: `تمت المغادرة`,
        description: `نجح: ${data.success} | فشل: ${data.failed}`,
      });
      setSelected(new Set());
      refetchDialogs();
      qc.invalidateQueries({ queryKey: ["/api/leave/history"] });
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const autoCleanupMutation = useMutation({
    mutationFn: () => triggerAutoCleanup(selectedPhone),
    onSuccess: (data) => {
      toast({
        title: "اكتمل التنظيف التلقائي",
        description: `فُحص: ${data.checked} | غادر: ${data.left} | إعادة تفعيل: ${data.reactivated ? "نعم" : "لا"}`,
      });
      refetchDialogs();
      qc.invalidateQueries({ queryKey: ["/api/accounts"] });
      qc.invalidateQueries({ queryKey: ["/api/leave/history"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    let list = dialogs;
    if (filterMode === "has_url") list = list.filter((d) => d.url || d.username);
    if (filterMode === "no_url") list = list.filter((d) => !d.url && !d.username);
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter((d) => (d.title ?? "").toLowerCase().includes(q) || (d.url ?? "").toLowerCase().includes(q));
    }
    return list;
  }, [dialogs, filterMode, searchQ]);

  const selectedDialogs = filtered.filter((d) => selected.has(d.chatId));

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((d) => d.chatId)));
    }
  };

  const selectedAccount = accounts.find((a: any) => a.phone === selectedPhone);
  const isChannelsLimit = selectedAccount?.status === "channels_limit";

  return (
    <div className="space-y-4">
      {/* Account selector + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={selectedPhone} onValueChange={(v) => { setSelectedPhone(v); setSelected(new Set()); }}>
          <SelectTrigger className="w-64 font-mono text-sm border-card-border bg-card/40">
            <SelectValue placeholder="اختر حساباً..." />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((acc: any) => (
              <SelectItem key={acc.phone} value={acc.phone}>
                <span className="font-mono text-xs">{acc.phone}</span>
                {acc.label && <span className="mr-2 text-muted-foreground text-xs">({acc.label})</span>}
                {acc.status === "channels_limit" && (
                  <Badge variant="destructive" className="mr-2 text-[10px] py-0">ممتلئ</Badge>
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
                تنظيف تلقائي (إزالة غير الطبية)
              </Button>
            )}
          </>
        )}

        {selectedDialogs.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => leaveMutation.mutate({ groups: selectedDialogs, reason: "manual" })}
            disabled={leaveMutation.isPending}
            className="font-mono gap-2 mr-auto"
          >
            {leaveMutation.isPending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <LogOut className="w-3.5 h-3.5" />
            )}
            مغادرة المحددة ({selectedDialogs.length})
          </Button>
        )}
      </div>

      {/* Info banner for channels_limit */}
      {isChannelsLimit && (
        <Card className="border-orange-500/30 bg-orange-500/5">
          <CardContent className="p-3 text-xs font-mono text-orange-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              الحساب وصل لحد القنوات (500). استخدم "تنظيف تلقائي" لإزالة المجموعات غير الطبية وإعادة تفعيله،
              أو حدد مجموعات يدوياً وغادرها.
            </span>
          </CardContent>
        </Card>
      )}

      {selectedPhone && (
        <>
          {/* Filters */}
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
            <Select value={filterMode} onValueChange={(v: any) => setFilterMode(v)}>
              <SelectTrigger className="w-36 font-mono text-xs h-8 border-card-border bg-card/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل ({dialogs.length})</SelectItem>
                <SelectItem value="has_url">لديها رابط</SelectItem>
                <SelectItem value="no_url">بدون رابط</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs font-mono text-muted-foreground">
              {selected.size > 0 ? `${selected.size} محدد` : `${filtered.length} مجموعة`}
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
                    <TableHead className="font-mono text-xs">URL</TableHead>
                    <TableHead className="font-mono text-xs">TYPE</TableHead>
                    <TableHead className="font-mono text-xs text-right">SYNCED</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-sm">
                  {dialogsLoading && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                        <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                      </TableCell>
                    </TableRow>
                  )}
                  {!dialogsLoading && !selectedPhone && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-xs">
                        اختر حساباً لعرض مجموعاته
                      </TableCell>
                    </TableRow>
                  )}
                  {!dialogsLoading && filtered.length === 0 && selectedPhone && (
                    <TableRow>
                      <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-xs">
                        لا توجد مجموعات — قد تحتاج مزامنة الحوارات أولاً
                      </TableCell>
                    </TableRow>
                  )}
                  {filtered.map((d) => (
                    <TableRow
                      key={d.chatId}
                      className={`border-card-border cursor-pointer ${selected.has(d.chatId) ? "bg-destructive/10" : "hover:bg-muted/30"}`}
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
                            if (v) next.add(d.chatId); else next.delete(d.chatId);
                            setSelected(next);
                          }}
                          className="border-muted-foreground"
                        />
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-primary/90 font-medium" title={d.title ?? ""}>
                        {d.title || <span className="text-muted-foreground italic">—</span>}
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate">
                        {d.url ? (
                          <a
                            href={d.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary/70 hover:text-primary hover:underline text-xs"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {d.url}
                          </a>
                        ) : (
                          <span className="text-muted-foreground text-xs italic">خاصة — لا رابط</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] py-0 border-muted-foreground/30">
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
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
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
                {acc.label && <span className="mr-1 text-muted-foreground text-xs">({acc.label})</span>}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Button variant="outline" size="sm" onClick={() => refetch()} className="font-mono gap-2 border-card-border">
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
                  className={`border-card-border cursor-pointer ${selectedIds.has(item.id) ? "bg-primary/5" : "hover:bg-muted/30"}`}
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
                        if (v) next.add(item.id); else next.delete(item.id);
                        setSelectedIds(next);
                      }}
                      className="border-muted-foreground"
                    />
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-primary/90" title={item.title ?? ""}>
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
                        {item.url}
                      </a>
                    ) : (
                      <span className="text-muted-foreground text-xs italic">لا رابط</span>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{item.accountPhone}</TableCell>
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
                  <TableCell className="text-primary font-medium max-w-[200px] truncate" title={ch.title ?? ""}>
                    {ch.title || <span className="text-muted-foreground italic">—</span>}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">
                    <a href={ch.url} target="_blank" rel="noopener noreferrer"
                      className="text-primary/80 hover:text-primary hover:underline">
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
          <TabsTrigger value="leave" className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5">
            <LogOut className="w-3.5 h-3.5" />
            إدارة المغادرة
          </TabsTrigger>
          <TabsTrigger value="history" className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5">
            <History className="w-3.5 h-3.5" />
            سجل المغادرة
          </TabsTrigger>
          <TabsTrigger value="channels" className="font-mono text-xs data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1.5">
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
