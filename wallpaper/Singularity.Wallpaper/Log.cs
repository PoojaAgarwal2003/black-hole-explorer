namespace Singularity.Wallpaper;

internal static class Log
{
    internal static readonly string DirectoryPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Singularity");
    private static readonly object Gate = new();

    internal static void Info(string message)
    {
        lock (Gate)
        {
            Directory.CreateDirectory(DirectoryPath);
            string file = Path.Combine(DirectoryPath, "wallpaper.log");
            if (File.Exists(file) && new FileInfo(file).Length > 1_000_000)
                File.Move(file, file + ".previous", true);
            File.AppendAllText(file, $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
    }

    internal static void Error(string message, Exception error) => Info($"{message}{Environment.NewLine}{error}");
}
