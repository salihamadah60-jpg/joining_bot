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
import { Database, Plus, Trash2, RefreshCw, Pencil, CheckCircle2, XCircle, Loader2, Stethoscope, Brain, Sparkles } from "lucide-react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

// ─── Medical specialties shared list ─────────────────────────────────────────
function SpecialtySelect({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`text-xs font-mono bg-background border border-border rounded px-2 py-1 text-foreground focus:outline-none focus:border-primary ${className ?? ""}`}
    >
      <option value="">— بدون تخصص (عام) —</option>
      <optgroup label="── طب بشري ──">
        <option value="general">طب عام</option>
        <option value="internal">باطنة وأمراض داخلية</option>
        <option value="surgery">جراحة عامة</option>
        <option value="pediatrics">أطفال وحديثي الولادة</option>
        <option value="gynecology">نساء وتوليد</option>
        <option value="psychiatry">طب نفسي وعصبي</option>
        <option value="orthopedics">عظام وكسور</option>
        <option value="cardiology">قلبية وأوعية</option>
        <option value="neurology">أعصاب</option>
        <option value="dermatology">جلدية</option>
        <option value="oncology">أورام وسرطان</option>
        <option value="urology">مسالك بولية</option>
        <option value="ent">أنف وأذن وحنجرة</option>
        <option value="ophthalmology">عيون</option>
        <option value="emergency">طوارئ وإسعاف</option>
        <option value="icu">عناية مركزة</option>
        <option value="anesthesia">تخدير وإنعاش</option>
      </optgroup>
      <optgroup label="── أسنان ──">
        <option value="dentistry">أسنان عام</option>
        <option value="orthodontics">تقويم الأسنان — Ortho</option>
        <option value="endodontics">علاج جذور — Endo</option>
        <option value="prosthodontics">تعويضات أسنان</option>
        <option value="periodontics">أمراض اللثة — Perio</option>
        <option value="oral_surgery">جراحة الفم والفكين</option>
        <option value="pedodontics">أسنان الأطفال</option>
      </optgroup>
      <optgroup label="── صيدلة ──">
        <option value="pharmacy">صيدلة</option>
        <option value="clinical_pharmacy">صيدلة سريرية</option>
      </optgroup>
      <optgroup label="── تمريض ──">
        <option value="nursing">تمريض</option>
      </optgroup>
      <optgroup label="── مختبرات طبية ──">
        <option value="laboratory">مختبرات طبية</option>
        <option value="pathology">باثولوجيا وهيستولوجيا</option>
        <option value="microbiology">ميكروبيولوجيا</option>
        <option value="biochemistry">كيمياء حيوية</option>
      </optgroup>
      <optgroup label="── أشعة تشخيصية ──">
        <option value="radiology">أشعة تشخيصية</option>
        <option value="mri">رنين مغناطيسي MRI</option>
        <option value="ct">مقطعية CT</option>
        <option value="ultrasound">سونار وموجات</option>
      </optgroup>
      <optgroup label="── تخصصات صحية أخرى ──">
        <option value="physiotherapy">فيزيوثيرابي</option>
        <option value="optometry">بصريات</option>
        <option value="medical_coding">ترميز طبي</option>
        <option value="medical_technician">فني طبي</option>
        <option value="pct">رعاية مرضى PCT</option>
        <option value="cssd">تعقيم CSSD</option>
      </optgroup>
    </select>
  );
}

type FormData = { name: string; connectionString: string; dbName: string; linkField: string; specialty: string };

