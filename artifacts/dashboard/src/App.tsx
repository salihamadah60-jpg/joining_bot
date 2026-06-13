import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import NotFound from "@/pages/not-found";

import Dashboard from "@/pages/Dashboard";
import Accounts from "@/pages/Accounts";
import Links from "@/pages/Links";
import Jobs from "@/pages/Jobs";
import Collections from "@/pages/Collections";
import Settings from "@/pages/Settings";
import Analytics from "@/pages/Analytics";
import Channels from "@/pages/Channels";
import Review from "@/pages/Review";
import InviteRequests from "@/pages/InviteRequests";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/accounts" component={Accounts} />
        <Route path="/links" component={Links} />
        <Route path="/jobs" component={Jobs} />
        <Route path="/collections" component={Collections} />
        <Route path="/channels" component={Channels} />
        <Route path="/review" component={Review} />
        <Route path="/invite-requests" component={InviteRequests} />
        <Route path="/settings" component={Settings} />
        <Route path="/analytics" component={Analytics} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
