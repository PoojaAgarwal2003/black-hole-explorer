param(
    [ValidateSet('Build', 'Start', 'Stop', 'Show', 'Hide', 'Status', 'Pause', 'Resume', 'Launch', 'Snapshot', 'SelfTest', 'HitTest')]
    [string]$Action = 'Start',
    [double]$X = 0.78,
    [double]$Y = 0.32
)

$ErrorActionPreference = 'Stop'
$project = Join-Path $PSScriptRoot 'wallpaper\Singularity.Wallpaper\Singularity.Wallpaper.csproj'
$published = Join-Path $PSScriptRoot 'wallpaper\publish'
$executable = Join-Path $published 'Singularity.Wallpaper.exe'

if ($Action -eq 'Build') {
    Push-Location $PSScriptRoot
    try {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            $node = Join-Path $env:USERPROFILE '.copilot\tools\node-v24.21.0-win-x64'
            if (-not (Test-Path (Join-Path $node 'node.exe'))) { throw 'Node.js 22.12+ is required to build the website.' }
            $env:Path = "$node;$env:Path"
        }
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Website build failed.' }
        $assets = Join-Path (Split-Path $project) 'obj\project.assets.json'
        if (-not (Test-Path $assets)) {
            $cache = Join-Path $env:USERPROFILE '.nuget\packages'
            if (Test-Path (Join-Path $cache 'microsoft.web.webview2\1.0.2903.40')) {
                & dotnet restore $project --source $cache
            }
            else { & dotnet restore $project }
            if ($LASTEXITCODE -ne 0) { throw 'Native dependency restore failed.' }
        }
        & dotnet publish $project -c Release -o $published --no-restore
        if ($LASTEXITCODE -ne 0) { throw 'Native publish failed. Run dotnet restore on the wallpaper project first.' }
        Write-Output "Built $executable"
    }
    finally { Pop-Location }
    return
}
if ($Action -eq 'Start') {
    if (-not (Test-Path $executable)) { throw 'Build the native wallpaper first: .\wallpaper.ps1 -Action Build' }
    Start-Process -FilePath $executable -WorkingDirectory $published
    return
}

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$pipe = [System.IO.Pipes.NamedPipeClientStream]::new('.', "Singularity.Wallpaper.$identity", [System.IO.Pipes.PipeDirection]::InOut)
try {
    $pipe.Connect(3000)
    $writer = [System.IO.StreamWriter]::new($pipe, [System.Text.UTF8Encoding]::new($false), 1024, $true)
    $reader = [System.IO.StreamReader]::new($pipe, [System.Text.Encoding]::UTF8, $false, 1024, $true)
    try {
        $command = switch ($Action) { 'Stop' { 'exit' } 'SelfTest' { 'self-test' } 'HitTest' { 'hit-test' } default { $Action.ToLowerInvariant() } }
        $payload = @{ command = $command }
        if ($Action -in @('Launch', 'HitTest')) { $payload.x = $X; $payload.y = $Y }
        $writer.WriteLine(($payload | ConvertTo-Json -Compress))
        $writer.Flush()
        $responseTask = $reader.ReadLineAsync()
        if (-not $responseTask.Wait(50000)) { throw 'The wallpaper did not respond within 50 seconds.' }
        $response = $responseTask.Result | ConvertFrom-Json
        if (-not $response.ok) { throw $response.error }
        $response | ConvertTo-Json -Depth 10
    }
    finally { $writer.Dispose(); $reader.Dispose() }
}
finally { $pipe.Dispose() }
