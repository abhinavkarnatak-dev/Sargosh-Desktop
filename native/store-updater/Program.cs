using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Windows.ApplicationModel;
using Windows.Services.Store;

// Runs under the MSIX identity on an STA UI thread with a message pump.
// Windows owns package selection, download consent, signature checks and installation.
internal static class Program
{
    [STAThread]
    private static void Main()
    {
        Console.InputEncoding = Encoding.UTF8;
        Console.OutputEncoding = new UTF8Encoding(false);
        Application.EnableVisualStyles();
        Application.Run(new Bridge());
    }
}

[ComImport, Guid("3D3A2904-FB27-4EAF-AD23-C6505A7C154F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IInitializeWithWindow { void Initialize(IntPtr hwnd); }

internal sealed class Bridge : ApplicationContext
{
    private readonly Control dispatcher = new Control { Visible = false };
    private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 8192 };
    private readonly object outputLock = new object();
    private StoreContext context;
    private StorePackageUpdate[] updates = new StorePackageUpdate[0];
    private bool downloaded, busy;
    private string aumid;

    public Bridge()
    {
        var handle = dispatcher.Handle;
        SynchronizationContext.SetSynchronizationContext(new WindowsFormsSynchronizationContext());
        Task.Run(() => ReadCommands());
    }

    private void Write(object value)
    {
        lock (outputLock) { Console.WriteLine(json.Serialize(value)); Console.Out.Flush(); }
    }

    private void ReadCommands()
    {
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            if (line.Length > 4096) continue;
            try
            {
                var command = json.Deserialize<Dictionary<string, object>>(line);
                dispatcher.BeginInvoke(new Action(async () => await Execute(command)));
            }
            catch { /* Only well-formed commands from the owner process are accepted. */ }
        }
        try { dispatcher.BeginInvoke(new Action(() => ExitThread())); } catch { }
    }

    private async Task Execute(Dictionary<string, object> command)
    {
        string id = command.ContainsKey("id") ? command["id"] as string : null;
        string action = command.ContainsKey("action") ? command["action"] as string : null;
        if (id == null || id.Length > 64 || !id.All(c => Char.IsLetterOrDigit(c) || c == '-')) return;
        if (busy) { Write(new { id, ok = false, code = "BUSY" }); return; }
        busy = true;
        try
        {
            // Never run Store operations against an unpackaged, sideloaded or unrelated app.
            var package = Package.Current;
            if (package.Id.Name != "AbhinavKarnatak.Sargosh" || package.SignatureKind != PackageSignatureKind.Store)
            { Write(new { id, ok = false, code = "UNSUPPORTED" }); return; }
            aumid = package.Id.FamilyName + "!Sargosh";
            long owner;
            if (!command.ContainsKey("hwnd") || !Int64.TryParse(Convert.ToString(command["hwnd"]), out owner) || owner <= 0)
            { Write(new { id, ok = false, code = "WINDOW_UNAVAILABLE" }); return; }
            if (context == null) context = StoreContext.GetDefault();
            ((IInitializeWithWindow)(object)context).Initialize(new IntPtr(owner));

            if (action == "check")
            {
                if (!downloaded) updates = (await context.GetAppAndOptionalStorePackageUpdatesAsync()).ToArray();
                Write(new { id, ok = true, available = updates.Length > 0, downloaded, aumid });
            }
            else if (action == "download")
            {
                if (updates.Length == 0) updates = (await context.GetAppAndOptionalStorePackageUpdatesAsync()).ToArray();
                if (updates.Length == 0) { Write(new { id, ok = true, available = false, downloaded = false, aumid }); return; }
                var progress = new Progress<StorePackageUpdateStatus>(status => Write(new { id, type = "progress", progress = Math.Max(0, Math.Min(1, status.TotalDownloadProgress)) }));
                var result = await context.RequestDownloadStorePackageUpdatesAsync(updates).AsTask(CancellationToken.None, progress);
                downloaded = result.OverallState == StorePackageUpdateState.Completed;
                Report(id, result, downloaded ? "downloaded" : "available");
            }
            else if (action == "install")
            {
                if (!downloaded || updates.Length == 0) { Write(new { id, ok = false, code = "NOT_DOWNLOADED" }); return; }
                // Windows may terminate all package processes here. Electron has flushed its
                // state and registered its main process for an update restart before calling us.
                var result = await context.RequestDownloadAndInstallStorePackageUpdatesAsync(updates);
                Report(id, result, result.OverallState == StorePackageUpdateState.Completed ? "installed" : "downloaded");
            }
            else Write(new { id, ok = false, code = "INVALID_COMMAND" });
        }
        catch (InvalidOperationException) { Write(new { id, ok = false, code = "UNSUPPORTED" }); }
        catch (Exception error) { Write(new { id, ok = false, code = "STORE_ERROR", hresult = error.HResult.ToString("X8") }); }
        finally { busy = false; }
    }

    private void Report(string id, StorePackageUpdateResult result, string state)
    {
        if (result.OverallState == StorePackageUpdateState.Completed)
            Write(new { id, ok = true, available = true, downloaded, state, aumid });
        else if (result.OverallState == StorePackageUpdateState.Canceled)
            Write(new { id, ok = false, code = "CANCELLED" });
        else Write(new { id, ok = false, code = "STORE_ERROR", storeState = result.OverallState.ToString() });
    }
}
