# Configures and builds native/, then runs the tests.
#   native\build.ps1              app and core
#   native\build.ps1 -NoApp       core and tests only (no JUCE download)
#   native\build.ps1 -Run         build, then start the app (start.cmd does this)
#   native\build.ps1 -Tuning      for measuring: the analysis takes its numbers from the environment (tools\analysis-sweep.ps1)
param([string]$Config = 'Release', [switch]$NoApp, [switch]$Run, [switch]$Tuning)
$ErrorActionPreference = 'Stop'

$cmake = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source
if (-not $cmake) {
    # Visual Studio ships CMake without putting it on PATH.
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $cmake = & $vswhere -latest -products * -find 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe' | Select-Object -First 1
    }
}
if (-not $cmake) { throw 'cmake not found. Install it (winget install Kitware.CMake) or the Visual Studio component "C++ CMake tools for Windows".' }

# The beat model is not in the repository; without it the analysis falls back to its own beat tracker.
if (Get-Command node -ErrorAction SilentlyContinue) { node "$PSScriptRoot\tools\get-models.mjs"; if ($LASTEXITCODE -ne 0) { Write-Warning 'beat model not downloaded' } }
$ctest = Join-Path (Split-Path $cmake) 'ctest.exe'

$build = Join-Path $PSScriptRoot 'build'
$app = if ($NoApp) { 'OFF' } else { 'ON' }

& $cmake -S $PSScriptRoot -B $build "-DBTG_BUILD_APP=$app" "-DBTG_TUNING=$(if ($Tuning) { 'ON' } else { 'OFF' })"
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& $cmake --build $build --config $Config --parallel
if ($LASTEXITCODE) { exit $LASTEXITCODE }
& $ctest --test-dir $build -C $Config --output-on-failure
if ($LASTEXITCODE) { exit $LASTEXITCODE }

if (-not $NoApp) {
    $exe = Get-ChildItem (Join-Path $build 'app') -Recurse -Filter '*.exe' |
        Where-Object { $_.FullName -match "\\$Config\\Standalone\\" } | Select-Object -First 1
    "App: $($exe.FullName)"
    if ($Run) { Start-Process $exe.FullName }
}
