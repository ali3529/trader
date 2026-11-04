import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { BotProvider } from "@/context/BotContext";
import AppShell from "@/components/layout/AppShell";
import BasicAuthDialog from "@/components/BasicAuthDialog";
import Index from "./pages/Index";
import Opportunities from "./pages/Opportunities";
import Positions from "./pages/Positions";
import Trades from "./pages/Trades";
import Backtest from "./pages/Backtest";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BasicAuthDialog />
      <BotProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppShell />}>
              <Route path="/" element={<Index />} />
              <Route path="/opportunities" element={<Opportunities />} />
              <Route path="/positions" element={<Positions />} />
              <Route path="/trades" element={<Trades />} />
              <Route path="/backtest" element={<Backtest />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
            </Route>
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </BotProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
