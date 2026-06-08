import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Radio, Download } from "lucide-react";
import { format } from "date-fns";

interface ChannelLink {
  id: number;
  url: string;
  title: string | null;
  detectedAt: string;
}

export default function Channels() {
  const { data: channels, isLoading } = useQuery<ChannelLink[]>({
    queryKey: ["/api/channels"],
    queryFn: async () => {
      const r = await fetch("/api/channels");
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    },
    refetchInterval: 15000,
  });

  const handleExport = () => {
    window.open("/api/channels/export", "_blank");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono flex items-center gap-2">
          <Radio className="w-6 h-6 text-primary" />
          CHANNEL_LINKS
        </h1>

        <div className="flex items-center gap-3">
          <span className="text-xs font-mono text-muted-foreground">
            {channels?.length ?? 0} قناة مكتشفة
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={!channels?.length}
            className="font-mono gap-2 border-primary text-primary hover:bg-primary/10"
          >
            <Download className="w-3.5 h-3.5" />
            تصدير .txt
          </Button>
        </div>
      </div>

      <Card className="border-card-border bg-card/40 text-sm font-mono text-muted-foreground px-4 py-3 rounded-lg">
        <p>
          📡 هذه القنوات تم اكتشافها أثناء عملية الانضمام — التطبيق لا ينضم للقنوات تلقائياً بل يحفظ
          روابطها هنا. يمكنك تصديرها كملف نصي.
        </p>
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
                    LOADING...
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
                    <a
                      href={ch.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary/80 hover:text-primary hover:underline"
                    >
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
                  <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
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
