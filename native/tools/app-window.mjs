// The app's main window minimised and restored through Win32 (ShowWindowAsync on the process's main window, from PowerShell), for the checks that
// hide the window as a user does (page-check.mjs, track-page-check.mjs).
import { spawnSync } from 'node:child_process';

const SW = { minimise: 6, restore: 9 };
// ShowWindowAsync returns before the window changes: a minimise is confirmed in the same call (IsIconic within 2 s), so that a minimise that does nothing
// stops the check instead of letting it test a window that never hid
const CONFIRM = {
  minimise: `
for ($i = 0; $i -lt 40 -and -not ([Btg.User32]::IsIconic($window)); $i++) { Start-Sleep -Milliseconds 50 }
if (-not ([Btg.User32]::IsIconic($window))) { 'the window is not minimised'; exit 3 }`,
  restore: '',
};

/** Shows the window of process `pid` minimised or restored; throws when the process has no main window, or when a minimise leaves it not minimised. */
export function showWindow(pid, how) {
  const script = `Add-Type -Namespace Btg -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr window, int how); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr window);'
$window = (Get-Process -Id ${pid}).MainWindowHandle
if ($window -eq [System.IntPtr]::Zero) { exit 2 }
[Btg.User32]::ShowWindowAsync($window, ${SW[how]}) | Out-Null${CONFIRM[how]}`;
  const ran = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(`the app's window could not be ${how}d: ${ran.stdout}${ran.stderr}${ran.error ?? ''}`);
}
