using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Singularity.Wallpaper;

internal sealed class DesktopHost
{
    internal nint Parent { get; private set; }
    internal nint IconView { get; private set; }
    internal nint IconList { get; private set; }
    internal Rectangle Bounds { get; private set; }

    internal void Attach(Form wallpaper, Screen screen)
    {
        nint progman = Native.FindWindow("Progman", null);
        if (progman == 0) throw new InvalidOperationException("The Windows Explorer desktop is not available.");
        // Explorer's wallpaper WorkerW convention is undocumented; do not alter or hide its icon windows.
        Native.SendMessageTimeout(progman, 0x052C, 0xD, 0, 2, 1000, out _);
        Native.SendMessageTimeout(progman, 0x052C, 0xD, 1, 2, 1000, out _);
        Native.SendMessageTimeout(progman, 0x052C, 0, 0, 2, 1000, out _);

        nint worker = Native.FindWindowEx(progman, 0, "WorkerW", null);
        IconView = Native.FindWindowEx(progman, 0, "SHELLDLL_DefView", null);
        Native.EnumWindows((window, _) =>
        {
            nint icons = Native.FindWindowEx(window, 0, "SHELLDLL_DefView", null);
            if (icons != 0)
            {
                IconView = icons;
                if (worker == 0) worker = Native.FindWindowEx(0, window, "WorkerW", null);
            }
            return true;
        }, 0);
        if (worker == 0 || IconView == 0 || worker == Native.GetParent(IconView))
            throw new InvalidOperationException("Explorer did not provide a separate wallpaper layer. No desktop windows were hidden or replaced.");
        IconList = Native.FindWindowEx(IconView, 0, "SysListView32", null);
        Parent = worker;

        nint style = Native.GetWindowLongPtr(wallpaper.Handle, Native.GwlStyle);
        Marshal.SetLastPInvokeError(0);
        Native.SetWindowLongPtr(wallpaper.Handle, Native.GwlStyle, (nint)((style.ToInt64() & ~Native.WsPopup) | Native.WsChild));
        if (Marshal.GetLastPInvokeError() != 0) throw new Win32Exception(Marshal.GetLastPInvokeError(), "Unable to make the wallpaper a child window.");
        Marshal.SetLastPInvokeError(0);
        Native.SetParent(wallpaper.Handle, Parent);
        if (Native.GetParent(wallpaper.Handle) != Parent)
            throw new Win32Exception(Marshal.GetLastPInvokeError(), "Unable to attach to the desktop wallpaper layer.");
        Position(wallpaper, screen);
        Log.Info($"Attached wallpaper to {Native.ClassName(Parent)} 0x{Parent:X}; icons visible: {Native.IsWindowVisible(IconList)}.");
    }

    internal void Position(Form wallpaper, Screen screen)
    {
        Bounds = screen.Bounds;
        var origin = new Native.Point(Bounds.Left, Bounds.Top);
        Native.MapWindowPoints(0, Parent, ref origin, 1);
        Native.Require(Native.SetWindowPos(wallpaper.Handle, 1, origin.X, origin.Y, Bounds.Width, Bounds.Height,
            Native.SwpNoActivate | Native.SwpShowWindow | Native.SwpFrameChanged), "Unable to position wallpaper.");
    }

    internal bool IsAttached(Form wallpaper) => !wallpaper.IsDisposed && wallpaper.IsHandleCreated &&
        Native.IsWindow(Parent) && Native.IsWindow(wallpaper.Handle) && Native.GetParent(wallpaper.Handle) == Parent;

    internal bool IsDesktopPoint(Native.Point point)
    {
        if (!Bounds.Contains(point.X, point.Y)) return false;
        nint window = Native.WindowFromPhysicalPoint(point);
        nint iconParent = Native.GetParent(IconView);
        for (int depth = 0; window != 0 && depth < 16; depth++)
        {
            if (window == IconView || window == IconList || window == Parent || window == iconParent) return true;
            window = Native.GetParent(window);
        }
        return false;
    }

    internal bool IsEmptyDesktopPoint(Native.Point point) => IsEmptyDesktopPoint(point, out _);

    internal bool IsEmptyDesktopPoint(Native.Point point, out int? roleNumber)
    {
        roleNumber = null;
        if (!IsDesktopPoint(point)) return false;
        Accessibility.IAccessible? accessible = null;
        try
        {
            int hr = Native.AccessibleObjectFromPoint(point, out accessible, out object child);
            if (hr < 0 || accessible is null)
            {
                Log.Info($"Desktop accessibility hit-test was unavailable (0x{hr:X}); ignoring this click.");
                return false;
            }
            object role = accessible.get_accRole(child);
            roleNumber = role is int value ? value : null;
            // A list item or icon is never treated as empty desktop. No icon names or input are recorded.
            return role is int number && number is 9 or 10 or 16 or 33;
        }
        catch (COMException error)
        {
            Log.Error("Desktop hit-test failed; click was not forwarded.", error);
            return false;
        }
        finally
        {
            if (accessible is not null && Marshal.IsComObject(accessible)) Marshal.ReleaseComObject(accessible);
        }
    }
}
