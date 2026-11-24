// The app's main window minimised and restored through Win32 (ShowWindowAsync on the process's main window, from PowerShell), for the checks that
// hide the window as a user does (page-check.mjs, track-page-check.mjs).
import { spawnSync } from 'node:child_process';

const SW = { minimise: 6, restore: 9 };

/** Shows the window of process `pid` minimised or restored; throws when the process has no main window. */
export function showWindow(pid, how) {
  const script = `Add-Type -Namespace Btg -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr window, int how);'
$window = (Get-Process -Id ${pid}).MainWindowHandle
if ($window -eq [System.IntPtr]::Zero) { exit 2 }
[Btg.User32]::ShowWindowAsync($window, ${SW[how]}) | Out-Null`;
  const ran = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(`the app's window could not be ${how}d: ${ran.stdout}${ran.stderr}${ran.error ?? ''}`);
}
