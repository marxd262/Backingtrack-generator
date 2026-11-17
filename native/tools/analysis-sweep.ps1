# Scores the labelled test sets for several values of numbers of the analysis, without rebuilding in between.
#   native\tools\analysis-sweep.ps1 <NAME> <value> [<value> ...]        e.g.  analysis-sweep.ps1 IN_KEY 0 0.05 0.1
#   a value may set several numbers:  analysis-sweep.ps1 H3 "0.6,H5=0.3" "0.9,H5=0"
#   analysis-sweep.ps1 NOTHING 0    scores once with the built-in values
# The names are those of knob("NAME", ...) in native/core/src/analysis.cpp. They only take effect in a build with
# the tuning option: native\build.ps1 -NoApp -Tuning (a build without -Tuning switches it off again).
# Sets: the real tracks ($env:BTG_REAL_TRACKS, default C:\dev\samples-raw\analysis-tests; held-out ones are left out)
# and the generated sets under native/build that exist (analysis-set.mjs, analysis-set.mjs --rich).
# The beat model's beats are kept in native/build/beats-cache per file name: empty that folder when files change.
param([string]$Name, [Parameter(ValueFromRemainingArguments)] [string[]]$Values)
$repo = Resolve-Path "$PSScriptRoot\..\.."
Set-Location $repo
New-Item -ItemType Directory -Force native\build\beats-cache | Out-Null
$env:BTG_BEATS_CACHE = (Resolve-Path native\build\beats-cache).Path
$real = if ($env:BTG_REAL_TRACKS) { $env:BTG_REAL_TRACKS } else { 'C:\dev\samples-raw\analysis-tests' }
$sets = @($real, 'native\build\analysis-set', 'native\build\analysis-set-2') | Where-Object { Test-Path $_ }
foreach ($value in $Values) {
    $pairs = @("$Name=$value" -split ',')
    foreach ($pair in $pairs) { $n, $x = $pair -split '='; Set-Item "Env:BTG_$n" $x }
    "$($pairs -join ' ')"
    node native/tools/analysis-score.mjs @sets 2>&1 | Select-String '^==' | ForEach-Object { "    " + $_.Line.Substring(3) }
    foreach ($pair in $pairs) { Remove-Item "Env:BTG_$(($pair -split '=')[0])" }
}
