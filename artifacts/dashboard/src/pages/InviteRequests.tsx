import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Clock, CheckCircle2, XCircle, RefreshCw, MailCheck, ExternalLink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { ar } from "date-fns/locale";

interface InviteRequest {
  id: string;
  url: string;
  accountPhone: string;
  status: "pending" | "approved" | "expired";
  groupTitle: string | null;
  sentAt: string | null;
  approvedAt: string | null;
  updatedAt: string | null;
}

interface Stats {
  pending: number;
  approved: number;
  expired: number;
  total: number;
}

function StatusBadge({ status }: { status: InviteRequest["status"] }) {
  switch (status) {
    case "pending":
      return (
        <Badge variant="outline" className="border-yellow-500 text-yellow-400 font-mono text-xs gap-1 animate-pulse">
          <Clock className="w-3 h-3" />
          في انتظار القبول
        </Badge>
      );
    case "approved":
      return (
        <Badge className="bg-primary/20 text-primary border border-primary/30 font-mono text-xs gap-1">
          <CheckCircle2 className="w-3 h-3" />
          تم القبول
        </Badge>
      );
    case "expired":
      return (
        <Badge variant="destructive" className="font-mono text-xs gap-1">
          <XCircle className="w-3 h-3" />
          منتهي الصلاحية
        </Badge>
      );
  }
}

export default function InviteRequests() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<string>("all");

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/invite-requests/stats"],
    queryFn: () => fetch("/api/invite-requests/stats").then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const { data: requests = [], isLoading } = useQuery<InviteRequest[]>({
    queryKey: ["/api/invite-requests", filter],
    queryFn: () => {
      const url = filter === "all"
        ? "/api/invite-requests"
        : `/api/invite-requests?status=${filter}`;
      return fetch(url).then((r) => r.json());
    },
    refetchInterval: 30_000,
  });

  const checkMutation = useMutation({
    mutationFn: () => fetch("/api/invite-requests/check", { method: "POST" }).then((r) => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invite-requests"] });
      queryClient.invalidateQueries({ queryKey: ["/api/invite-requests/stats"] });
      toast({
        title: "✅ تم الفحص",
        description: `فحص ${data.checked} طلب — قُبِل ${data.approved} — انتهت صلاحية ${data.expired}`,
      });
    },
    onError: () => toast({ title: "خطأ في الفحص", variant: "destructive" }),
  });

  const pendingCount = stats?.pending ?? 0;
  const approvedCount = stats?.approved ?? 0;
  const expiredCount = stats?.expired ?? 0;
  const totalCount = stats?.total ?? 0;

  return (
    <div className="space-y-6 font-mono" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
            <MailCheck className="w-5 h-5 text-yellow-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">طلبات الانضمام</h1>
            <p className="text-xs text-muted-foreground">المجموعات التي تطلب موافقة المشرف</p>
          </div>
        </div>
        <Button
          onClick={() => checkMutation.mutate()}
          disabled={checkMutation.isPending}
          variant="outline"
          size="sm"
          className="gap-2 font-mono text-xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${checkMutation.isPending ? "animate-spin" : ""}`} />
          فحص الحالة الآن
        </Button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-yellow-500/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-yellow-400">{pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-1">في انتظار القبول</p>
        </div>
        <div className="bg-card border border-primary/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-primary">{approvedCount}</p>
          <p className="text-xs text-muted-foreground mt-1">تم القبول</p>
        </div>
        <div className="bg-card border border-destructive/30 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-destructive">{expiredCount}</p>
          <p className="text-xs text-muted-foreground mt-1">منتهية الصلاحية</p>
        </div>
      </div>

      {/* Explanation card when pending > 0 */}
      {pendingCount > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4 flex items-start gap-3">
          <Clock className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-yellow-400/90 space-y-1">
            <p className="font-semibold">
              {pendingCount} طلب في انتظار موافقة مشرفي المجموعات
            </p>
            <p className="text-yellow-400/70">
              البوت يفحص الحالة كل 10 دقائق تلقائياً. يمكنك الضغط على "فحص الحالة الآن" لإجراء فحص فوري.
              عند القبول، ستُحدَّث الحالة إلى "تم القبول" وتُضاف المجموعة إلى قاعدة البيانات.
            </p>
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {[
          { key: "all", label: `الكل (${totalCount})` },
          { key: "pending", label: `انتظار (${pendingCount})` },
          { key: "approved", label: `مقبول (${approvedCount})` },
          { key: "expired", label: `منتهي (${expiredCount})` },
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              filter === key
                ? "bg-primary/20 text-primary border-primary/30"
                : "bg-muted/30 text-muted-foreground border-border hover:bg-muted/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono text-xs">الرابط</TableHead>
                <TableHead className="font-mono text-xs">الحساب</TableHead>
                <TableHead className="font-mono text-xs">الحالة</TableHead>
                <TableHead className="font-mono text-xs">تاريخ الإرسال</TableHead>
                <TableHead className="font-mono text-xs">تاريخ القبول</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-sm">
                    جاري التحميل...
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && requests.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground text-sm">
                    لا توجد طلبات {filter !== "all" ? `بحالة "${filter}"` : ""}
                  </TableCell>
                </TableRow>
              )}
              {requests.map((req) => (
                <TableRow key={req.id} className="border-card-border">
                  <TableCell className="max-w-xs">
                    <div className="flex items-center gap-1.5">
                      <a
                        href={req.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-primary hover:underline text-xs font-mono truncate max-w-[220px] block"
                        title={req.url}
                      >
                        {req.groupTitle ?? req.url}
                      </a>
                      <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                    </div>
                    {req.groupTitle && (
                      <p className="text-xs text-muted-foreground font-mono truncate max-w-[220px]">{req.url}</p>
                    )}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground font-mono">
                    {req.accountPhone}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={req.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {req.sentAt
                      ? formatDistanceToNow(new Date(req.sentAt), { addSuffix: true, locale: ar })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {req.approvedAt
                      ? formatDistanceToNow(new Date(req.approvedAt), { addSuffix: true, locale: ar })
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