const EMPTY_FORM: FormData = {
  name: "",
  connectionString: "",
  dbName: "Joining_links",
  linkField: "url",
  specialty: "",
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
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5">
          <Stethoscope className="w-3.5 h-3.5 text-muted-foreground" />
          التخصص الطبي لهذا المصدر
        </Label>
        <SpecialtySelect
          value={formData.specialty}
          onChange={v => setFormData(prev => ({ ...prev, specialty: v }))}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">
          الروابط المُزامَنة من هذا المصدر ستُوسَم بهذا التخصص — يُستخدم لتوجيهها للحسابات المناسبة
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

  // Global AI classification state
  const [classifyState, setClassifyState] = useState<{
    status: "idle" | "running" | "done" | "error";
    message: string;
    total: number;
    classified: number;
  }>({ status: "idle", message: "", total: 0, classified: 0 });

  const handleClassifyBatch = async () => {
    setClassifyState({ status: "running", message: "🚀 جاري بدء التصنيف الذكي...", total: 0, classified: 0 });
    try {
      const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
      const r = await fetch(`${base}/api/links/classify-batch`, { method: "POST" });
      if (!r.ok) throw new Error(await r.text());
    } catch (e: any) {
      setClassifyState({ status: "error", message: e.message ?? "فشل", total: 0, classified: 0 });
      toast({ title: "❌ فشل بدء التصنيف", description: e.message, variant: "destructive" });
    }
  };

  // ── SSE subscription for sync progress ─────────────────────────────────────
  useEffect(() => {
    const base = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");
    const es = new EventSource(`${base}/api/events`);
    sseRef.current = es;

    es.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data);

        // Handle AI classification events (no collectionId)
        if (event.type === "classify_start") {
          setClassifyState({ status: "running", message: event.message ?? "", total: event.total ?? 0, classified: 0 });
          return;
        }
        if (event.type === "classify_progress") {
          setClassifyState(prev => ({ ...prev, status: "running", message: event.message ?? "", classified: event.classified ?? 0, total: event.total ?? prev.total }));
          return;
        }
        if (event.type === "classify_complete") {
          setClassifyState({ status: "done", message: event.message ?? "", total: event.total ?? 0, classified: event.classified ?? 0 });
          refetch();
          toast({ title: "✅ اكتمل التصنيف الذكي", description: event.message });
          setTimeout(() => setClassifyState({ status: "idle", message: "", total: 0, classified: 0 }), 12_000);
          return;
        }
        if (event.type === "classify_error") {
          setClassifyState(prev => ({ ...prev, status: "error", message: event.message ?? "" }));
          toast({ title: "❌ فشل التصنيف", description: event.message, variant: "destructive" });
          return;
        }

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
      specialty: col.specialty ?? "",
    });
    setEditId(col.id);
  };

  const setSpecialtyMutation = useMutation({
    mutationFn: async ({ id, specialty }: { id: string; specialty: string }) => {
      const r = await fetch(`/api/collections/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ specialty }),
      });
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
      toast({ title: "✅ حُفظ التخصص" });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

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
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          DATA_SOURCES
        </h1>

        <div className="flex items-center gap-2 flex-wrap">
          {/* AI Classify button */}
          <Button
            variant="outline"
            onClick={handleClassifyBatch}
            disabled={classifyState.status === "running"}
            className="font-mono text-xs border-purple-500/40 text-purple-400 hover:bg-purple-500/10 gap-1.5"
          >
            {classifyState.status === "running"
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> جاري التصنيف...</>
              : <><Brain className="w-3.5 h-3.5" /> CLASSIFY_WITH_AI</>
            }
          </Button>

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
      </div>

      {/* AI Classification progress */}
      {classifyState.status !== "idle" && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-mono flex items-center gap-3 ${
          classifyState.status === "error"
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : classifyState.status === "done"
            ? "border-primary/40 bg-primary/5 text-primary"
            : "border-purple-500/40 bg-purple-500/5 text-purple-300"
        }`}>
          {classifyState.status === "running" && <Loader2 className="w-4 h-4 animate-spin shrink-0" />}
          {classifyState.status === "done" && <Sparkles className="w-4 h-4 shrink-0" />}
          {classifyState.status === "error" && <XCircle className="w-4 h-4 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="truncate">{classifyState.message}</div>
            {classifyState.status === "running" && classifyState.total > 0 && (
              <div className="mt-1.5 flex items-center gap-2">
                <Progress
                  value={Math.round((classifyState.classified / classifyState.total) * 100)}
                  className="h-1.5 flex-1"
                />
                <span className="text-xs text-muted-foreground shrink-0">
                  {classifyState.classified.toLocaleString()} / {classifyState.total.toLocaleString()}
                </span>
              </div>
            )}
            {classifyState.status === "running" && classifyState.total === 0 && (
              <Progress value={null as any} className="h-1.5 mt-1.5 animate-pulse w-full" />
            )}
          </div>
        </div>
      )}

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
                <TableHead className="font-mono">
                  <span className="flex items-center gap-1"><Stethoscope className="w-3.5 h-3.5" />SPECIALTY</span>
                </TableHead>
                <TableHead className="font-mono">STATUS</TableHead>
                <TableHead className="font-mono text-right">LAST_SYNC</TableHead>
                <TableHead className="font-mono text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {cols?.map((col) => {
                const isInternal = (col as any).type === "internal";
                const sync = syncStates[col.id] ?? IDLE_SYNC;
                const isRunning = sync.status === "running";
                const pct = sync.total > 0 ? Math.round((sync.processed / sync.total) * 100) : (isRunning ? null : 0);

                return (
                  <TableRow key={col.id} className={`border-card-border ${isInternal ? "bg-purple-500/3" : ""}`}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {isInternal && <Brain className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                        <span className={isInternal ? "text-purple-300" : "text-primary"}>{col.name}</span>
                      </div>
                      {isInternal && (
                        <div className="text-xs text-muted-foreground mt-0.5">مُنشأ تلقائياً بواسطة AI</div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {isInternal
                        ? <div className="text-xs text-purple-400/70 italic">داخلي — MongoDB المحلي</div>
                        : (
                          <>
                            <div>DB: {col.dbName}</div>
                            <div className="text-xs">Field: {col.linkField}</div>
                          </>
                        )
                      }
                    </TableCell>
                    <TableCell>
                      {isInternal
                        ? (
                          <span className="text-xs font-mono text-purple-300 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
                            {(col as any).specialty ?? "—"}
                          </span>
                        )
                        : (
                          <SpecialtySelect
                            value={(col as any).specialty ?? ""}
                            onChange={v => setSpecialtyMutation.mutate({ id: col.id, specialty: v })}
                            className="max-w-[180px]"
                          />
                        )
                      }
                    </TableCell>
                    <TableCell>
                      {isInternal
                        ? <Badge className="bg-purple-500/20 text-purple-300 border border-purple-500/30 font-mono text-xs">INTERNAL</Badge>
                        : col.isActive
                          ? <Badge className="bg-primary text-primary-foreground">ACTIVE</Badge>
                          : <Badge variant="secondary">INACTIVE</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {isInternal
                        ? (
                          <div className="text-xs text-purple-400">
                            {(col.syncedCount as number ?? 0).toLocaleString()} روابط مُصنَّفة
                          </div>
                        )
                        : (
                          <>
                            <div>{col.lastSyncAt ? formatDistanceToNow(new Date(col.lastSyncAt), { addSuffix: true }) : 'NEVER'}</div>
                            {col.syncedCount !== undefined && (
                              <div className="text-xs text-primary">{(col.syncedCount as number).toLocaleString()} records</div>
                            )}
                          </>
                        )
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      {/* Sync progress indicator — only for external collections */}
                      {!isInternal && sync.status !== "idle" && (
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
                              <Progress value={pct ?? 0} className="h-1 w-28" />
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
                        {isInternal ? (
                          /* Internal collections: only delete */
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(col.id)}
                            title="حذف هذا التصنيف الداخلي"
                            className="text-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        ) : (
                          /* External collections: sync + edit + delete */
                          <>
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
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {cols?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
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
