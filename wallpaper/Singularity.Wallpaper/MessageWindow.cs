namespace Singularity.Wallpaper;

internal sealed class MessageWindow : Form
{
    private const int Hotkey = 0xB01;
    private readonly uint taskbarCreated = Native.RegisterWindowMessage("TaskbarCreated");
    internal event Action? ToggleControls;
    internal event Action? DesktopChanged;

    internal MessageWindow()
    {
        ShowInTaskbar = false;
        Text = "Singularity message window";
        _ = Handle;
        if (!Native.RegisterHotKey(Handle, Hotkey, 0x4003, 'B'))
            Log.Info("Ctrl+Alt+B is already registered by another application; the tray controls remain available.");
    }

    protected override void WndProc(ref Message message)
    {
        if (message.Msg == Native.WmHotkey && message.WParam == Hotkey) ToggleControls?.Invoke();
        if (message.Msg == taskbarCreated || message.Msg == 0x7E) DesktopChanged?.Invoke();
        base.WndProc(ref message);
    }

    protected override void Dispose(bool disposing)
    {
        if (IsHandleCreated) Native.UnregisterHotKey(Handle, Hotkey);
        base.Dispose(disposing);
    }
}
