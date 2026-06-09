import { useState, useEffect, useRef } from "react";
import { useListCollections, useAddCollection, useDeleteCollection } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Database, Plus, Trash2, RefreshCw, Pencil, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

type FormData = { name: string; connectionString: string; dbName: string; linkField: string };

const EMPTY_FORM: FormData = {
  name: "",
  connectionString: "",
  dbName: "Joining_links",
  linkField: "url",
};

interface SyncState {
  status: "idle" | "running" | "done" | "error";
  message: string;
  total: number;
  processed: number;
  synced: number;
  duplicates: number;
  errors: number;
}

const IDLE_SYNC: SyncState = {
  status: "idle", message: "", total: 0, processed: 0, synced: 0, duplicates: 0, errors: 0,
};

// ─── CollectionForm outside parent to prevent remount on keystroke ────────────
interface CollectionFormProps {
  formData: FormData;
  setFormData: React.Dispatch<React.SetStateAction<FormData>>;
  onSave: () => void;
  loading: boolean;
}

function CollectionForm({ formData, setFormData, onSave, loading }: CollectionFormProps) {
  return (
    <div className="space-y-4 py-4 font-mono">
      <div className="space-y-2">
        <Label>اسم الكولكشن (كما هو في MongoDB تماماً)</Label>
        <Input
          value={formData.name}
          onChange={e => setFormData(prev => ({ ...prev, name: e.target.value }))}
          placeholder="global_links_telegram"
          className="bg-background border-input"
        />
        <p className="text-xs text-muted-foreground">انتبه للإملاء — يجب أن يكون مطابقاً تماماً</p>
      </div>
      <div className="space-y-2">
        <Label>MongoDB Connection String</Label>
        <Input
          value={formData.connectionString}
          onChange={e => setFormData(prev => ({ ...prev, connectionString: e.target.value }))}
          placeholder="mongodb+srv://user:pass@cluster.mongodb.net"
          type="password"
          className="bg-background border-input"
        />
      </div>
      <div className="space-y-2">
        <Label>اسم قاعدة البيانات</Label>
        <Input
          value={formData.dbName}
          onChange={e => setFormData(prev => ({ ...prev, dbName: e.target.value }))}
          placeholder="Joining_links"
          className="bg-background border-input"
        />
      </div>
      <div className="space-y-2">
        <Label>اسم الحقل الذي يحتوي الرابط</Label>
        <Input
          value={formData.linkField}
          onChange={e => setFormData(prev => ({ ...prev, linkField: e.target.value }))}
          placeholder="url"
          className="bg-background border-input"
        />
        <p className="text-xs text-muted-foreground">
          إذا كنت غير متأكد اترك <code>url</code> — السيرفر يبحث تلقائياً عن أي حقل يحتوي t.me
        </p>
      </div>
      <DialogFooter>
        <Button
          onClick={onSave}
          disabled={!formData.name || !formData.connectionString || !formData.dbName || loading}
          className="font-mono w-full"
        >
          {loading ? "جاري الحفظ..." : "SAVE_CONFIGURATION"}
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function Collections() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: cols, refetch } = useListCollections();
  const addCollection = useAddCollection();
  const deleteCollection = useDeleteCollection();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);

  // Per-collection sync state
  const [syncStates, setSyncStates] = useState<Record<string, SyncState>>({});
  const sseRef = useRef<EventSource | null>(null);

  // ── SSE subscription for sync progress ─────────────────────────────────────
  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
    const es = new EventSource(`${base}/api/events`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);
        const cid: string | undefined = event.collectionId;
        if (!cid) return;

        if (event.type === "sync_progress") {
          setSyncStates(prev => ({
            ...prev,
            [cid]: {
              status: "running",
              message: event.message ?? "",
              total: event.total ?? 0,
              processed: event.processed ?? 0,
              synced: 0,
              duplicates: 0,
              errors: 0,
            },
          }));
        } else if (event.type === "sync_complete") {
          setSyncStates(prev => ({
            ...prev,
            [cid]: {
              status: "done",
              message: event.message ?? "",
              total: event.total ?? 0,
              processed: event.processed ?? 0,
              synced: event.synced ?? 0,
              duplicates: event.duplicates ?? 0,
              errors: event.errors ?? 0,
            },
          }));
          // Refresh collection list and link stats
          refetch();
          queryClient.invalidateQueries({ queryKey: ["/api/links"] });
          toast({
            title: "✅ Sync مكتمل",
            description: `${(event.synced ?? 0).toLocaleString()} جديد — ${(event.duplicates ?? 0).toLocaleString()} مكرر`,
          });
          // Auto-clear after 8 seconds
          setTimeout(() => {
            setSyncStates(prev => ({ ...prev, [cid]: IDLE_SYNC }));
          }, 8_000);
        } else if (event.type === "sync_error") {
          setSyncStates(prev => ({
            ...prev,
            [cid]: {
              status: "error",
              message: event.message ?? "خطأ غير معروف",
              total: 0, processed: 0, synced: 0, duplicates: 0, errors: 1,
            },
          }));
          toast({ title: "❌ فشل الـ Sync", description: event.message, variant: "destructive" });
          setTimeout(() => {
            setSyncStates(prev => ({ ...prev, [cid]: IDLE_SYNC }));
          }, 10_000);
        }
      } catch { /* ignore parse errors */ }
    };

    return () => { es.close(); };
  }, []);

  const handleSync = async (id: string) => {
    setSyncStates(prev => ({
      ...prev,
      [id]: { status: "running", message: "🚀 جاري بدء المزامنة...", total: 0, processed: 0, synced: 0, duplicates: 0, errors: 0 },
    }));
    try {
      const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
      const r = await fetch(`${base}/api/collections/${id}/sync`, { method: "POST" });
      if (!r.ok) {
        const err = await r.text();
        throw new Error(err);
      }
      // Response is immediate — progress arrives via SSE
    } catch (e: any) {
      setSyncStates(prev => ({
        ...prev,
        [id]: { status: "error", message: e.message ?? "فشل الاتصال", total: 0, processed: 0, synced: 0, duplicates: 0, errors: 1 },
      }));
      toast({ title: "❌ فشل الـ Sync", description: e.message, variant: "destructive" });
    }
  };

  const editMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: FormData }) => {
      const r = await fetch(`/api/collections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      setEditId(null);
      toast({ title: "✅ تم تحديث الإعدادات" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const handleAdd = () => {
    addCollection.mutate({ data: { ...formData, isActive: true } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
        setIsAddOpen(false);
        setFormData(EMPTY_FORM);
        toast({ title: "✅ تمت إضافة المصدر" });
      },
      onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
    });
  };

  const handleEdit = () => {
    if (!editId) return;
    editMutation.mutate({ id: editId, data: formData });
  };

  const openEdit = (col: any) => {
    setFormData({
      name: col.name,
      connectionString: col.connectionString,
      dbName: col.dbName ?? "",
      linkField: col.linkField,
    });
    setEditId(col.id);
  };

  const handleDelete = (id: string) => {
    if (confirm("حذف هذا المصدر نهائياً؟")) {
      deleteCollection.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
          toast({ title: "تم الحذف" });
        },
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          DATA_SOURCES
        </h1>

        <Dialog open={isAddOpen} onOpenChange={(o) => { setIsAddOpen(o); if (o) setFormData(EMPTY_FORM); }}>
          <DialogTrigger asChild>
            <Button className="font-mono"><Plus className="w-4 h-4 mr-2" /> ADD_SOURCE</Button>
          </DialogTrigger>
          <DialogContent className="border-card-border bg-card">
            <DialogHeader>
              <DialogTitle className="font-mono">CONFIGURE_MONGO_SOURCE</DialogTitle>
            </DialogHeader>
            <CollectionForm formData={formData} setFormData={setFormData} onSave={handleAdd} loading={addCollection.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editId !== null} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="border-card-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono">EDIT_SOURCE</DialogTitle>
          </DialogHeader>
          <CollectionForm formData={formData} setFormData={setFormData} onSave={handleEdit} loading={editMutation.isPending} />
        </DialogContent>
      </Dialog>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono">NAME</TableHead>
                <TableHead className="font-mono">DB_INFO</TableHead>
                <TableHead className="font-mono">STATUS</TableHead>
                <TableHead className="font-mono text-right">LAST_SYNC</TableHead>
                <TableHead className="font-mono text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {cols?.map((col) => {
                const sync = syncStates[col.id] ?? IDLE_SYNC;
                const isRunning = sync.status === "running";
                const pct = sync.total > 0 ? Math.round((sync.processed / sync.total) * 100) : (isRunning ? null : 0);

                return (
                  <TableRow key={col.id} className="border-card-border">
                    <TableCell className="font-medium text-primary">{col.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <div>DB: {col.dbName}</div>
                      <div className="text-xs">Field: {col.linkField}</div>
                    </TableCell>
                    <TableCell>
                      {col.isActive
                        ? <Badge className="bg-primary text-primary-foreground">ACTIVE</Badge>
                        : <Badge variant="secondary">INACTIVE</Badge>}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      <div>{col.lastSyncAt ? formatDistanceToNow(new Date(col.lastSyncAt), { addSuffix: true }) : 'NEVER'}</div>
                      {col.syncedCount !== undefined && (
                        <div className="text-xs text-primary">{(col.syncedCount as number).toLocaleString()} records</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Sync progress indicator */}
                      {sync.status !== "idle" && (
                        <div className="mb-2 text-right space-y-1">
                          <div className="flex items-center justify-end gap-1.5 text-xs">
                            {sync.status === "running" && <Loader2 className="w-3 h-3 animate-spin text-primary" />}
                            {sync.status === "done" && <CheckCircle2 className="w-3 h-3 text-primary" />}
                            {sync.status === "error" && <XCircle className="w-3 h-3 text-destructive" />}
                            <span className={`${sync.status === "error" ? "text-destructive" : "text-primary"} max-w-[200px] truncate`}>
                              {sync.message}
                            </span>
                          </div>
                          {(isRunning || sync.status === "done") && sync.total > 0 && (
                            <div className="flex items-center justify-end gap-2">
                              <Progress
                                value={pct ?? 0}
                                className="h-1 w-28"
                              />
                              <span className="text-xs text-muted-foreground w-8 text-left">{pct ?? 0}%</span>
                            </div>
                          )}
                          {isRunning && sync.total === 0 && (
                            <div className="flex justify-end">
                              <Progress value={null as any} className="h-1 w-28 animate-pulse" />
                            </div>
                          )}
                          {sync.status === "done" && (
                            <div className="text-xs text-muted-foreground text-right">
                              +{sync.synced.toLocaleString()} جديد · {sync.duplicates.toLocaleString()} مكرر
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSync(col.id)}
                          disabled={isRunning}
                          className="border-primary text-primary hover:bg-primary/10"
                        >
                          <RefreshCw className={`w-4 h-4 mr-1 ${isRunning ? "animate-spin" : ""}`} />
                          {isRunning ? "SYNCING..." : "SYNC"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(col)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(col.id)}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {cols?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    NO_SOURCES_CONFIGURED
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
