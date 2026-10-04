param(
    [Parameter(Mandatory = $true)][string]$GlbPath,
    [string]$UnityPath = 'C:\Program Files\Unity\Hub\Editor\6000.0.75f1\Editor\Unity.exe',
    [string]$ProjectPath = '',
    [int]$TimeoutSeconds = 600
)
$ErrorActionPreference = 'Stop'
$repositoryRoot = Split-Path -Parent $PSScriptRoot
if (-not $ProjectPath) { $ProjectPath = Join-Path $repositoryRoot '.cache\unity\project' }
$ProjectPath = [IO.Path]::GetFullPath($ProjectPath)
$GlbPath = (Resolve-Path -LiteralPath $GlbPath).Path
if (-not (Test-Path -LiteralPath $UnityPath)) { throw "Unity 6 is not installed at $UnityPath. Pass -UnityPath explicitly." }
New-Item -ItemType Directory -Force -Path $ProjectPath | Out-Null

function Invoke-Unity([string[]]$Arguments, [string]$LogFile) {
    $quoted = $Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }
    $process = Start-Process -FilePath $UnityPath -ArgumentList $quoted -PassThru -WindowStyle Hidden
    if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
        $process.Kill()
        throw "Unity timed out. Read $LogFile"
    }
    if ($process.ExitCode -ne 0) { throw "Unity exited with code $($process.ExitCode). Read $LogFile" }
}

if (-not (Test-Path -LiteralPath (Join-Path $ProjectPath 'ProjectSettings\ProjectVersion.txt'))) {
    $createLog = Join-Path $ProjectPath 'create.log'
    Invoke-Unity -Arguments @('-batchmode', '-nographics', '-quit', '-createProject', $ProjectPath, '-logFile', $createLog) -LogFile $createLog
}

$manifestPath = Join-Path $ProjectPath 'Packages\manifest.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json -AsHashtable
$manifest.dependencies['org.khronos.unitygltf'] = 'https://github.com/KhronosGroup/UnityGLTF.git#release/2.21.0'
$packagePath = (Join-Path $repositoryRoot 'integrations\unity').Replace('\', '/')
$manifest.dependencies['com.mapedit.unity'] = "file:$packagePath"
$manifest.dependencies['com.unity.shadergraph'] = '17.0.4'
$manifest | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath
$env:MAPEDIT_UNITY_GLB = $GlbPath
$logFile = Join-Path $ProjectPath 'mapedit-import.log'
$resultPath = Join-Path $ProjectPath 'mapedit-verification.json'
if (Test-Path -LiteralPath $resultPath) { Remove-Item -LiteralPath $resultPath }
Invoke-Unity -Arguments @('-batchmode', '-nographics', '-projectPath', $ProjectPath, '-executeMethod', 'Mapedit.Editor.MapeditImportVerification.Run', '-logFile', $logFile) -LogFile $logFile
if (-not (Test-Path -LiteralPath $resultPath)) { throw "Verification produced no result. Read $logFile" }
Get-Content -LiteralPath $resultPath
