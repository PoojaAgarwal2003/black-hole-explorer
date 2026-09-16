using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using System.Text.Json;
using System.ComponentModel;

namespace Singularity.Wallpaper;

internal sealed class BrowserForm : Form
{
    internal readonly WebView2 Browser = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(8, 10, 12) };
    internal readonly TaskCompletionSource Ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly bool wallpaper;
    [DesignerSerializationVisibility(DesignerSerializationVisibility.Hidden)]
    internal bool AllowClose { get; set; }
    internal event Action<JsonElement>? MessageReceived;
    internal event Action<string>? BrowserFailed;

    internal BrowserForm(bool wallpaper)
    {
        this.wallpaper = wallpaper;
        Text = wallpaper ? "Singularity live wallpaper" : "Singularity - Control room";
        BackColor = Color.FromArgb(14, 16, 19);
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        FormBorderStyle = wallpaper ? FormBorderStyle.None : FormBorderStyle.SizableToolWindow;
        if (!wallpaper) MinimumSize = new Size(340, 620);
        Controls.Add(Browser);
    }

    protected override bool ShowWithoutActivation => wallpaper;

    protected override CreateParams CreateParams
    {
        get
        {
            CreateParams result = base.CreateParams;
            result.ExStyle |= Native.WsExToolWindow;
            if (wallpaper) result.ExStyle |= Native.WsExNoActivate | Native.WsExTransparent;
            return result;
        }
    }

    protected override void WndProc(ref Message message)
    {
        if (wallpaper && message.Msg == Native.WmMouseActivate)
        {
            message.Result = Native.MaNoActivate;
            return;
        }
        base.WndProc(ref message);
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!wallpaper && !AllowClose && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
        }
        base.OnFormClosing(e);
    }

    internal async Task InitializeAsync(CoreWebView2Environment environment, string assets)
    {
        await Browser.EnsureCoreWebView2Async(environment);
        CoreWebView2 core = Browser.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("singularity.local", assets, CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreBrowserAcceleratorKeysEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.IsMuted = true;
        core.PermissionRequested += (_, args) => args.State = CoreWebView2PermissionState.Deny;
        core.NewWindowRequested += (_, args) => args.Handled = true;
        core.NavigationStarting += (_, args) =>
        {
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out Uri? uri) || uri.Scheme != "https" || uri.Host != "singularity.local")
                args.Cancel = true;
        };
        core.NavigationCompleted += (_, args) =>
        {
            if (!args.IsSuccess) Ready.TrySetException(new InvalidOperationException($"Wallpaper navigation failed: {args.WebErrorStatus}"));
        };
        core.ProcessFailed += (_, args) => BrowserFailed?.Invoke($"WebView2 process failed: {args.ProcessFailedKind}");
        core.WebMessageReceived += (_, args) =>
        {
            if (!Uri.TryCreate(args.Source, UriKind.Absolute, out Uri? source) || source.Host != "singularity.local" || source.Scheme != "https") return;
            try
            {
                using JsonDocument document = JsonDocument.Parse(args.WebMessageAsJson);
                JsonElement message = document.RootElement.Clone();
                if (message.TryGetProperty("type", out JsonElement type) && type.GetString() == "ready") Ready.TrySetResult();
                MessageReceived?.Invoke(message);
            }
            catch (JsonException error)
            {
                Log.Error("WebView2 sent an invalid message.", error);
                BrowserFailed?.Invoke("The wallpaper sent an invalid message.");
            }
        };
        core.DownloadStarting += (_, args) =>
        {
            using var picker = new SaveFileDialog
            {
                Title = "Save Singularity observation", Filter = "PNG image|*.png",
                FileName = $"singularity-{DateTime.Now:yyyyMMdd-HHmmss}.png",
            };
            args.Handled = true;
            if (picker.ShowDialog(this) == DialogResult.OK) args.ResultFilePath = picker.FileName;
            else args.Cancel = true;
        };
        Browser.Source = new Uri($"https://singularity.local/index.html?view={(wallpaper ? "wallpaper" : "controls")}");
        await Ready.Task.WaitAsync(TimeSpan.FromSeconds(45));
        int dark = 1;
        Native.DwmSetWindowAttribute(Handle, 20, ref dark, sizeof(int));
    }

    internal void Send(object message)
    {
        if (Browser.CoreWebView2 is null || IsDisposed) throw new InvalidOperationException("The wallpaper browser is not ready.");
        Browser.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(message));
    }

    internal async Task<string> CaptureAsync(string prefix)
    {
        string directory = Path.Combine(Log.DirectoryPath, "captures");
        Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, $"{prefix}-{DateTime.Now:yyyyMMdd-HHmmss-fff}.png");
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write);
        await Browser.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        return path;
    }
}
