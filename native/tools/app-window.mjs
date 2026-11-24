// How the checks of native/tools and the page tests (native/tests/ui/fixture.js) start the app, and the app's main window minimised and restored
// through Win32 (ShowWindowAsync on the app's main window, from PowerShell), for the checks that hide the window as a user does (page-check.mjs,
// track-page-check.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// btg_desktop_run <desktop> <exe> [arguments...] (native/platform/win/desktop_run.cpp) starts the program on the Windows desktop of that name (it
// makes one if there is none): its windows do not appear on the user's screen nor take the keyboard focus. It waits for the program and ends with
// its exit code, and does not pass its output on. The program runs in a job: killing the runner, or the end of the process that started the runner,
// ends it with everything it started (the app's WebView2). BTG_SHOW=1 starts the app itself, on the user's desktop.
const desktopRun = join(import.meta.dirname, '../build/platform/Release/btg_desktop_run.exe');
export const shown = process.env.BTG_SHOW === '1';

/** Starts the app `exe` as spawn(exe, [], options) does, through the runner on the desktop `desktop` (one per debug port: no two apps share one),
 *  or itself with BTG_SHOW=1; gives the spawned child (the runner: its exit code is the app's, kill() ends the app). */
export function startApp(exe, desktop, options) {
  for (const file of shown ? [exe] : [exe, desktopRun]) if (!existsSync(file)) throw new Error(`no app at ${file}: build it first (native/build.ps1)`);
  return shown ? spawn(exe, [], options) : spawn(desktopRun, [desktop, exe], options);
}

const SW = { minimise: 6, restore: 9 };
// ShowWindowAsync returns before the window changes: a minimise is confirmed in the same call (IsIconic within 2 s), so that a minimise that does nothing
// stops the check instead of letting it test a window that never hid
const CONFIRM = {
  minimise: `
for ($i = 0; $i -lt 40 -and -not ([Btg.User32]::IsIconic($window)); $i++) { Start-Sleep -Milliseconds 50 }
if (-not ([Btg.User32]::IsIconic($window))) { exit 3 }`,
  restore: '',
};
// the script's exit codes: the runner passes them on, not the output
const FAILED = { 2: 'the app has no main window', 3: 'the window is not minimised' };
const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');

/** Shows the main window of the app that `app` (the child startApp gave) runs minimised or restored; throws when the app has no main window, or when
 *  a minimise leaves it not minimised. A process on another desktop does not find the window: on a desktop of its own the script runs there, through
 *  the runner, and the app is the process the runner started. */
export function showWindow(app, how) {
  const id = shown ? app.pid : `(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${app.pid}').ProcessId`;
  const script = `Add-Type -Namespace Btg -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr window, int how); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr window);'
$id = ${id}
if ($id) { $window = (Get-Process -Id $id -ErrorAction SilentlyContinue).MainWindowHandle }
if (-not $window -or $window -eq [System.IntPtr]::Zero) { exit 2 }
[Btg.User32]::ShowWindowAsync($window, ${SW[how]}) | Out-Null${CONFIRM[how]}`;
  const args = ['-NoProfile', '-NonInteractive', '-Command', script];
  const ran = shown ? spawnSync(powershell, args, { encoding: 'utf8' }) : spawnSync(desktopRun, [app.spawnargs[1], powershell, ...args], { encoding: 'utf8' });
  if (ran.status !== 0) throw new Error(`the app's window could not be ${how}d: ${FAILED[ran.status] ?? `exit code ${ran.status}`} ${ran.stdout}${ran.stderr}${ran.error ?? ''}`.trim());
}
