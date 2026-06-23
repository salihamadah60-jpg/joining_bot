import { useState } from "react";
import { useListLinks } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScanSearch, CheckCircle2, XCircle, ExternalLink, BookOpen, CheckSquare, Square } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

export default function Review() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: links, isLoading } = useListLinks({ status: "pending_review" as any });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/links/${id}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("فشل القبول");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/links/stats"] });
    },
    onError: () => toast({ title: "خطأ", variant: "destructive" }),
  });

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/links/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error("فشل الرفض");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/links/stats"] });
    },
    onError: () => toast({ title: "خطأ", variant: "destructive" }),
  });

  const handleApprove = async (id: string) => {
    setProcessingId(id);
    await approve.mutateAsync(id).finally(() => setProcessingId(null));
    toast({ title: "✅ تم القبول", description: "تم تأكيد الرابط كمجموعة مناسبة" });
  };

  const handleReject = async (id: string) => {
    setProcessingId(id);
    await reject.mutateAsync(id).finally(() => setProcessingId(null));
    toast({ title: "⛔ تم الرفض", description: "تم رفض الرابط وسيتجنب البوت المشابه" });
  };

  const handleBulkApprove = async () => {
    if (selected.size === 0) return;
    setBulkProcessing(true);
    try {
      const res = await fetch("/api/links/bulk-approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/links/stats"] });
      setSelected(new Set());
      toast({ title: `✅ قُبل ${data.approved} مجموعة`, description: "تم قبول المحدد وسيتعلم البوت منه" });
    } catch {
      toast({ title: "خطأ في القبول الجماعي", variant: "destructive" });
    } finally {
      setBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selected.size === 0) return;
    setBulkProcessing(true);
    try {
      const res = await fetch("/api/links/bulk-reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      queryClient.invalidateQueries({ queryKey: ["/api/links/stats"] });
      setSelected(new Set());
      toast({ title: `⛔ رُفض ${data.rejected} مجموعة`, description: "تم رفض المحدد وسيتجنب البوت المشابه" });
    } catch {
      toast({ title: "خطأ في الرفض الجماعي", variant: "destructive" });
    } finally {
      setBulkProcessing(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allIds = links?.map((l) => l.id) ?? [];
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allIds));
    }
  };

  const pendingCount = links?.length ?? 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <ScanSearch className="w-6 h-6 text-orange-400" />
          PENDING_REVIEW
          {pendingCount > 0 && (
            <span className="bg-orange-500/20 text-orange-400 border border-orange-500/30 text-sm font-mono px-2 py-0.5 rounded-md">
              {pendingCount} تحتاج مراجعة
            </span>
          )}
        </h1>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-3 bg-orange-500/10 border border-orange-500/20 rounded-lg p-4">
        <BookOpen className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
        <div className="text-sm text-muted-foreground leading-relaxed">
          <span className="text-orange-400 font-medium">مجموعات غير محددة التصنيف</span> — لم يتمكن البوت من التحقق من طبيعتها تلقائياً.
          قرارك هنا سيُعلّم البوت: في المرات القادمة ستُصنّف المجموعات المشابهة تلقائياً بدون سؤالك.
          <br />
          <span className="text-xs text-muted-foreground/70">حدِّد عدة مجموعات دفعة واحدة ثم اقبل أو ارفض المحدد.</span>
        </div>
      </div>

      {/* Bulk action bar — shown when items are selected */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-lg px-4 py-2.5">
          <span className="text-sm font-mono text-primary font-medium">
            {selected.size} محدد
          </span>
          <div className="flex gap-2 mr-auto">
            <Button
              size="sm"
              onClick={handleBulkApprove}
              disabled={bulkProcessing}
              className="h-8 px-4 text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20"
              variant="outline"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1.5" />
              قبول الكل ({selected.size})
            </Button>
            <Button
              size="sm"
              onClick={handleBulkReject}
              disabled={bulkProcessing}
              className="h-8 px-4 text-xs font-mono border-destructive/30 text-destructive hover:bg-destructive/10"
              variant="outline"
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" />
              رفض الكل ({selected.size})
            </Button>
            <Button
              size="sm"
              onClick={() => setSelected(new Set())}
              disabled={bulkProcessing}
              className="h-8 px-3 text-xs font-mono"
              variant="ghost"
            >
              إلغاء
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono">جاري التحميل...</div>
      ) : pendingCount === 0 ? (
        <Card className="border-card-border">
          <CardContent className="py-16 text-center">
            <CheckCircle2 className="w-10 h-10 text-primary mx-auto mb-3" />
            <p className="text-muted-foreground font-mono">لا توجد مجموعات تنتظر المراجعة</p>
            <p className="text-xs text-muted-foreground/60 mt-1">
              ستظهر هنا المجموعات التي لم يستطع البوت تصنيفها تلقائياً
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-card-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="border-card-border hover:bg-transparent">
                  {/* Select-all checkbox */}
                  <TableHead className="w-10 text-center">
                    <button
                      onClick={toggleAll}
                      className="text-muted-foreground hover:text-foreground transition-colors"
                      title={allSelected ? "إلغاء تحديد الكل" : "تحديد الكل"}
                    >
                      {allSelected
                        ? <CheckSquare className="w-4 h-4 text-primary" />
                        : <Square className="w-4 h-4" />
                      }
                    </button>
                  </TableHead>
                  <TableHead className="font-mono">المجموعة / الرابط</TableHead>
                  <TableHead className="font-mono">النوع</TableHead>
                  <TableHead className="font-mono">الحساب</TableHead>
                  <TableHead className="font-mono">وقت الانضمام</TableHead>
                  <TableHead className="font-mono text-center">القرار</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="font-mono text-sm">
                {links?.map((link) => (
                  <TableRow
                    key={link.id}
                    className={`border-card-border cursor-pointer transition-colors ${
                      selected.has(link.id) ? "bg-primary/5" : "hover:bg-muted/30"
                    }`}
                    onClick={() => toggleSelect(link.id)}
                  >
                    {/* Row checkbox */}
                    <TableCell className="text-center w-10" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleSelect(link.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors"
                      >
                        {selected.has(link.id)
                          ? <CheckSquare className="w-4 h-4 text-primary" />
                          : <Square className="w-4 h-4" />
                        }
                      </button>
                    </TableCell>

                    {/* Group info */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex flex-col gap-1">
                        {link.groupTitle ? (
                          <span className="font-medium text-foreground">{link.groupTitle}</span>
                        ) : (
                          <span className="text-muted-foreground italic text-xs">بدون اسم</span>
                        )}
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary/70 hover:text-primary flex items-center gap-1 truncate max-w-[240px]"
                        >
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                          {link.url}
                        </a>
                      </div>
                    </TableCell>

                    {/* Type */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      {link.groupType ? (
                        <Badge variant="outline" className={`text-xs ${
                          link.groupType === "channel"
                            ? "border-blue-500 text-blue-500"
                            : link.groupType === "group"
                            ? "border-primary text-primary"
                            : "border-border text-muted-foreground"
                        }`}>
                          {link.groupType === "channel" ? "📡 CHANNEL" : link.groupType === "group" ? "👥 GROUP" : "UNKNOWN"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">—</span>
                      )}
                    </TableCell>

                    {/* Account */}
                    <TableCell className="text-muted-foreground text-xs" onClick={(e) => e.stopPropagation()}>
                      {link.usedByAccountPhone ?? "—"}
                    </TableCell>

                    {/* Time */}
                    <TableCell className="text-muted-foreground text-xs" onClick={(e) => e.stopPropagation()}>
                      {link.processedAt ? format(new Date(link.processedAt), "MM-dd HH:mm") : "—"}
                    </TableCell>

                    {/* Decision buttons */}
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-2">
                        <Button
                          size="sm"
                          onClick={() => handleApprove(link.id)}
                          disabled={processingId === link.id || bulkProcessing}
                          className="h-7 px-3 text-xs font-mono bg-primary/10 text-primary border border-primary/30 hover:bg-primary/20 hover:text-primary"
                          variant="outline"
                          title="مناسب — ابق في المجموعة وتعلّم"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                          مناسب
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleReject(link.id)}
                          disabled={processingId === link.id || bulkProcessing}
                          className="h-7 px-3 text-xs font-mono border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          variant="outline"
                          title="غير مناسب — رفض وتجنّب المشابه"
                        >
                          <XCircle className="w-3.5 h-3.5 mr-1" />
                          رفض
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
