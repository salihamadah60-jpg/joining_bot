import { useState } from "react";
import { useListAccounts, useUpdateAccount, useDeleteAccount, useCreateAccount } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Users, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";

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

  const handleToggleStatus = (id: number, currentStatus: string) => {
    const newStatus = currentStatus === "paused" ? "active" : "paused";
    updateAccount.mutate({ id, data: { status: newStatus as any } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
        toast({ title: "Account Updated", description: `Account status changed to ${newStatus}` });
      }
    });
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this account?")) {
      deleteAccount.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
          toast({ title: "Account Deleted" });
        }
      });
    }
  };

  const handleAdd = () => {
    createAccount.mutate({ data: { phone: newPhone, label: newLabel } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/accounts"] });
        setIsAddOpen(false);
        setNewPhone("");
        setNewLabel("");
        toast({ title: "Account Added" });
      }
    });
  };

  const getStatusBadge = (status: string, floodWaitUntil?: string | null) => {
    switch(status) {
      case 'active': return <Badge className="bg-primary text-primary-foreground">ACTIVE</Badge>;
      case 'paused': return <Badge variant="secondary">PAUSED</Badge>;
      case 'banned': return <Badge variant="destructive">BANNED</Badge>;
      case 'channels_limit': return <Badge variant="destructive">LIMIT_REACHED</Badge>;
      case 'flood_wait': 
        const waitText = floodWaitUntil ? `UNTIL ${formatDistanceToNow(new Date(floodWaitUntil))}` : '';
        return <Badge variant="outline" className="border-destructive text-destructive">FLOOD_WAIT {waitText}</Badge>;
      default: return <Badge variant="outline">{status.toUpperCase()}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
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
            </DialogHeader>
            <div className="space-y-4 py-4 font-mono">
              <div className="space-y-2">
                <Label>Phone Number</Label>
                <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+1234567890" className="bg-background border-input" />
              </div>
              <div className="space-y-2">
                <Label>Label (Optional)</Label>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Main Ops" className="bg-background border-input" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAdd} disabled={!newPhone || createAccount.isPending} className="font-mono w-full">SUBMIT_REGISTRATION</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono">PHONE</TableHead>
                <TableHead className="font-mono">LABEL</TableHead>
                <TableHead className="font-mono">STATUS</TableHead>
                <TableHead className="font-mono text-right">JOINED/FAILED</TableHead>
                <TableHead className="font-mono text-right">DELAY</TableHead>
                <TableHead className="font-mono text-right">ACTIONS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono">
              {accounts?.map((acc) => (
                <TableRow key={acc.id} className="border-card-border">
                  <TableCell className="font-medium">{acc.phone} {acc.isPremium && <Badge variant="outline" className="ml-2 text-xs text-yellow-500 border-yellow-500">PREMIUM</Badge>}</TableCell>
                  <TableCell className="text-muted-foreground">{acc.label || '-'}</TableCell>
                  <TableCell>{getStatusBadge(acc.status, acc.floodWaitUntil)}</TableCell>
                  <TableCell className="text-right">
                    <span className="text-primary">{acc.joinedCount}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-destructive">{acc.failedCount}</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground">{acc.currentDelay}s</TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-4">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{acc.status === 'paused' ? 'RESUME' : 'PAUSE'}</span>
                        <Switch 
                          checked={acc.status !== 'paused' && acc.status !== 'banned'} 
                          disabled={acc.status === 'banned'}
                          onCheckedChange={() => handleToggleStatus(acc.id, acc.status)}
                        />
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(acc.id)} className="text-destructive hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {accounts?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">NO_ACCOUNTS_FOUND</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
