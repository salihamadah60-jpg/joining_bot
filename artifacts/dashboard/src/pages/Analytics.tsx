import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area,
  BarChart, Bar,
  PieChart, Pie, Cell, Tooltip as PieTooltip, Legend,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import { TrendingUp, Users, CheckCircle, AlertCircle, Clock, Link } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const BASE = (import.meta.env.BASE_URL as string)?.replace(/\/$/, "") ?? "";

const COLORS = ["#22d3ee", "#f43f5e", "#a78bfa", "#fb923c", "#4ade80", "#facc15", "#f472b6", "#60a5fa"];

function StatCard({
  label, value, sub, icon: Icon, accent = false
}: { label: string; value: string | number; sub?: string; icon: any; accent?: boolean }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{label}</p>
            <p className={`text-2xl font-bold font-mono ${accent ? "text-primary" : "text-foreground"}`}>
              {value}
            </p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className={`p-2 rounded-lg ${accent ? "bg-primary/10" : "bg-muted/40"}`}>
            <Icon className={`w-5 h-5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 text-xs shadow-lg">
      <p className="text-muted-foreground mb-2 font-mono">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color }} className="font-mono">
          {p.name}: <span className="font-bold">{p.value}</span>
        </p>
      ))}
    </div>
  );
};

export default function Analytics() {
  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["analytics-summary"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/analytics/summary`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const { data: daily = [], isLoading: loadingDaily } = useQuery<any[]>({
    queryKey: ["analytics-daily"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/analytics/daily?days=14`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const { data: errors = [], isLoading: loadingErrors } = useQuery<any[]>({
    queryKey: ["analytics-errors"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/analytics/errors`);
      return r.json();
    },
    refetchInterval: 60_000,
  });

  const { data: accountsData = [], isLoading: loadingAccounts } = useQuery<any[]>({
    queryKey: ["analytics-accounts"],
    queryFn: async () => {
      const r = await fetch(`${BASE}/api/analytics/accounts`);
      return r.json();
    },
    refetchInterval: 30_000,
  });

  const dailyFormatted = daily.map((d: any) => ({
    ...d,
    date: d.date?.slice(5), // "MM-DD"
  }));

  return (
    <div className="space-y-8" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإحصاءات والتحليل</h1>
        <p className="text-sm text-muted-foreground mt-1">أداء البوت، معدلات الانضمام، وصحة الحسابات</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <StatCard
          label="إجمالي الانضمامات"
          value={loadingSummary ? "—" : (summary?.totalJoined ?? 0).toLocaleString()}
          sub="منذ البداية"
          icon={CheckCircle}
          accent
        />
        <StatCard
          label="انضمامات اليوم"
          value={loadingSummary ? "—" : summary?.joinedToday ?? 0}
          sub="في الـ 24 ساعة الأخيرة"
          icon={TrendingUp}
        />
        <StatCard
          label="معدل النجاح"
          value={loadingSummary ? "—" : `${summary?.successRate ?? 0}%`}
          sub="نجاح / (نجاح + فشل)"
          icon={CheckCircle}
        />
        <StatCard
          label="حسابات نشطة"
          value={loadingSummary ? "—" : `${summary?.activeAccounts ?? 0} / ${summary?.totalAccounts ?? 0}`}
          sub="من إجمالي الحسابات"
          icon={Users}
        />
        <StatCard
          label="روابط معلقة"
          value={loadingSummary ? "—" : (summary?.pendingLinks ?? 0).toLocaleString()}
          sub="في قائمة الانتظار"
          icon={Clock}
        />
        <StatCard
          label="FLOOD في 24h"
          value={loadingSummary ? "—" : summary?.floodWait24h ?? 0}
          sub="عدد مرات التقييد"
          icon={AlertCircle}
        />
      </div>

      {/* Daily join chart */}
      <Card className="border-border bg-card">
        <CardHeader className="border-b border-border pb-4">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="w-4 h-4 text-primary" />
            معدل الانضمام اليومي — آخر 14 يوم
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {loadingDaily ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">جارٍ التحميل...</div>
          ) : daily.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">لا توجد بيانات بعد — شغِّل البوت لتبدأ الإحصاءات</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={dailyFormatted} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gSuccess" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#22d3ee" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gFailed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#6b7280" }} />
                <YAxis tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: "#9ca3af", paddingTop: 8 }} />
                <Area
                  type="monotone"
                  dataKey="success"
                  name="انضمام ناجح"
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#gSuccess)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="failed"
                  name="فشل الانضمام"
                  stroke="#f43f5e"
                  strokeWidth={2}
                  fill="url(#gFailed)"
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="flood"
                  name="FLOOD_WAIT"
                  stroke="#fb923c"
                  strokeWidth={1.5}
                  fill="none"
                  strokeDasharray="4 2"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Error distribution pie */}
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <AlertCircle className="w-4 h-4 text-destructive" />
              توزيع الأخطاء — آخر 30 يوم
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loadingErrors ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">جارٍ التحميل...</div>
            ) : errors.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">
                ✅ لا أخطاء مسجَّلة — ممتاز!
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={errors}
                    dataKey="count"
                    nameKey="code"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    strokeWidth={0}
                  >
                    {errors.map((_: any, i: number) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <PieTooltip
                    formatter={(v: any, name: any) => [`${v} حالة`, name]}
                    contentStyle={{ background: "#1a1a2e", border: "1px solid #ffffff15", borderRadius: 8, fontSize: 12 }}
                  />
                  <Legend
                    formatter={(value) => (
                      <span style={{ fontSize: 11, color: "#9ca3af", fontFamily: "monospace" }}>{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Per-account bar chart */}
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Users className="w-4 h-4 text-primary" />
              أداء كل حساب (إجمالي الانضمامات)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            {loadingAccounts ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">جارٍ التحميل...</div>
            ) : accountsData.length === 0 ? (
              <div className="h-52 flex items-center justify-center text-muted-foreground text-sm">أضف حسابات أولاً</div>
            ) : (
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={accountsData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff08" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#6b7280" }} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="label"
                    tick={{ fontSize: 11, fill: "#9ca3af", fontFamily: "monospace" }}
                    width={72}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="joinedCount" name="انضمام ناجح" fill="#22d3ee" radius={[0, 4, 4, 0]} maxBarSize={20} />
                  <Bar dataKey="failedCount" name="فشل" fill="#f43f5e" radius={[0, 4, 4, 0]} maxBarSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-account table */}
      {accountsData.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="border-b border-border pb-4">
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <Link className="w-4 h-4 text-primary" />
              جدول أداء الحسابات التفصيلي
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4 overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="pb-3 font-medium px-2">الحساب</th>
                  <th className="pb-3 font-medium px-2">الحالة</th>
                  <th className="pb-3 font-medium px-2">إجمالي الانضمام</th>
                  <th className="pb-3 font-medium px-2">اليوم</th>
                  <th className="pb-3 font-medium px-2">الفشل</th>
                  <th className="pb-3 font-medium px-2">معدل النجاح</th>
                  <th className="pb-3 font-medium px-2">عدد المجموعات</th>
                </tr>
              </thead>
              <tbody>
                {accountsData.map((a: any, i: number) => (
                  <tr key={i} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-2 font-mono text-foreground">***{a.phone}</td>
                    <td className="py-3 px-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        a.status === "active" ? "bg-primary/15 text-primary" :
                        a.status === "flood_wait" ? "bg-orange-500/15 text-orange-400" :
                        a.status === "banned" ? "bg-red-500/15 text-red-400" :
                        a.status === "channels_limit" ? "bg-yellow-500/15 text-yellow-400" :
                        a.status === "needs_auth" ? "bg-purple-500/15 text-purple-400" :
                        "bg-muted text-muted-foreground"
                      }`}>
                        {a.status === "active" ? "نشط" :
                         a.status === "flood_wait" ? "انتظار flood" :
                         a.status === "banned" ? "محظور" :
                         a.status === "channels_limit" ? "وصل الحد" :
                         a.status === "needs_auth" ? "يحتاج مصادقة" :
                         a.status}
                      </span>
                    </td>
                    <td className="py-3 px-2 font-mono text-primary font-bold">{a.joinedCount.toLocaleString()}</td>
                    <td className="py-3 px-2 font-mono text-foreground">{a.joinedToday}</td>
                    <td className="py-3 px-2 font-mono text-destructive">{a.failedCount}</td>
                    <td className="py-3 px-2">
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full"
                            style={{ width: `${a.successRate}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">{a.successRate}%</span>
                      </div>
                    </td>
                    <td className="py-3 px-2 font-mono text-muted-foreground">{a.channelsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
