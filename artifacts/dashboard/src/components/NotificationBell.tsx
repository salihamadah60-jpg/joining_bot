/**
 * NOTIFICATION BELL — P2-5: Real-time Notifications
 *
 * Subscribes to /api/events SSE stream and shows a badge with unread
 * critical alerts. Clicking opens a notification panel.
 */

import { useState, useEffect, useRef } from "react";
import { Bell, BellRing, X, CheckCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface BotEvent {
  type: string;
  message: string;
  accountPhone?: string;
  linkUrl?: string;
  waitSeconds?: number;
  timestamp: string;
}

const CRITICAL_TYPES = new Set([
  "account_banned",
  "account_needs_auth",
  "flood_wait_long",
  "channels_limit",
  "links_exhausted",
  "invite_request_approved",
]);

function eventIcon(type: string): string {
  switch (type) {
    case "account_banned": return "🔴";
    case "account_needs_auth": return "🔑";
    case "flood_wait_long": return "⏳";
    case "channels_limit": return "⛔";
    case "links_exhausted": return "📭";
    case "join_success": return "✅";
    case "join_failed": return "❌";
    case "invite_request": return "📩";
    case "invite_request_approved": return "🎉";
    case "engine_started": return "▶️";
    case "engine_stopped": return "⏸";
    default: return "ℹ️";
  }
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" });
}

const API_BASE = import.meta.env.VITE_API_URL ?? "";

// Translates event type to Arabic label for toasts
function eventLabel(type: string): string {
  switch (type) {
    case "account_banned": return "🔴 حساب محظور";
    case "account_needs_auth": return "🔑 يحتاج تسجيل دخول";
    case "flood_wait_long": return "⏳ انتظار إجباري";
    case "channels_limit": return "⛔ حد القنوات";
    case "links_exhausted": return "📭 انتهت الروابط";
    case "invite_request_approved": return "🎉 تم قبول طلب انضمام!";
    default: return type;
  }
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<BotEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [connected, setConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    let es: EventSource;
    let retryTimeout: NodeJS.Timeout;

    function connect() {
      es = new EventSource(`${API_BASE}/api/events`);
      eventSourceRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const event: BotEvent = JSON.parse(e.data);
          setNotifications((prev) => {
            const updated = [event, ...prev].slice(0, 50);
            return updated;
          });
          if (CRITICAL_TYPES.has(event.type)) {
            setUnread((prev) => prev + 1);
            // Show immediate toast for critical events
            toast({
              title: eventLabel(event.type),
              description: event.message,
              duration: event.type === "invite_request_approved" ? 10_000 : 6_000,
              variant: event.type === "account_banned" ? "destructive" : "default",
            });
          }
        } catch {
          // ignore parse errors
        }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Retry after 5 seconds
        retryTimeout = setTimeout(connect, 5000);
      };
    }

    connect();

    return () => {
      clearTimeout(retryTimeout);
      eventSourceRef.current?.close();
    };
  }, []);

  const handleOpen = () => {
    setOpen((o) => !o);
    if (!open) setUnread(0);
  };

  const clearAll = () => setNotifications([]);

  const criticals = notifications.filter((n) => CRITICAL_TYPES.has(n.type));
  const hasUnread = unread > 0;

  return (
    <div className="relative">
      <button
        onClick={handleOpen}
        className="relative p-1.5 rounded-md text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
        title="التنبيهات"
      >
        {hasUnread ? (
          <BellRing className="w-4 h-4 text-primary animate-pulse" />
        ) : (
          <Bell className="w-4 h-4" />
        )}
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive text-destructive-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
        {!connected && (
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 bg-yellow-500 rounded-full" title="جاري الاتصال..." />
        )}
      </button>

      {open && (
        <div
          className="absolute bottom-10 right-0 w-80 bg-card border border-border rounded-lg shadow-xl z-50 flex flex-col"
          style={{ maxHeight: "70vh" }}
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2">
              <Bell className="w-3.5 h-3.5 text-primary" />
              <span className="text-xs font-semibold text-foreground">التنبيهات</span>
              {criticals.length > 0 && (
                <Badge variant="destructive" className="text-[9px] px-1.5 py-0">
                  {criticals.length} حرج
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={clearAll}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
                title="مسح الكل"
              >
                <CheckCheck className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground p-1 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="overflow-y-auto flex-1">
            {notifications.length === 0 ? (
              <div className="py-8 text-center text-xs text-muted-foreground">
                لا توجد تنبيهات حتى الآن
              </div>
            ) : (
              notifications.map((n, i) => (
                <div
                  key={i}
                  className={`px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/30 transition-colors ${
                    CRITICAL_TYPES.has(n.type) ? "bg-destructive/5" : ""
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm mt-0.5 flex-shrink-0">{eventIcon(n.type)}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground leading-relaxed break-words">
                        {n.message}
                      </p>
                      {n.accountPhone && (
                        <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                          {n.accountPhone}
                        </p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground flex-shrink-0 mt-0.5">
                      {formatTime(n.timestamp)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="px-3 py-1.5 border-t border-border flex items-center justify-between">
            <span className={`text-[10px] flex items-center gap-1 ${connected ? "text-primary" : "text-yellow-500"}`}>
              <span className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? "bg-primary" : "bg-yellow-500"}`} />
              {connected ? "متصل بالخادم" : "جاري إعادة الاتصال..."}
            </span>
            <span className="text-[10px] text-muted-foreground">{notifications.length} حدث</span>
          </div>
        </div>
      )}
    </div>
  );
}
