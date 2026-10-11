const T = window.__TAURI__;
  const invoke = T.core.invoke;
  const win = T.window.getCurrentWindow();
  const $ = (id) => document.getElementById(id);
  const RING = 1232;
  let info = null, installedDir = null, retry = null;
  const opts = { desktop: true, startMenu: true };

  $("min").onclick = () => win.minimize();
  $("close").onclick = () => win.close();

  function show(id) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("on", s.id === id));
  }
  function ring(pct) { $("ring").style.strokeDashoffset = RING * (1 - pct / 100); }
  function setProgress(pct, label) {
    $("pct").textContent = pct; $("bar").style.width = pct + "%"; $("step").textContent = label; ring(pct);
  }

  T.event.listen("progress", (e) => setProgress(e.payload.pct, e.payload.label));

  document.querySelectorAll(".switch[data-opt]").forEach((sw) => {
    sw.onclick = () => {
      const v = sw.getAttribute("aria-checked") !== "true";
      sw.setAttribute("aria-checked", v); opts[sw.dataset.opt] = v;
    };
  });
  $("restore").onclick = () => { const s = $("restore"); s.setAttribute("aria-checked", s.getAttribute("aria-checked") !== "true"); };
  $("toggle-opts").onclick = () => { $("options").classList.toggle("open"); $("toggle-opts").classList.toggle("open"); };
  $("browse").onclick = async () => {
    const picked = await invoke("plugin:dialog|open", { options: { directory: true, defaultPath: $("dir").value, title: "Choose where to install FreshOptimizer" } });
    if (picked) $("dir").value = /\\FreshOptimizer$/i.test(picked) ? picked : picked.replace(/\\$/, "") + "\\FreshOptimizer";
  };

  function fail(err, again) {
    if (err === "app_running") { retry = again; show("s-running"); return; }
    $("err").textContent = String(err); retry = again; show("s-error"); ring(100);
  }

  async function doInstall() {
    show("s-progress"); setProgress(0, "Getting ready");
    $("p-title").textContent = info.installedVersion ? "Updating…" : "Installing…";
    try {
      installedDir = await invoke("install", { opts: { dir: $("dir").value, desktop: opts.desktop, startMenu: opts.startMenu } });
      setTimeout(() => show("s-done"), 350);
    } catch (e) { fail(e, doInstall); }
  }

  async function doUninstall() {
    show("s-progress"); setProgress(0, "Getting ready");
    $("p-title").textContent = "Uninstalling…"; $("p-lead").textContent = "Cleaning everything up.";
    try {
      const restored = await invoke("uninstall", { restore: $("restore").getAttribute("aria-checked") === "true" });
      $("udone-note").hidden = restored;
      if (!restored) $("udone-lead").textContent = "The app has been removed.";
      ring(0);
      setTimeout(() => show("s-udone"), 350);
    } catch (e) { fail(e, doUninstall); }
  }

  $("install").onclick = doInstall;
  $("uninstall").onclick = doUninstall;
  $("keep").onclick = () => win.close();
  $("launch").onclick = async () => { try { await invoke("launch_app", { dir: installedDir }); } catch {} win.close(); };
  $("finish").onclick = () => win.close();
  $("udone-close").onclick = () => invoke("finish_uninstall");
  $("retry").onclick = () => retry && retry();
  $("err-close").onclick = () => win.close();
  $("close-app").onclick = async () => { await invoke("close_app"); retry && retry(); };
  $("running-cancel").onclick = () => win.close();

  (async () => {
    info = await invoke("get_info");
    $("ver").textContent = `Version ${info.version} · ${info.installSizeMb} MB`;
    $("dir").value = info.defaultDir;
    setTimeout(() => ring(100), 250);
    if (info.mode === "uninstall") { show("s-uconfirm"); return; }
    if (info.installedVersion) {
      $("w-title").textContent = info.installedVersion === info.version ? "Reinstall FreshOptimizer" : "Update FreshOptimizer";
      $("install").textContent = info.installedVersion === info.version ? "Reinstall" : `Update to ${info.version}`;
    }
    show("s-welcome");
  })();
