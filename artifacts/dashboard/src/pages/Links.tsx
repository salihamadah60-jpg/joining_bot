import { useState, useMemo } from "react";
import { useListLinks, useBulkAddLinks, useDeleteLink } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Link as LinkIcon, Plus, Trash2, Filter, RotateCcw, CheckCircle2, Search, X, Eraser } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { useMutation } from "@tanstack/react-query";
import type { AlreadyJoinedEntry } from "@workspace/api-client-react";

export default function Links() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [searchText, setSearchText] = useState("");

  const { data: links } = useListLinks({
    status: statusFilter !== "all" ? (statusFilter as any) : undefined,
  });

  const deleteLink = useDeleteLink();
  const bulkAddLinks = useBulkAddLinks();

  const [isBulkOpen, setIsBulkOpen] = useState(false);
  const [bulkUrls, setBulkUrls] = useState("");
  const [joinedFeedback, setJoinedFeedback] = useState<AlreadyJoinedEntry[]>([]);
  const [isJoinedDialogOpen, setIsJoinedDialogOpen] = useState(false);
  const [isClearOpen, setIsClearOpen] = useState(false);

  const clearQueue = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/links/clear-queue", { method: "POST" });
      if (!res.ok) throw new Error("فشل تصفير الطابور");
      return res.json() as Promise<{ ok: boolean; cleared: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      setIsClearOpen(false);
      toast({
        title: "🗑️ تم تصفير الطابور",
        description: `حُذف ${data.cleared.toLocaleString()} رابط — وصُفِّرت عدادات الانضمام اليومية لجميع الحسابات`,
      });
    },
    onError: () => toast({ title: "خطأ", description: "فشل تصفير الطابور", variant: "destructive" }),
  });

  // Unique sources from data for the source filter dropdown
  const uniqueSources = useMemo(() => {
    if (!links) return [];
    const sources = new Set(links.map((l) => l.source || "MANUAL"));
    return Array.from(sources).sort();
  }, [links]);

  // Client-side filtering: source + search text
  const filteredLinks = useMemo(() => {
    if (!links) return [];
    return links.filter((link) => {
      const linkSource = link.source || "MANUAL";
      const matchesSource = sourceFilter === "all" || linkSource === sourceFilter;
      const matchesSearch =
        !searchText.trim() ||
        link.url.toLowerCase().includes(searchText.toLowerCase());
      return matchesSource && matchesSearch;
    });
  }, [links, sourceFilter, searchText]);

  const handleBulkAdd = () => {
    if (!bulkUrls.trim()) return;
    bulkAddLinks.mutate(
      { data: { urls: [bulkUrls] } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: ["/api/links"] });
          setIsBulkOpen(false);
          setBulkUrls("");
          const extracted = (data as any).extracted ?? data.total ?? 0;
          const alreadyJoined = data.alreadyJoined ?? 0;
          const alreadyJoinedUrls: AlreadyJoinedEntry[] =
            (data.alreadyJoinedUrls as AlreadyJoinedEntry[] | undefined) ?? [];
          let description = `${extracted} رابط استُخرج — ${data.added} جديد — ${data.duplicates ?? 0} مكرر`;
          if (alreadyJoined > 0) description += ` — ${alreadyJoined} تم الانضمام سابقاً`;
          toast({ title: "✅ تمت المعالجة", description });
          if (alreadyJoinedUrls.length > 0) {
            setJoinedFeedback(alreadyJoinedUrls);
            setIsJoinedDialogOpen(true);
          }
        },
        onError: () => {
          toast({ title: "خطأ", description: "فشل إضافة الروابط", variant: "destructive" });
        },
      }
    );
  };

  const retryLink = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/links/${id}/retry`, { method: "POST" });
      if (!res.ok) throw new Error("فشلت إعادة المحاولة");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/links"] });
      toast({ title: "✅ تمت إعادة الجدولة", description: "سيُعاد محاولة الرابط في أقرب وقت" });
    },
    onError: () => {
      toast({ title: "خطأ", description: "فشلت إعادة المحاولة", variant: "destructive" });
    },
  });

  const handleDelete = (id: string) => {
    deleteLink.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/links"] });
          toast({ title: "تم الحذف" });
        },
      }
    );
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "pending":
        return <Badge variant="outline" className="border-yellow-500 text-yellow-500">PENDING</Badge>;
      case "joined":
        return <Badge className="bg-primary text-primary-foreground">JOINED</Badge>;
      case "failed":
        return <Badge variant="destructive">FAILED</Badge>;
      case "skipped":
        return <Badge variant="secondary">SKIPPED</Badge>;
      default:
        return <Badge variant="outline">{status.toUpperCase()}</Badge>;
    }
  };

  const hasActiveFilter = statusFilter !== "all" || sourceFilter !== "all" || searchText.trim() !== "";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <LinkIcon className="w-6 h-6 text-primary" />
          TARGET_LINKS
          {filteredLinks.length !== (links?.length ?? 0) && (
            <span className="text-sm font-normal text-muted-foreground">
              ({filteredLinks.length.toLocaleString()} / {(links?.length ?? 0).toLocaleString()})
            </span>
          )}
          {links && links.length > 0 && filteredLinks.length === links.length && (
            <span className="text-sm font-normal text-muted-foreground">
              ({links.length.toLocaleString()})
            </span>
          )}
        </h1>

        <div className="flex items-center gap-2">
          {/* Clear queue button */}
          <Dialog open={isClearOpen} onOpenChange={setIsClearOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" className="font-mono border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive">
                <Eraser className="w-4 h-4 mr-2" /> CLEAR_QUEUE
              </Button>
            </DialogTrigger>
            <DialogContent className="border-card-border bg-card max-w-md">
              <DialogHeader>
                <DialogTitle className="font-mono text-destructive flex items-center gap-2">
                  <Eraser className="w-5 h-5" /> تصفير الطابور
                </DialogTitle>
              </DialogHeader>
              <div className="py-3 space-y-3 text-sm text-muted-foreground">
                <p>سيتم حذف جميع الروابط بحالة <span className="text-yellow-400 font-mono">pending</span> و<span className="text-red-400 font-mono">failed</span> و<span className="text-muted-foreground font-mono">skipped</span> من الطابور.</p>
                <p>سيتم أيضاً تصفير عدادات الانضمام اليومية لجميع الحسابات.</p>
                <p className="text-orange-400 font-medium">⚠️ هذه العملية لا يمكن التراجع عنها.</p>
              </div>
              <DialogFooter className="gap-2">
                <Button variant="ghost" onClick={() => setIsClearOpen(false)} className="font-mono">إلغاء</Button>
                <Button
                  variant="destructive"
                  onClick={() => clearQueue.mutate()}
                  disabled={clearQueue.isPending}
                  className="font-mono"
                >
                  {clearQueue.isPending ? "جاري التصفير..." : "تأكيد التصفير"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Bulk add button */}
          <Dialog open={isBulkOpen} onOpenChange={setIsBulkOpen}>
            <DialogTrigger asChild>
              <Button className="font-mono">
                <Plus className="w-4 h-4 mr-2" /> BULK_ADD_LINKS
              </Button>
            </DialogTrigger>
          <DialogContent className="border-card-border bg-card max-w-2xl">
            <DialogHeader>
              <DialogTitle className="font-mono">PASTE_TARGET_LINKS</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <Textarea
                value={bulkUrls}
                onChange={(e) => setBulkUrls(e.target.value)}
                placeholder={"https://t.me/group1\nhttps://t.me/group2"}
                className="bg-background border-input min-h-[200px] font-mono text-sm"
              />
            </div>
            <DialogFooter>
              <Button
                onClick={handleBulkAdd}
                disabled={!bulkUrls || bulkAddLinks.isPending}
                className="font-mono w-full"
              >
                INJECT_TARGETS
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="w-4 h-4 text-muted-foreground flex-shrink-0" />

        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="بحث في الروابط..."
            className="pr-8 h-8 text-xs font-mono bg-background border-border"
            dir="rtl"
          />
          {searchText && (
            <button
              onClick={() => setSearchText("")}
              className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Status filter */}
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px] h-8 text-xs font-mono">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الحالات</SelectItem>
            <SelectItem value="pending">PENDING</SelectItem>
            <SelectItem value="joined">JOINED</SelectItem>
            <SelectItem value="failed">FAILED</SelectItem>
            <SelectItem value="skipped">SKIPPED</SelectItem>
          </SelectContent>
        </Select>

        {/* Source filter */}
        {uniqueSources.length > 1 && (
          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-[180px] h-8 text-xs font-mono">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المصادر</SelectItem>
              {uniqueSources.map((src) => (
                <SelectItem key={src} value={src}>
                  {src}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Clear filters */}
        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setStatusFilter("all"); setSourceFilter("all"); setSearchText(""); }}
            className="h-8 text-xs text-muted-foreground hover:text-foreground gap-1"
          >
            <X className="w-3 h-3" />
            مسح الفلاتر
          </Button>
        )}
      </div>

      {/* Already-joined feedback dialog */}
      <Dialog open={isJoinedDialogOpen} onOpenChange={setIsJoinedDialogOpen}>
        <DialogContent className="border-card-border bg-card max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-mono flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" />
              ALREADY_JOINED ({joinedFeedback.length})
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-2">
            هذه الروابط موجودة في سجل JOINED — تم الانضمام إليها مسبقاً:
          </p>
          <div className="max-h-[320px] overflow-y-auto rounded border border-card-border bg-background p-3 space-y-2 font-mono text-xs">
            {joinedFeedback.map((entry) => (
              <div key={entry.url} className="flex flex-col gap-0.5 border-b border-card-border/50 pb-2 last:border-0 last:pb-0">
                <span className="text-foreground truncate">{entry.url}</span>
                <span className="text-primary">تم الانضمام سابقاً من الحساب: {entry.accountPhone}</span>
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsJoinedDialogOpen(false)} className="font-mono">
              إغلاق
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono">URL</TableHead>
                <TableHead className="font-mono">STATUS</TableHead>
                <TableHead className="font-mono">SOURCE</TableHead>
                <TableHead className="font-mono">ADDED_AT</TableHead>
                <TableHead className="font-mono text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {filteredLinks.map((link) => (
                <TableRow key={link.id} className="border-card-border">
                  <TableCell className="font-medium truncate max-w-[250px]">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:text-primary transition-colors truncate block max-w-[250px]"
                      title={link.url}
                    >
                      {link.url}
                    </a>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-1 items-start">
                      {getStatusBadge(link.status)}
                      {link.failReason && (
                        <span className="text-[10px] text-destructive max-w-[200px] truncate" title={link.failReason}>
                          {link.failReason}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs border-border text-muted-foreground font-mono">
                      {link.source || "MANUAL"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(link.createdAt), "yyyy-MM-dd HH:mm")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {link.status === "failed" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => retryLink.mutate(link.id)}
                          disabled={retryLink.isPending}
                          title="إعادة المحاولة فوراً"
                          className="text-primary hover:bg-primary/10 hover:text-primary"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(link.id)}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredLinks.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    {hasActiveFilter ? "لا توجد روابط تطابق الفلتر المحدد" : "NO_LINKS_IN_QUEUE"}
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
