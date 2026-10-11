import { AnimatePresence, motion } from "framer-motion";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Backdrop } from "./components/Backdrop";
import { BoostButton, ConfirmRevert, Toasts } from "./components/Overlays";
import { PAGES, SETTINGS_PAGE, Sidebar, type PageId } from "./components/Sidebar";
import { Splash } from "./components/Splash";
import { TitleBar } from "./components/TitleBar";
import { PageHeader } from "./components/ui";
import { api, demoParams, errorText, isTauri, SHOT_MODE } from "./lib/api";
import { useBoost, useNetMonitor, useToasts } from "./lib/hooks";
import { useSettings } from "./lib/theme";
import { useAppData } from "./lib/useAppData";
import { GamesPage } from "./pages/GamesPage";
import { HomePage } from "./pages/HomePage";
import { NetworkPage } from "./pages/NetworkPage";
import { PcPage } from "./pages/PcPage";
import { SettingsPage, type UpdateState } from "./pages/SettingsPage";
import { TweaksPage } from "./pages/TweaksPage";

const SPLASH_MIN_MS = 1400;
const SPLASH_MAX_MS = 8000;

export default function App() {
  const { toasts, push } = useToasts();
  const boost = useBoost(push);
  const data = useAppData(push);
  const [pingHost, setPingHost] = useState("1.1.1.1");
  const net = useNetMonitor(pingHost);
  const settingsApi = useSettings();
  const { settings } = settingsApi;
  const [update, setUpdate] = useState<UpdateState>({ status: "idle", info: null });

  const checkUpdate = useCallback(async (quiet = false) => {
    setUpdate((u) => ({ ...u, status: "checking" }));
    try {
      const info = await api.checkUpdate();
      setUpdate({ status: "done", info });
      if (quiet && info.available) push("info", `FreshOptimizer ${info.latest} is available. Open Settings to update.`);
    } catch (e) {
      setUpdate({ status: "error", info: null, error: errorText(e) });
    }
  }, [push]);

  const [page, setPage] = useState<PageId>(() => (demoParams.get("page") as PageId) || "home");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [minElapsed, setMinElapsed] = useState(false);
  const [maxElapsed, setMaxElapsed] = useState(false);

  useEffect(() => {
    const a = window.setTimeout(() => setMinElapsed(true), SPLASH_MIN_MS);
    const b = window.setTimeout(() => setMaxElapsed(true), SPLASH_MAX_MS);
    return () => {
      window.clearTimeout(a);
      window.clearTimeout(b);
    };
  }, []);
  const showSplash = !SHOT_MODE && !maxElapsed && !(minElapsed && data.loadStep === "ready");

  // One-time launch behaviours from Settings, once the first scan is done.
  const launched = useRef(false);
  const { boost: runBoost } = boost;
  useEffect(() => {
    if (launched.current || data.loadStep !== "ready" || boost.tweaks.length === 0) return;
    launched.current = true;
    if (settings.checkUpdates && !SHOT_MODE) checkUpdate(true);
    if (settings.autoBoost && boost.phase === "idle") runBoost();
  }, [data.loadStep, boost.tweaks.length, boost.phase, settings.checkUpdates, settings.autoBoost, checkUpdate, runBoost]);

  // Pick up timer/power changes after boost state moves.
  const { refresh } = data;
  useEffect(() => {
    if (boost.phase === "active" || boost.phase === "idle") refresh();
  }, [boost.phase, boost.engine?.activeGames.length, boost.engine?.timerHeld, refresh]);

  const queue = boost.tweaks.filter((t) => boost.enabled.has(t.id));
  const doneCount = queue.filter((t) => ["applied", "skipped", "failed"].includes(boost.tasks[t.id]?.state ?? "")).length;
  const undoAvailable = !!boost.restore?.exists && boost.phase !== "boosting";
  const meta = page === "settings" ? SETTINGS_PAGE : PAGES.find((p) => p.id === page)!;

  return (
    <div className="flex h-full flex-col">
      <Backdrop settings={settings} image={settingsApi.image} />
      <TitleBar />

      <div className="flex min-h-0 flex-1 gap-4 px-4 pb-4 pt-1">
        <Sidebar active={page} onSelect={setPage} onUndo={() => setConfirmOpen(true)} undoAvailable={undoAvailable} updateAvailable={!!update.info?.available} />

        <main className="flex min-w-0 flex-1 flex-col pb-[78px]">
          <PageHeader
            title={meta.label}
            subtitle={meta.subtitle}
            action={
              <div className="flex items-center gap-2">
                {!isTauri && !SHOT_MODE && <span className="chip border-warn/30 bg-warn/10 text-warn">Demo mode</span>}
                {data.system && !data.system.isAdmin && !SHOT_MODE && (
                  <span className="chip border-crimson-line bg-crimson/10 text-crimson-400" title="Right-click FreshOptimizer and choose Run as administrator">
                    <ShieldAlert size={12} /> Run as admin for full effect
                  </span>
                )}
                <span className="chip border-obsidian-line bg-white/[0.03] text-slate-muted" title="No injection, no memory reading, no hooks. Safe with Vanguard, VAC and Easy Anti-Cheat.">
                  <ShieldCheck size={12} /> Anti-cheat safe
                </span>
              </div>
            }
          />

          {/* Swap instantly and fade the new page in: navigation never waits on an animation. */}
          <motion.div
            key={page}
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ type: "spring", bounce: 0, duration: 0.25 }}
          >
              {page === "home" && <HomePage boost={boost} data={data} net={net} goTo={setPage} notify={push} />}
              {page === "games" && <GamesPage boost={boost} data={data} notify={push} />}
              {page === "network" && <NetworkPage data={data} net={net} pingHost={pingHost} setPingHost={setPingHost} notify={push} />}
              {page === "pc" && <PcPage data={data} notify={push} />}
              {page === "tweaks" && <TweaksPage boost={boost} onUndo={() => setConfirmOpen(true)} />}
              {page === "settings" && <SettingsPage s={settingsApi} update={update} onCheck={() => checkUpdate(false)} notify={push} />}
          </motion.div>
        </main>
      </div>

      <BoostButton phase={boost.phase} progress={`${doneCount}/${queue.length}`} onBoost={boost.boost} onStop={boost.stop} />
      <ConfirmRevert
        open={confirmOpen}
        entries={boost.restore?.entryCount ?? 0}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false);
          boost.revert();
        }}
      />
      <Toasts toasts={toasts} />
      <AnimatePresence>{showSplash && <Splash step={data.loadStep} />}</AnimatePresence>
    </div>
  );
}
