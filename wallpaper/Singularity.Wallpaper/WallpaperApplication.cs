using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;
using System.Drawing.Drawing2D;
using System.Text.Json;
using System.Text.Json.Nodes;
using Timer = System.Windows.Forms.Timer;

namespace Singularity.Wallpaper;

internal sealed class WallpaperApplication : ApplicationContext
{
    private readonly MessageWindow messages = new();
    private readonly DesktopHost desktop = new();
    private readonly Timer timer = new() { Interval = 2000 };
    private readonly NotifyIcon tray;
    private readonly Icon trayIcon;
    private readonly ToolStripMenuItem pauseMenu = new("Pause animation");
    private readonly ToolStripMenuItem clickMenu = new("Desktop click-to-launch") { CheckOnClick = true, Checked = true };
    private readonly TaskCompletionSource ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly string assets = Path.Combine(AppContext.BaseDirectory, "wwwroot");
    private readonly string settingsPath = Path.Combine(Log.DirectoryPath, "settings.json");
    private CoreWebView2Environment? environment;
    private BrowserForm? wallpaper, controls;
    private DesktopInput? input;
    private CommandServer? commands;
    private Screen screen = Screen.PrimaryScreen ?? throw new InvalidOperationException("No display is available.");
    private JsonElement? settings, telemetry;
    private string? savedSettings;
    private bool shuttingDown, recovering, needsRecovery, shellChanged, sessionLocked, powerSuspended, suspended, dirty, selfTesting;
    private int recoveryFailures;

