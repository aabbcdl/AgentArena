import { Component, type ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { Shell } from "./components/Shell";
import { Notice } from "./components/ui";
import { useWorkbench, WorkbenchProvider } from "./hooks/useWorkbench";

const PlanPage = lazy(() => import("./pages/PlanPage").then((m) => ({ default: m.PlanPage })));
const LivePage = lazy(() => import("./pages/LivePage").then((m) => ({ default: m.LivePage })));
const OutcomePage = lazy(() => import("./pages/OutcomePage").then((m) => ({ default: m.OutcomePage })));
const EvidencePage = lazy(() => import("./pages/EvidencePage").then((m) => ({ default: m.EvidencePage })));
const ComparePage = lazy(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const LibraryPage = lazy(() => import("./pages/LibraryPage").then((m) => ({ default: m.LibraryPage })));
const EnvironmentPage = lazy(() => import("./pages/EnvironmentPage").then((m) => ({ default: m.EnvironmentPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const RunsPage = lazy(() => import("./pages/RunsPage").then((m) => ({ default: m.RunsPage })));

class ErrorBoundary extends Component<{ children: ComponentChildren }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error("[workbench] page render failed", error); }
  render() {
    if (this.state.error) return <div class="fatal-error"><Notice kind="danger"><strong>Page unavailable / 页面不可用</strong><span>{this.state.error.message}</span></Notice><button class="button secondary" type="button" onClick={() => { this.setState({ error: null }); window.location.hash = "/runs"; }}>Return to Runs / 返回运行</button></div>;
    return this.props.children;
  }
}

function CurrentPage() {
  const { page } = useWorkbench();
  const fallback = <div class="page-content"><div class="skeleton-lines large"><span/><span/></div></div>;
  return (
    <Suspense fallback={fallback}>
      {page === "plan" ? <PlanPage/> : null}
      {page === "live" ? <LivePage/> : null}
      {page === "outcome" ? <OutcomePage/> : null}
      {page === "evidence" ? <EvidencePage/> : null}
      {page === "compare" ? <ComparePage/> : null}
      {page === "library" ? <LibraryPage/> : null}
      {page === "environment" ? <EnvironmentPage/> : null}
      {page === "settings" ? <SettingsPage/> : null}
      {page === "runs" || (!page) ? <RunsPage/> : null}
    </Suspense>
  );
}

export function App() {
  return <ErrorBoundary><WorkbenchProvider><Shell><CurrentPage/></Shell></WorkbenchProvider></ErrorBoundary>;
}
