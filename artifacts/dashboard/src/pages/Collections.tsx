import { useState } from "react";
import { useListCollections, useAddCollection, useDeleteCollection, useSyncCollection } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Database, Plus, Trash2, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

export default function Collections() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: collections } = useListCollections();
  const addCollection = useAddCollection();
  const deleteCollection = useDeleteCollection();
  const syncCollection = useSyncCollection();

  const [isOpen, setIsOpen] = useState(false);
  const [formData, setFormData] = useState({ name: "", connectionString: "", dbName: "", linkField: "" });

  const handleAdd = () => {
    addCollection.mutate({ data: formData }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
        setIsOpen(false);
        setFormData({ name: "", connectionString: "", dbName: "", linkField: "" });
        toast({ title: "Collection Added" });
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Remove this collection source?")) {
      deleteCollection.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
          toast({ title: "Collection Removed" });
        }
      });
    }
  };

  const handleSync = (id: number) => {
    syncCollection.mutate({ id }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: ["/api/collections"] });
        queryClient.invalidateQueries({ queryKey: ["/api/links"] });
        toast({ title: "Sync Complete", description: `Added ${data.synced} links. Errors: ${data.errors}` });
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Database className="w-6 h-6 text-primary" />
          DATA_SOURCES
        </h1>
        
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="font-mono">
              <Plus className="w-4 h-4 mr-2" /> ADD_SOURCE
            </Button>
          </DialogTrigger>
          <DialogContent className="border-card-border bg-card">
            <DialogHeader>
              <DialogTitle className="font-mono">CONFIGURE_MONGO_SOURCE</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4 font-mono">
              <div className="space-y-2">
                <Label>Collection Name (Alias)</Label>
                <Input value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="Medical Groups" className="bg-background border-input" />
              </div>
              <div className="space-y-2">
                <Label>MongoDB Connection String</Label>
                <Input value={formData.connectionString} onChange={e => setFormData({...formData, connectionString: e.target.value})} placeholder="mongodb://user:pass@host:port" type="password" className="bg-background border-input" />
              </div>
              <div className="space-y-2">
                <Label>Database Name</Label>
                <Input value={formData.dbName} onChange={e => setFormData({...formData, dbName: e.target.value})} placeholder="telegram_data" className="bg-background border-input" />
              </div>
              <div className="space-y-2">
                <Label>Link Field Path</Label>
                <Input value={formData.linkField} onChange={e => setFormData({...formData, linkField: e.target.value})} placeholder="url" className="bg-background border-input" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={!formData.name || !formData.connectionString || !formData.dbName || !formData.linkField || addCollection.isPending} className="font-mono w-full">SAVE_CONFIGURATION</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

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
                    {col.isActive ? <Badge className="bg-primary text-primary-foreground">ACTIVE</Badge> : <Badge variant="secondary">INACTIVE</Badge>}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    <div>{col.lastSyncAt ? formatDistanceToNow(new Date(col.lastSyncAt), {addSuffix: true}) : 'NEVER'}</div>
                    {col.syncedCount !== undefined && <div className="text-xs text-primary">{col.syncedCount} records</div>}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleSync(col.id)} disabled={syncCollection.isPending} className="border-primary text-primary hover:bg-primary/10">
                        <RefreshCw className={`w-4 h-4 mr-2 ${syncCollection.isPending ? 'animate-spin' : ''}`} /> SYNC
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(col.id)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {collections?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">NO_SOURCES_CONFIGURED</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