    internal WallpaperApplication()
    {
        if (!File.Exists(Path.Combine(assets, "index.html")))
            throw new FileNotFoundException("The bundled website is missing. Run wallpaper.ps1 -Action Build.");
        LoadSettings();
        trayIcon = CreateIcon();
        tray = new NotifyIcon { Icon = trayIcon, Text = "Singularity live wallpaper", Visible = true };
        tray.ContextMenuStrip = BuildTrayMenu();
        tray.DoubleClick += (_, _) => ShowControls();
        messages.ToggleControls += () => { if (controls?.Visible == true) controls.Hide(); else ShowControls(); };
        messages.DesktopChanged += () => shellChanged = true;
        timer.Tick += CheckDesktop;
        SystemEvents.SessionSwitch += SessionChanged;
        SystemEvents.PowerModeChanged += PowerChanged;
        commands = new CommandServer(messages, HandleCommandAsync);
        messages.BeginInvoke(async () =>
        {
            try
            {
                Log.Info("Starting Singularity wallpaper.");
                var options = new CoreWebView2EnvironmentOptions(
                    "--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows");
                environment = await CoreWebView2Environment.CreateAsync(null, Path.Combine(Log.DirectoryPath, "WebView2"), options);
                await CreateWallpaperAsync();
                controls = new BrowserForm(false);
                controls.BrowserFailed += BrowserFailed;
                controls.Bounds = new Rectangle(-32000, -32000, 360, 900);
                controls.Show();
                await controls.InitializeAsync(environment, assets);
                PositionControls();
                ShowControls();
                input = new DesktopInput(messages, desktop, Send) { Enabled = clickMenu.Checked };
                timer.Start();
                ready.TrySetResult();
                tray.ShowBalloonTip(5000, "Singularity is on your desktop",
                    "Icons keep working. Click empty desktop to launch probes. Ctrl+Alt+B toggles the control room. Exit from this tray icon to restore the static wallpaper.", ToolTipIcon.Info);
            }
            catch (Exception error)
            {
                ready.TrySetException(error);
                Log.Error("Wallpaper initialization failed.", error);
                ExitThread();
                MessageBox.Show($"Unable to start the wallpaper.\n\n{error.Message}\n\nYour desktop icons and original wallpaper were not changed.",
                    "Singularity", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        });
    }

    private async Task CreateWallpaperAsync()
    {
        if (environment is null) throw new InvalidOperationException("WebView2 has not initialized.");
        wallpaper = new BrowserForm(true) { Bounds = new Rectangle(-32000, -32000, screen.Bounds.Width, screen.Bounds.Height) };
        wallpaper.MessageReceived += Receive;
        wallpaper.BrowserFailed += BrowserFailed;
        wallpaper.Show();
        desktop.Attach(wallpaper, screen);
        await wallpaper.InitializeAsync(environment, assets);
    }

    private void Receive(JsonElement message)
    {
        if (!message.TryGetProperty("type", out JsonElement type)) return;
        switch (type.GetString())
        {
            case "ready":
                if (settings.HasValue) Send(new { type = "settings", settings = settings.Value });
                break;
            case "state":
                if (message.TryGetProperty("settings", out JsonElement value) && value.ValueKind == JsonValueKind.Object)
                {
                    settings = value.Clone();
                    dirty |= savedSettings != settings.Value.GetRawText();
                    pauseMenu.Checked = settings.Value.TryGetProperty("paused", out JsonElement paused) && paused.GetBoolean();
                }
                if (message.TryGetProperty("telemetry", out JsonElement stats)) telemetry = stats.Clone();
                break;
            case "error":
                BrowserFailed(message.GetProperty("message").GetString() ?? "The renderer reported an error.");
                break;
        }
    }

    private void Send(object message)
    {
        if (wallpaper is null || wallpaper.IsDisposed) throw new InvalidOperationException("The wallpaper is reconnecting to Explorer.");
        wallpaper.Send(message);
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Open control room  (Ctrl+Alt+B)", null, (_, _) => ShowControls());
        menu.Items.Add("Hide control room", null, (_, _) => controls?.Hide());
        pauseMenu.Click += (_, _) => Send(new { type = "set-paused", value = !pauseMenu.Checked });
        menu.Items.Add(pauseMenu);
        clickMenu.Click += (_, _) =>
        {
            if (input is not null) input.Enabled = clickMenu.Checked;
            dirty = true;
        };
        menu.Items.Add(clickMenu);
        var pin = new ToolStripMenuItem("Keep control room on top") { CheckOnClick = true };
        pin.Click += (_, _) => { if (controls is not null) controls.TopMost = pin.Checked; };
        menu.Items.Add(pin);
        var displays = new ToolStripMenuItem("Wallpaper display");
        for (int i = 0; i < Screen.AllScreens.Length; i++)
        {
            Screen target = Screen.AllScreens[i];
            var item = new ToolStripMenuItem($"Display {i + 1}{(target.Primary ? " (primary)" : "")}");
            item.Click += (_, _) =>
            {
                screen = target;
                shellChanged = true;
                PositionControls();
            };
            displays.DropDownItems.Add(item);
        }
        menu.Items.Add(displays);
        menu.Items.Add("Reconnect wallpaper", null, (_, _) => { needsRecovery = true; recoveryFailures = 0; });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Exit and restore static wallpaper", null, (_, _) => ExitThread());
        return menu;
    }

    private void PositionControls()
    {
        if (controls is null) return;
        double scale = controls.DeviceDpi / 96.0;
        int width = (int)(370 * scale);
        int margin = (int)(18 * scale);
        int height = Math.Min((int)(1000 * scale), screen.WorkingArea.Height - margin * 2);
        controls.Bounds = new Rectangle(screen.WorkingArea.Right - width - margin, screen.WorkingArea.Top + margin, width, height);
    }

    private void ShowControls()
    {
        if (controls is null || controls.IsDisposed || !controls.Ready.Task.IsCompletedSuccessfully) return;
        controls.WindowState = FormWindowState.Normal;
        controls.Show();
        controls.Activate();
        if (settings.HasValue) controls.Send(new { type = "state", settings = settings.Value });
        if (telemetry.HasValue) controls.Send(new { type = "telemetry", value = telemetry.Value });
    }

    private async void CheckDesktop(object? sender, EventArgs args)
    {
        if (shuttingDown || recovering || !ready.Task.IsCompletedSuccessfully) return;
        try
        {
            if (needsRecovery || wallpaper is null || !desktop.IsAttached(wallpaper))
            {
                if (recoveryFailures >= 5) return;
                recovering = true;
                if (wallpaper is not null)
                {
                    wallpaper.AllowClose = true;
                    wallpaper.Dispose();
                }
                await CreateWallpaperAsync();
                needsRecovery = false;
                recoveryFailures = 0;
                suspended = false;
                Log.Info("Wallpaper renderer reconnected; simulation restarted with preserved settings.");
            }
            if (shellChanged && wallpaper is not null)
            {
                screen = Screen.AllScreens.FirstOrDefault(candidate => candidate.DeviceName == screen.DeviceName) ?? Screen.PrimaryScreen!;
                desktop.Attach(wallpaper, screen);
                PositionControls();
                shellChanged = false;
            }
            bool nextSuspended = !selfTesting && (sessionLocked || powerSuspended || CoveredByForegroundWindow());
            if (nextSuspended != suspended)
            {
                suspended = nextSuspended;
                Send(new { type = "activity", active = !suspended });
            }
            if (dirty && settings.HasValue) SaveSettings();
        }
        catch (Exception error)
        {
            recoveryFailures++;
            Log.Error("Desktop reconnection failed.", error);
            tray.ShowBalloonTip(5000, "Singularity needs attention", $"{error.Message}\nUse Reconnect wallpaper in the tray menu.", ToolTipIcon.Warning);
        }
        finally { recovering = false; }
    }

    private bool CoveredByForegroundWindow()
    {
        nint foreground = Native.GetForegroundWindow();
        if (foreground == 0 || foreground == controls?.Handle || foreground == wallpaper?.Handle ||
            foreground == desktop.Parent || Native.ClassName(foreground) is "Progman" or "WorkerW" || Native.IsIconic(foreground))
            return false;
        if (!Native.GetWindowRect(foreground, out Native.Rect rect)) return false;
        Rectangle area = screen.WorkingArea;
        return rect.Left <= area.Left + 2 && rect.Top <= area.Top + 2 && rect.Right >= area.Right - 2 && rect.Bottom >= area.Bottom - 2;
    }

    private void SessionChanged(object sender, SessionSwitchEventArgs args) => messages.BeginInvoke(() =>
    {
        if (args.Reason == SessionSwitchReason.SessionLock) sessionLocked = true;
        if (args.Reason == SessionSwitchReason.SessionUnlock) sessionLocked = false;
    });

    private void PowerChanged(object sender, PowerModeChangedEventArgs args) => messages.BeginInvoke(() =>
    {
        if (args.Mode == PowerModes.Suspend) powerSuspended = true;
        if (args.Mode == PowerModes.Resume) powerSuspended = false;
    });

    private void BrowserFailed(string message)
    {
        Log.Info(message);
        needsRecovery = true;
        tray.ShowBalloonTip(5000, "Singularity renderer interrupted", message, ToolTipIcon.Warning);
    }

    private void LoadSettings()
    {
        if (!File.Exists(settingsPath)) return;
        using JsonDocument document = JsonDocument.Parse(File.ReadAllText(settingsPath));
        if (!document.RootElement.TryGetProperty("version", out JsonElement version) || version.GetInt32() != 1 ||
            !document.RootElement.TryGetProperty("settings", out JsonElement value) || value.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException($"Unsupported settings file: {settingsPath}");
        settings = value.Clone();
        savedSettings = value.GetRawText();
        if (document.RootElement.TryGetProperty("desktopClicks", out JsonElement clicks)) clickMenu.Checked = clicks.GetBoolean();
    }

    private void SaveSettings()
    {
        Directory.CreateDirectory(Log.DirectoryPath);
        string temporary = settingsPath + ".tmp";
        File.WriteAllText(temporary, JsonSerializer.Serialize(new { version = 1, settings, desktopClicks = clickMenu.Checked }));
        File.Move(temporary, settingsPath, true);
        savedSettings = settings?.GetRawText();
        dirty = false;
    }

    private object Status() => new
    {
        ok = true, ready = ready.Task.IsCompletedSuccessfully, pid = Environment.ProcessId,
        attached = wallpaper is not null && desktop.IsAttached(wallpaper),
        wallpaperHandle = wallpaper?.IsHandleCreated == true ? $"0x{wallpaper.Handle:X}" : null,
        parentHandle = $"0x{desktop.Parent:X}", parentClass = Native.ClassName(desktop.Parent),
        iconViewHandle = $"0x{desktop.IconView:X}", iconsVisible = Native.IsWindowVisible(desktop.IconList),
        controlsVisible = controls?.Visible == true, desktopClicks = input?.Enabled, suspended,
        bounds = desktop.Bounds, settings, telemetry,
    };

    private async Task<object> HandleCommandAsync(JsonElement request)
    {
        string command = request.GetProperty("command").GetString() ?? throw new InvalidDataException("Command is required.");
        if (command == "status") return Status();
        if (command == "exit")
        {
            _ = ExitSoonAsync();
            return new { ok = true };
        }
        await ready.Task.WaitAsync(TimeSpan.FromSeconds(40));
        switch (command)
        {
            case "show": ShowControls(); break;
            case "hide": controls?.Hide(); break;
            case "pause": Send(new { type = "set-paused", value = true }); break;
            case "resume": Send(new { type = "set-paused", value = false }); break;
            case "launch":
            case "hit-test":
                double x = request.GetProperty("x").GetDouble(), y = request.GetProperty("y").GetDouble();
                if (!double.IsFinite(x) || !double.IsFinite(y) || x is < 0 or > 1 || y is < 0 or > 1) throw new InvalidDataException("Launch coordinates must be between 0 and 1.");
                if (command == "hit-test")
                {
                    var point = new Native.Point(desktop.Bounds.Left + (int)(x * desktop.Bounds.Width), desktop.Bounds.Top + (int)(y * desktop.Bounds.Height));
                    bool empty = desktop.IsEmptyDesktopPoint(point, out int? role);
                    return new { ok = true, desktop = desktop.IsDesktopPoint(point), empty, role };
                }
                Send(new { type = "launch-at", x, y });
                break;
            case "snapshot": return new { ok = true, path = await wallpaper!.CaptureAsync("wallpaper") };
            case "self-test": return await SelfTestAsync();
            default: throw new InvalidDataException($"Unknown wallpaper command: {command}");
        }
        return new { ok = true };
    }

    private async Task<object> SelfTestAsync()
    {
        ShowControls();
        await Task.Delay(1200);
        if (!settings.HasValue || wallpaper is null || controls is null) throw new InvalidOperationException("The simulation is not ready.");
        JsonElement original = settings.Value.Clone();
        bool iconsBefore = Native.IsWindowVisible(desktop.IconList);
        selfTesting = true;
        try
        {
            JsonNode testSettings = JsonNode.Parse(original.GetRawText())!;
            testSettings["paused"] = true;
            Send(new { type = "settings", settings = testSettings });
            Send(new { type = "clear" });
            Send(new { type = "reset-camera" });
            Send(new { type = "activity", active = true });
            await controls.Browser.CoreWebView2.ExecuteScriptAsync("""
                (() => {
                  const input = document.querySelector('#gravity');
                  input.value = '1.3';
                  input.dispatchEvent(new Event('input', {bubbles:true}));
                })();
                """);
            await Task.Delay(1200);
            if (Math.Abs(settings.Value.GetProperty("gravity").GetDouble() - 1.3) > 0.001)
                throw new InvalidOperationException("The control room did not update the wallpaper.");
            // Send the exact command used by the filtered desktop mouse handler.
            Send(new { type = "launch-at", x = 0.78, y = 0.32 });
            await Task.Delay(900);
            JsonElement launch = telemetry!.Value.GetProperty("lastLaunch");
            if (Math.Abs(launch.GetProperty("x").GetDouble() - 0.78) > 0.001 ||
                Math.Abs(launch.GetProperty("y").GetDouble() - 0.32) > 0.001)
                throw new InvalidOperationException("The probe did not originate at the clicked screen position.");
            for (int i = 0; i < 20; i++) Send(new { type = "launch-at", x = 0.78, y = 0.32 });
            await Task.Delay(1000);
            if (telemetry.Value.GetProperty("active").GetInt32() != 16) throw new InvalidOperationException("The 16-probe cap was not preserved.");
            if (await controls.Browser.CoreWebView2.ExecuteScriptAsync("document.querySelectorAll('canvas').length") != "0")
                throw new InvalidOperationException("The control room started an unnecessary second renderer.");
            if (!desktop.IsAttached(wallpaper)) throw new InvalidOperationException("The wallpaper detached from Explorer.");
            if (Native.IsWindowVisible(desktop.IconList) != iconsBefore) throw new InvalidOperationException("Desktop icon visibility changed.");
            if (telemetry.Value.GetProperty("fps").GetInt32() <= 0) throw new InvalidOperationException("The desktop renderer is not producing frames.");
            string capture = await wallpaper.CaptureAsync("native-self-test");
            return new
            {
                ok = true,
                passed = new[] { "Explorer wallpaper parenting", "control-room state synchronization", "click-position launch", "16-probe limit", "single renderer", "icon visibility preserved", "WebView2 rendering" },
                capture, fps = telemetry.Value.GetProperty("fps").GetInt32(),
            };
        }
        finally
        {
            Send(new { type = "reset", settings = original });
            selfTesting = false;
        }
    }

    private async Task ExitSoonAsync()
    {
        await Task.Delay(250);
        ExitThread();
    }

    private static Icon CreateIcon()
    {
        using var image = new Bitmap(64, 64);
        using Graphics graphics = Graphics.FromImage(image);
        graphics.SmoothingMode = SmoothingMode.AntiAlias;
        graphics.Clear(Color.FromArgb(10, 12, 15));
        using var pen = new Pen(Color.FromArgb(244, 173, 120), 3);
        graphics.TranslateTransform(32, 32);
        graphics.RotateTransform(-25);
        graphics.DrawEllipse(pen, -29, -10, 58, 20);
        graphics.ResetTransform();
        using var fill = new SolidBrush(Color.FromArgb(8, 10, 12));
        graphics.FillEllipse(fill, 17, 17, 30, 30);
        graphics.DrawEllipse(pen, 17, 17, 30, 30);
        nint handle = image.GetHicon();
        using Icon original = Icon.FromHandle(handle);
        Icon icon = (Icon)original.Clone();
        Native.DestroyIcon(handle);
        return icon;
    }

    protected override void ExitThreadCore()
    {
        if (shuttingDown) return;
        shuttingDown = true;
        timer.Stop();
        input?.Dispose();
        commands?.Dispose();
        SystemEvents.SessionSwitch -= SessionChanged;
        SystemEvents.PowerModeChanged -= PowerChanged;
        if (settings.HasValue) SaveSettings();
        tray.Visible = false;
        controls?.Dispose();
        wallpaper?.Dispose();
        messages.Dispose();
        timer.Dispose();
        tray.Dispose();
        trayIcon.Dispose();
        Log.Info("Wallpaper stopped. Original desktop wallpaper is exposed; icon windows were not modified.");
        base.ExitThreadCore();
    }
}
