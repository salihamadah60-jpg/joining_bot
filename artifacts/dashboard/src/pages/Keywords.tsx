import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, RefreshCw, ShieldAlert, Stethoscope, Info, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface CustomKeyword {
  _id: string;
  keyword: string;
  category: "strong_medical" | "hard_blocked" | "soft_medical" | "not_medical";
  addedAt: string;
}

const CATEGORIES = [
  {
    id: "strong_medical" as const,
    label: "طبي قوي",
    description: "كلمة تضمن قبول المجموعة فوراً",
    color: "text-emerald-400 border-emerald-500/40 bg-emerald-950/20",
    badgeClass: "bg-emerald-500/20 text-emerald-400 border-emerald-500/40",
    icon: Stethoscope,
  },
  {
    id: "hard_blocked" as const,
    label: "محظور تماماً",
    description: "كلمة تمنع قبول المجموعة في كل الأحوال",
    color: "text-red-400 border-red-500/40 bg-red-950/20",
    badgeClass: "bg-red-500/20 text-red-400 border-red-500/40",
    icon: ShieldAlert,
  },
  {
    id: "soft_medical" as const,
    label: "طبي محتمل",
    description: "كلمة تشير إلى احتمال طبي (غير حاسمة)",
    color: "text-yellow-400 border-yellow-500/40 bg-yellow-950/20",
    badgeClass: "bg-yellow-500/20 text-yellow-400 border-yellow-500/40",
    icon: Info,
  },
  {
    id: "not_medical" as const,
    label: "غير طبي",
    description: "كلمة تشير إلى مجموعة غير طبية",
    color: "text-orange-400 border-orange-500/40 bg-orange-950/20",
    badgeClass: "bg-orange-500/20 text-orange-400 border-orange-500/40",
    icon: AlertCircle,
  },
];

async function fetchKeywords(): Promise<CustomKeyword[]> {
  const r = await fetch("/api/keywords");
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

async function addKeyword(keyword: string, category: string): Promise<void> {
  const r = await fetch("/api/keywords", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ keyword, category }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error(err.error ?? r.statusText);
  }
}

async function deleteKeyword(id: string): Promise<void> {
  const r = await fetch(`/api/keywords/${id}`, { method: "DELETE" });
  if (!r.ok) throw new Error(await r.text());
}

export default function Keywords() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newKeyword, setNewKeyword] = useState("");
  const [newCategory, setNewCategory] = useState<string>("strong_medical");
  const [filterCategory, setFilterCategory] = useState<string>("all");

  const { data: keywords = [], isLoading, refetch } = useQuery<CustomKeyword[]>({
    queryKey: ["/api/keywords"],
    queryFn: fetchKeywords,
    refetchInterval: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: () => addKeyword(newKeyword.trim(), newCategory),
    onSuccess: () => {
      toast({ title: "✅ تمت إضافة الكلمة" });
      setNewKeyword("");
      qc.invalidateQueries({ queryKey: ["/api/keywords"] });
    },
    onError: (e: any) => toast({ title: "خطأ", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: deleteKeyword,
    onSuccess: () => {
      toast({ title: "🗑️ تم حذف الكلمة" });
      qc.invalidateQueries({ queryKey: ["/api/keywords"] });
    },
    onError: (e: any) => toast({ title: "خطأ في الحذف", description: e.message, variant: "destructive" }),
  });

  const filtered = filterCategory === "all"
    ? keywords
    : keywords.filter((k) => k.category === filterCategory);

  const countByCategory = (cat: string) => keywords.filter((k) => k.category === cat).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold font-mono tracking-tight text-foreground">KEYWORDS_MANAGER</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isLoading}
          className="font-mono gap-2 border-card-border"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
          تحديث
        </Button>
      </div>

      {/* Info banner */}
      <div className="p-3 rounded-md border border-primary/20 bg-primary/5 text-sm text-muted-foreground font-mono">
        الكلمات المضافة هنا تُضاف إلى الكلمات الثابتة في النظام وتُفعَّل خلال دقيقة واحدة تلقائياً.
        تؤثر على: فلتر الانضمام ← فلتر ما بعد الانضمام ← الذكاء الاصطناعي ← تصنيف التخصصات ← إعادة ترشيح المتجاهل.
      </div>

      {/* Add keyword form */}
      <Card className="border-card-border bg-card/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-mono text-muted-foreground">إضافة كلمة جديدة</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              value={newKeyword}
              onChange={(e) => setNewKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newKeyword.trim()) addMutation.mutate();
              }}
              placeholder="أدخل كلمة مفتاحية (عربي أو إنجليزي)..."
              className="flex-1 font-mono text-sm bg-background border-card-border"
              dir="auto"
            />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-48 font-mono text-sm border-card-border bg-card/40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="font-mono text-xs">{cat.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={!newKeyword.trim() || addMutation.isPending}
              className="font-mono gap-2"
            >
              <Plus className="w-4 h-4" />
              إضافة
            </Button>
          </div>
          {/* Category description */}
          {(() => {
            const cat = CATEGORIES.find((c) => c.id === newCategory);
            return cat ? (
              <p className="mt-2 text-xs text-muted-foreground font-mono">{cat.description}</p>
            ) : null;
          })()}
        </CardContent>
      </Card>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() => setFilterCategory(filterCategory === cat.id ? "all" : cat.id)}
            className={`p-3 rounded-md border text-left transition-colors ${
              filterCategory === cat.id ? cat.color : "border-card-border bg-card/30 hover:bg-card/60"
            }`}
          >
            <div className="flex items-center justify-between">
              <cat.icon className="w-4 h-4 text-muted-foreground" />
              <span className={`text-lg font-bold font-mono ${filterCategory === cat.id ? "" : "text-foreground"}`}>
                {countByCategory(cat.id)}
              </span>
            </div>
            <p className="text-xs font-mono text-muted-foreground mt-1">{cat.label}</p>
          </button>
        ))}
      </div>

      {/* Filter badge */}
      {filterCategory !== "all" && (
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted-foreground">تصفية:</span>
          <Badge
            variant="outline"
            className={`font-mono text-xs cursor-pointer ${CATEGORIES.find((c) => c.id === filterCategory)?.badgeClass}`}
            onClick={() => setFilterCategory("all")}
          >
            {CATEGORIES.find((c) => c.id === filterCategory)?.label} ✕
          </Badge>
        </div>
      )}

      {/* Keywords list */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground font-mono text-sm">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" />
          جاري التحميل...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground font-mono text-sm border border-card-border rounded-md bg-card/20">
          {filterCategory === "all" ? "لا توجد كلمات مخصصة بعد — أضف أول كلمة أعلاه" : "لا توجد كلمات في هذه الفئة"}
        </div>
      ) : (
        <div className="grid gap-2">
          {filtered.map((kw) => {
            const cat = CATEGORIES.find((c) => c.id === kw.category);
            return (
              <div
                key={kw._id}
                className="flex items-center justify-between px-4 py-2.5 rounded-md border border-card-border bg-card/30 hover:bg-card/50 transition-colors group"
              >
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm text-foreground" dir="auto">
                    {kw.keyword}
                  </span>
                  {cat && (
                    <Badge variant="outline" className={`text-[10px] font-mono py-0 ${cat.badgeClass}`}>
                      {cat.label}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                    {new Date(kw.addedAt).toLocaleDateString("ar-SA")}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(kw._id)}
                    disabled={deleteMutation.isPending}
                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Total count */}
      {keywords.length > 0 && (
        <p className="text-xs font-mono text-muted-foreground text-center">
          {keywords.length} كلمة مخصصة إجمالاً
        </p>
      )}
    </div>
  );
}
