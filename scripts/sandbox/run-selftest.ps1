# Runs FreshOptimizer's end-to-end self-test inside Windows Sandbox.
#
# Windows Sandbox is a disposable copy of Windows: every change the self-test
# makes (tweaks, Undo) happens there and disappears when the sandbox closes.
# Needs: Windows 10/11 Pro, "Windows Sandbox" feature enabled, a release build
# (npm run dist). Usage:  powershell -ExecutionPolicy Bypass -File scripts\sandbox\run-selftest.ps1

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$exe = Join-Path $root "src-tauri\target\release\freshoptimizer.exe"
if (-not (Test-Path $exe)) { throw "Build first: npm run dist" }
if (-not (Get-Command WindowsSandbox.exe -ErrorAction SilentlyContinue)) {
  throw "Windows Sandbox isn't enabled. Turn on 'Windows Sandbox' in 'Turn Windows features on or off', then restart."
}

$work = Join-Path $env:TEMP "fo-sandbox"
$bin = Join-Path $work "bin"
$results = Join-Path $work "results"
Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $bin, $results | Out-Null
Copy-Item $exe $bin

# Runs inside the sandbox (as its built-in administrator).
@'
& C:\fo\bin\freshoptimizer.exe --selftest C:\fo\results\report.json
"exit=$LASTEXITCODE" | Out-File C:\fo\results\done.txt
'@ | Out-File (Join-Path $bin "inside.ps1") -Encoding utf8

@"
<Configuration>
  <MappedFolders>
    <MappedFolder><HostFolder>$work</HostFolder><SandboxFolder>C:\fo</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand><Command>powershell -ExecutionPolicy Bypass -File C:\fo\bin\inside.ps1</Command></LogonCommand>
  <Networking>Enable</Networking>
</Configuration>
"@ | Out-File (Join-Path $work "selftest.wsb") -Encoding utf8

Write-Host "Starting Windows Sandbox..."
Start-Process (Join-Path $work "selftest.wsb")
$deadline = (Get-Date).AddMinutes(10)
while (-not (Test-Path (Join-Path $results "done.txt"))) {
  if ((Get-Date) -gt $deadline) { throw "Timed out waiting for the self-test." }
  Start-Sleep -Seconds 3
}
$report = Get-Content (Join-Path $results "report.json") -Raw | ConvertFrom-Json
Write-Host ""
Write-Host ("Windows: " + $report.windows)
$report.tweaks | Format-Table id, status, detail -AutoSize | Out-String -Width 220 | Write-Host
$report.entries | Format-Table tweak, what, changed, restored -AutoSize | Out-String -Width 220 | Write-Host
if ($report.undo_failures.Count) { Write-Host "Undo failures:"; $report.undo_failures | ForEach-Object { Write-Host "  $_" } }
Write-Host ("RESULT: " + ($(if ($report.passed) { "PASSED" } else { "FAILED" })))
Write-Host "Full report: $(Join-Path $results 'report.json'). Close the Sandbox window when done."
if (-not $report.passed) { exit 1 }
