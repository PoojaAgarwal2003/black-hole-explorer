using System.Runtime.InteropServices;

namespace Singularity.Wallpaper;

internal sealed class DesktopInput : IDisposable
{
    private readonly Native.HookProc callback;
    private readonly Control dispatcher;
    private readonly DesktopHost desktop;
    private readonly Action<object> send;
    private readonly nint hook;
    private Native.Point? down, last;
    private long downTime, lastMoveTime;
    private bool altDrag, disposed, dragged;
    internal bool Enabled { get; set; } = true;

    internal DesktopInput(Control dispatcher, DesktopHost desktop, Action<object> send)
    {
        this.dispatcher = dispatcher;
        this.desktop = desktop;
        this.send = send;
        callback = OnMouse;
        hook = Native.SetWindowsHookEx(14, callback, Native.GetModuleHandle(null), 0);
        Native.Require(hook != 0, "Unable to observe desktop mouse input.");
    }

    private nint OnMouse(int code, nint message, nint data)
    {
        if (code >= 0 && Enabled && !disposed)
        {
            int kind = (int)message;
            if (kind is Native.WmLeftDown or Native.WmLeftUp or Native.WmMouseWheel ||
                kind == Native.WmMouseMove && down.HasValue)
            {
                Native.MouseData mouse = Marshal.PtrToStructure<Native.MouseData>(data);
                bool alt = (Native.GetAsyncKeyState(0x12) & 0x8000) != 0;
                if (kind != Native.WmMouseMove || Environment.TickCount64 - lastMoveTime >= 16)
                {
                    if (kind == Native.WmMouseMove) lastMoveTime = Environment.TickCount64;
                    dispatcher.BeginInvoke(() => Process(kind, mouse, alt));
                }
            }
        }
        // Never consume a mouse event: Explorer still receives clicks, selection, menus, and icon drags.
        return Native.CallNextHookEx(hook, code, message, data);
    }

    private void Process(int kind, Native.MouseData mouse, bool alt)
    {
        if (disposed || !Enabled) { down = null; altDrag = false; return; }
        Native.Point point = mouse.Point;
        if (kind == Native.WmLeftDown)
        {
            down = desktop.IsEmptyDesktopPoint(point) ? point : null;
            last = down;
            downTime = Environment.TickCount64;
            altDrag = down.HasValue && alt;
            dragged = false;
        }
        else if (kind == Native.WmMouseMove && down.HasValue && last.HasValue)
        {
            dragged |= Math.Abs(point.X - down.Value.X) > 5 || Math.Abs(point.Y - down.Value.Y) > 5;
            double dx = (point.X - last.Value.X) / (double)desktop.Bounds.Width;
            double dy = (point.Y - last.Value.Y) / (double)desktop.Bounds.Height;
            last = point;
            if (altDrag) send(new { type = "orbit", dx = Math.Clamp(dx, -1, 1), dy = Math.Clamp(dy, -1, 1) });
        }
        else if (kind == Native.WmLeftUp)
        {
            if (down.HasValue && !altDrag && !dragged && Environment.TickCount64 - downTime < 600 &&
                Math.Abs(point.X - down.Value.X) <= 5 && Math.Abs(point.Y - down.Value.Y) <= 5 &&
                desktop.IsEmptyDesktopPoint(point))
            {
                send(new
                {
                    type = "launch-at",
                    x = (point.X - desktop.Bounds.Left) / (double)desktop.Bounds.Width,
                    y = (point.Y - desktop.Bounds.Top) / (double)desktop.Bounds.Height,
                });
            }
            down = null;
            last = null;
            altDrag = false;
        }
        else if (kind == Native.WmMouseWheel && alt && desktop.IsEmptyDesktopPoint(point))
        {
            short delta = unchecked((short)(mouse.Data >> 16));
            send(new { type = "zoom", factor = Math.Clamp(Math.Exp(-delta * 0.001), 0.1, 10) });
        }
    }

    public void Dispose()
    {
        disposed = true;
        if (!Native.UnhookWindowsHookEx(hook)) Log.Info("The desktop input hook had already been removed.");
    }
}
