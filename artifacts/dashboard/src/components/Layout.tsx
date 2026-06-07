import { Link, useLocation } from "wouter";
import { 
  LayoutDashboard, 
  Users, 
  Link as LinkIcon, 
  ActivitySquare, 
  Database,
  Activity,
  Settings,
  BarChart2
} from "lucide-react";
import { useHealthCheck } from "@workspace/api-client-react";
import { NotificationBell } from "./NotificationBell";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: health } = useHealthCheck();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Accounts", href: "/accounts", icon: Users },
    { name: "Group Links", href: "/links", icon: LinkIcon },
    { name: "Join History", href: "/jobs", icon: ActivitySquare },
    { name: "Collections", href: "/collections", icon: Database },
    { name: "Analytics", href: "/analytics", icon: BarChart2 },
    { name: "Settings", href: "/settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row dark">
      {/* Sidebar */}
      <div className="w-full md:w-64 bg-sidebar border-r border-sidebar-border flex-shrink-0 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
          <div className="flex items-center gap-2 text-primary">
            <Activity className="w-6 h-6" />
            <span className="font-mono font-bold text-lg tracking-tight">TG_ROTATOR</span>
          </div>
        </div>
        
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.name} href={item.href}>
                <span className={`flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors cursor-pointer ${
                  isActive 
                    ? "bg-primary/10 text-primary border border-primary/20" 
                    : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                }`}>
                  <item.icon className={`w-4 h-4 ${isActive ? "text-primary" : "text-sidebar-foreground/50"}`} />
                  {item.name}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${health?.status === 'ok' ? 'bg-primary shadow-[0_0_8px_var(--color-primary)]' : 'bg-destructive'}`} />
              <span className="text-muted-foreground">API: {health?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
            <NotificationBell />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-background">
        <main className="flex-1 overflow-y-auto p-6 md:p-8">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
