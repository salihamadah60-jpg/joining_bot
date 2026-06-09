import { useGetBotStatus, useGetBotActivity, useStartBot, useStopBot, useGetAccountsStats, useGetLinksStats } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Play, Square, Activity, Users, Link as LinkIcon, AlertTriangle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { data: botStatus, isLoading: loadingStatus } = useGetBotStatus({
    query: { refetchInterval: 5000 } as any
  });
  const { data: activity, isLoading: loadingActivity } = useGetBotActivity({
    query: { refetchInterval: 5000 } as any
  });
  const { data: accountsStats } = useGetAccountsStats({
    query: { refetchInterval: 5000 } as any
  });
  const { data: linksStats } = useGetLinksStats({
    query: { refetchInterval: 5000 } as any
  });

  const startBot = useStartBot();
  const stopBot = useStopBot();

  const handleStart = () => {
    startBot.mutate(undefined, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] })
    });
  };

  const handleStop = () => {
    stopBot.mutate(undefined, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bot/status"] })
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">OPERATIONS_DASHBOARD</h1>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 px-4 py-2 bg-card border border-card-border rounded-md font-mono text-sm">
            <span className="text-muted-foreground">STATUS:</span>
            {botStatus?.running ? (
              <span className="text-primary flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                RUNNING
              </span>
            ) : (
              <span className="text-destructive flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-destructive" />
                STOPPED
              </span>
            )}
          </div>
          {botStatus?.running ? (
            <Button variant="destructive" onClick={handleStop} disabled={stopBot.isPending} className="font-mono">
              <Square className="w-4 h-4 mr-2" /> HALT_SYSTEM
            </Button>
          ) : (
            <Button onClick={handleStart} disabled={startBot.isPending} className="font-mono bg-primary text-primary-foreground hover:bg-primary/90">
              <Play className="w-4 h-4 mr-2" /> ENGAGE_SYSTEM
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono text-muted-foreground">ACTIVE_ACCOUNTS</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">{accountsStats?.active || 0} <span className="text-sm text-muted-foreground font-normal">/ {accountsStats?.total || 0}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono text-muted-foreground">PENDING_QUEUE</CardTitle>
            <LinkIcon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">{botStatus?.queueSize || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono text-muted-foreground">JOINED_TODAY</CardTitle>
            <Activity className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-primary">{botStatus?.totalJoinedToday || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium font-mono text-muted-foreground">FAILED_TODAY</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono text-destructive">{botStatus?.totalFailedToday || 0}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="col-span-4 border-card-border">
        <CardHeader className="border-b border-card-border pb-4">
          <CardTitle className="font-mono text-lg flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            SYSTEM_ACTIVITY_LOG
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="h-[400px] overflow-y-auto bg-card/50 font-mono text-sm p-4 space-y-2">
            {activity?.map((entry) => (
              <div key={entry.id} className="flex items-start gap-4 border-b border-card-border/50 pb-2 last:border-0 hover:bg-muted/50 p-2 rounded transition-colors">
                <span className="text-muted-foreground whitespace-nowrap">
                  {format(new Date(entry.createdAt), "HH:mm:ss.SSS")}
                </span>
                <Badge variant="outline" className={`
                  ${entry.type === 'join_success' ? 'border-primary text-primary' : ''}
                  ${entry.type === 'join_failed' || entry.type === 'flood_wait' ? 'border-destructive text-destructive' : ''}
                  ${entry.type === 'join_skipped' ? 'border-muted-foreground text-muted-foreground' : ''}
                  ${entry.type === 'account_switched' ? 'border-secondary-foreground text-secondary-foreground' : ''}
                `}>
                  {entry.type.toUpperCase()}
                </Badge>
                <div className="flex-1">
                  <span className="text-foreground">{entry.message}</span>
                  {entry.accountPhone && <span className="ml-2 text-primary">[{entry.accountPhone}]</span>}
                  {entry.linkUrl && <span className="ml-2 text-muted-foreground">{entry.linkUrl}</span>}
                </div>
              </div>
            ))}
            {(!activity || activity.length === 0) && (
              <div className="text-muted-foreground text-center py-8">NO_ACTIVITY_RECORDED</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
