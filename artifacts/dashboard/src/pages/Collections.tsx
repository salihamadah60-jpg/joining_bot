import { useState } from "react";
import { useListCollections, useAddCollection, useDeleteCollection, useSyncCollection } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, Plus, Trash2, RefreshCw, Pencil } from "lucide-react";
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

export default function Collections() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: collections } = useListCollections();
  const addCollection = useAddCollection();
  const deleteCollection = useDeleteCollection();
  const syncCollection = useSyncCollection();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);

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
        }
      });
    }
  };

  const handleSync = (id: string) => {
    syncCollection.mutate({ id }, {
      onSuccess: (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
        queryClient.invalidateQueries({ queryKey: ["/api/links"] });
        toast({
          title: `✅ Sync Complete`,
          description: `أضاف ${data.synced} روابط — ${data.duplicates} مكرر — ${data.errors} خطأ`,
        });
      },
      onError: (e: any) => toast({ title: "فشل الـ Sync", description: e.message, variant: "destructive" }),
    });
  };

  const CollectionForm = ({ onSave, loading }: { onSave: () => void; loading: boolean }) => (
    <div className="space-y-4 py-4 font-mono">
      <div className="space-y-2">
        <Label>اسم المجموعة (الكولكشن بالضبط كما هو في MongoDB)</Label>
        <Input
          value={formData.name}
          onChange={e => setFormData({ ...formData, name: e.target.value })}
          placeholder="global_links_telegram"
          className="bg-background border-input"
        />
        <p className="text-xs text-muted-foreground">انتبه للإملاء — يجب أن يكون اسم الكولكشن مطابقاً تماماً</p>
      </div>
      <div className="space-y-2">
        <Label>MongoDB Connection String</Label>
        <Input
          value={formData.connectionString}
          onChange={e => setFormData({ ...formData, connectionString: e.target.value })}
          placeholder="mongodb+srv://user:pass@cluster.mongodb.net"
          type="password"
          className="bg-background border-input"
        />
      </div>
      <div className="space-y-2">
        <Label>اسم قاعدة البيانات</Label>
        <Input
          value={formData.dbName}
          onChange={e => setFormData({ ...formData, dbName: e.target.value })}
          placeholder="Joining_links"
          className="bg-background border-input"
        />
      </div>
      <div className="space-y-2">
        <Label>اسم الحقل الذي يحتوي الرابط</Label>
        <Input
          value={formData.linkField}
          onChange={e => setFormData({ ...formData, linkField: e.target.value })}
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
            <CollectionForm onSave={handleAdd} loading={addCollection.isPending} />
          </DialogContent>
        </Dialog>
      </div>

      {/* Edit dialog */}
      <Dialog open={editId !== null} onOpenChange={(o) => !o && setEditId(null)}>
        <DialogContent className="border-card-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono">EDIT_SOURCE</DialogTitle>
          </DialogHeader>
          <CollectionForm onSave={handleEdit} loading={editMutation.isPending} />
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
              {collections?.map((col) => (
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
                      <div className="text-xs text-primary">{col.syncedCount} records</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(col.id)}
                        disabled={syncCollection.isPending}
                        className="border-primary text-primary hover:bg-primary/10"
                      >
                        <RefreshCw className={`w-4 h-4 mr-1 ${syncCollection.isPending ? 'animate-spin' : ''}`} /> SYNC
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
              ))}
              {collections?.length === 0 && (
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
