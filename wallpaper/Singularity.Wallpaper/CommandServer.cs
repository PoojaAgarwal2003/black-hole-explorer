using System.IO.Pipes;
using System.Security.Principal;
using System.Text.Json;

namespace Singularity.Wallpaper;

internal sealed class CommandServer : IDisposable
{
    internal static string PipeName => $"Singularity.Wallpaper.{WindowsIdentity.GetCurrent().User!.Value}";
    private readonly CancellationTokenSource cancellation = new();
    private readonly Control dispatcher;
    private readonly Func<JsonElement, Task<object>> handle;
    private readonly Task loop;

    internal CommandServer(Control dispatcher, Func<JsonElement, Task<object>> handle)
    {
        this.dispatcher = dispatcher;
        this.handle = handle;
        loop = RunAsync();
    }

    private async Task RunAsync()
    {
        while (!cancellation.IsCancellationRequested)
        {
            try
            {
                using var pipe = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
                await pipe.WaitForConnectionAsync(cancellation.Token).ConfigureAwait(false);
                using var reader = new StreamReader(pipe, leaveOpen: true);
                using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
                string? line = await reader.ReadLineAsync(cancellation.Token).AsTask().WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false);
                if (line is null || line.Length > 8192) throw new InvalidDataException("Invalid wallpaper command length.");
                using JsonDocument document = JsonDocument.Parse(line);
                JsonElement command = document.RootElement.Clone();
                var response = new TaskCompletionSource<object>(TaskCreationOptions.RunContinuationsAsynchronously);
                dispatcher.BeginInvoke(async () =>
                {
                    try { response.SetResult(await handle(command)); }
                    catch (Exception error)
                    {
                        Log.Error("Wallpaper command failed.", error);
                        response.SetResult(new { ok = false, error = error.Message });
                    }
                });
                object result = await response.Task.WaitAsync(TimeSpan.FromSeconds(45), cancellation.Token).ConfigureAwait(false);
                await writer.WriteLineAsync(JsonSerializer.Serialize(result)).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { break; }
            catch (Exception error) when (error is IOException or JsonException or TimeoutException)
            {
                Log.Error("A local wallpaper command connection failed.", error);
            }
        }
    }

    internal static async Task ShowExistingAsync()
    {
        using var pipe = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
        await pipe.ConnectAsync(3000);
        using var writer = new StreamWriter(pipe, leaveOpen: true) { AutoFlush = true };
        using var reader = new StreamReader(pipe, leaveOpen: true);
        await writer.WriteLineAsync("{\"command\":\"show\"}");
        string? response = await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(45));
        using JsonDocument document = JsonDocument.Parse(response ?? throw new IOException("The running wallpaper did not respond."));
        if (!document.RootElement.GetProperty("ok").GetBoolean()) throw new IOException("The running wallpaper could not open its control room.");
    }

    public void Dispose()
    {
        cancellation.Cancel();
        _ = loop.ContinueWith(task =>
        {
            if (task.Exception is not null) Log.Error("Wallpaper command server stopped unexpectedly.", task.Exception);
            cancellation.Dispose();
        }, TaskScheduler.Default);
    }
}
