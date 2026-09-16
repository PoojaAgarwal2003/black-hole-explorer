namespace Singularity.Wallpaper;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, "Local\\Singularity.Wallpaper", out bool created);
        if (!created)
        {
            try { CommandServer.ShowExistingAsync().GetAwaiter().GetResult(); }
            catch (Exception error) when (error is IOException or TimeoutException)
            {
                MessageBox.Show($"Singularity is already starting or running.\n\n{error.Message}", "Singularity");
            }
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, args) =>
        {
            Log.Error("Unhandled wallpaper UI error.", args.Exception);
            MessageBox.Show($"The wallpaper encountered an error.\n\n{args.Exception.Message}\n\nSee {Log.DirectoryPath}\\wallpaper.log", "Singularity", MessageBoxButtons.OK, MessageBoxIcon.Error);
        };
        try
        {
            using var context = new WallpaperApplication();
            Application.Run(context);
        }
        catch (Exception error)
        {
            Log.Error("Wallpaper startup failed.", error);
            MessageBox.Show($"Unable to start Singularity.\n\n{error.Message}\n\nYour Windows wallpaper has not been replaced.", "Singularity", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
