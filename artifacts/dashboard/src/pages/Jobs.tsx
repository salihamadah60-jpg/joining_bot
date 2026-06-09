import { useListJobs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ActivitySquare } from "lucide-react";
import { format } from "date-fns";

export default function Jobs() {
  const { data: jobs } = useListJobs({ limit: 100 });

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'success': return <Badge className="bg-primary text-primary-foreground border-primary">SUCCESS</Badge>;
      case 'failed': return <Badge variant="destructive">FAILED</Badge>;
      case 'skipped': return <Badge variant="secondary">SKIPPED</Badge>;
      case 'flood_wait': return <Badge variant="outline" className="border-destructive text-destructive">FLOOD_WAIT</Badge>;
      default: return <Badge variant="outline">{status.toUpperCase()}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <ActivitySquare className="w-6 h-6 text-primary" />
          OPERATION_LOGS
        </h1>
      </div>

      <Card className="border-card-border">
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow className="border-card-border hover:bg-transparent">
                <TableHead className="font-mono">TIMESTAMP</TableHead>
                <TableHead className="font-mono">ACCOUNT</TableHead>
                <TableHead className="font-mono">TARGET_URL</TableHead>
                <TableHead className="font-mono">STATUS</TableHead>
                <TableHead className="font-mono">DETAILS</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="font-mono text-sm">
              {jobs?.map((job) => (
                <TableRow key={job.id} className="border-card-border">
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {format(new Date(job.createdAt), "yyyy-MM-dd HH:mm:ss")}
                  </TableCell>
                  <TableCell className="font-medium text-primary">{job.accountPhone || '—'}</TableCell>
                  <TableCell className="truncate max-w-[200px]" title={job.linkUrl || ''}>{job.linkUrl || '-'}</TableCell>
                  <TableCell>{getStatusBadge(job.status)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.errorCode ? `ERR_${job.errorCode}: ` : ''}
                    {job.errorMessage || '-'}
                  </TableCell>
                </TableRow>
              ))}
              {jobs?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">NO_RECORDS_FOUND</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
