// How the checks of native/tools and the page tests (native/tests/ui/fixture.js) start the app, never two at the same instant, and the app's main
// window minimised and restored through Win32 (ShowWindowAsync on the app's main window, from PowerShell), for the checks that hide the window as a
// user does (page-check.mjs, track-page-check.mjs).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { basename, join } from 'node:path';

// btg_desktop_run <desktop> <exe> [arguments...] (native/platform/win/desktop_run.cpp) starts the program on the Windows desktop of that name (it
// makes one if there is none): its windows do not appear on the user's screen nor take the keyboard focus. It waits for the program and ends with
// its exit code, and does not pass its output on. The program runs in a job: killing the runner, or the end of the process that started the runner,
// ends it with everything it started (the app's WebView2). BTG_SHOW=1 starts the app itself, on the user's desktop.
const desktopRun = join(import.meta.dirname, '../build/platform/Release/btg_desktop_run.exe');
export const shown = process.env.BTG_SHOW === '1';

// Apps spawned through the runner within about 100 ms of each other now and then stand with their WebView2 running and no page at all (Task 33g:
// a probe that starts four apps a round through startApp, each on a desktop of its own; spawned at once 20 and 23 of 100 starts without a page,
// 100 ms apart 2 of 100, 300 ms apart 0 of 100; on the user's desktop never, in about 3000 starts). Why two such WebView2 block each other is not
// known. So no two spawns through the runner come closer than this, over every process on this machine: 300 ms measured safe, with a margin (with
// it, the same probe: 1 of 300; the fixture of the page tests still tries such a start once more).
export const START_GAP_MS = 500;
// The gate is a listening socket on this port of 127.0.0.1 (exclusive: not shared through a cluster's primary): one process at a time can hold it,
// and the system frees it when that process ends, also when it is killed, so no lock is left over to be taken over. Its holder spawns and keeps
// it START_GAP_MS longer; a connection to it is closed at once. The port lies far from the debug ports of the checks in native/tools (9333 to
// 9337), of the page tests (9340 + the worker's index) and of the start probe (9350 to 9353), and below Windows' dynamic ports (49152 on).
// shortcut: a fixed port: another program that listens on it holds up every start for GATE_WAIT_MS and then fails it (the error names the port),
// upgrade: when that happens, the port from a variable. shortcut: the gate is not first come, first served (every waiter tries again each 20 ms,
// and a newcomer may win); a start of the page tests waited at most 1.7 s (four workers; 158 of 377 starts waited), upgrade: when more processes
// than these start apps at once and a wait comes near GATE_WAIT_MS.
export const GATE_PORT = 39417;
const GATE_WAIT_MS = 10_000;

/** Runs `spawnApp` once no other caller of passGate on this machine has run its own within START_GAP_MS, and gives what it gives. */
export async function passGate(spawnApp) {
  const until = Date.now() + GATE_WAIT_MS;
  const take = () => new Promise((resolve, reject) => {
    const server = createServer((stray) => stray.destroy()).once('error', (e) => (e.code === 'EADDRINUSE' ? resolve(null) : reject(e)));
    server.listen({ port: GATE_PORT, host: '127.0.0.1', exclusive: true }, () => resolve(server));
  });
  let gate;
  while (!(gate = await take())) {
    if (Date.now() > until) throw new Error(`startApp: the port ${GATE_PORT} of its gate stayed taken for ${GATE_WAIT_MS / 1000} s: by another program?`);
    await new Promise((r) => setTimeout(r, 20));
  }
  try {
    return spawnApp();
  } finally {
    // by the clock from here: a timer counts from the start of the event loop's turn, which may lie before the spawn
    const free = Date.now() + START_GAP_MS;
    const release = () => (Date.now() < free ? setTimeout(release, free - Date.now()) : gate.close());
    release();
  }
}

/** Starts the app `exe` as spawn(exe, [], options) does, through the runner on the desktop `desktop` (one per debug port: no two apps share one),
 *  START_GAP_MS after any other start through the runner on this machine, or itself with BTG_SHOW=1 (at once: on the user's desktop coincident
 *  starts never failed); gives the spawned child (the runner: its exit code is the app's, kill() ends the app). */
export async function startApp(exe, desktop, options) {
  for (const file of shown ? [exe] : [exe, desktopRun]) if (!existsSync(file)) throw new Error(`no app at ${file}: build it first (native/build.ps1)`);
  // windowsHide: the runner is a console program, and a parent without a console (an IDE's test runner) would get a console window of it on the
  // user's screen per start; not for the app itself (BTG_SHOW=1), whose first window would then be hidden
  return shown ? spawn(exe, [], options) : passGate(() => spawn(desktopRun, [desktop, exe], { ...options, windowsHide: true }));
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
  // shortcut: the app is the runner's child of the app's file name (the runner, started without a console window, has its console host as a child
  // too), upgrade: when the runner starts more than one such program, or the app starts itself anew. shortcut: an app that has ended reads as "the
  // app has no main window" (exit 2), upgrade: when a check must tell the two apart
  const id = shown ? app.pid : `(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${app.pid}' | Where-Object Name -eq '${basename(app.spawnargs[2])}').ProcessId`;
  const script = `Add-Type -Namespace Btg -Name User32 -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindowAsync(System.IntPtr window, int how); [DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr window);'
$id = ${id}
if ($id) { $window = (Get-Process -Id $id -ErrorAction SilentlyContinue).MainWindowHandle }
if (-not $window -or $window -eq [System.IntPtr]::Zero) { exit 2 }
[Btg.User32]::ShowWindowAsync($window, ${SW[how]}) | Out-Null${CONFIRM[how]}`;
  const args = ['-NoProfile', '-NonInteractive', '-Command', script];
  const ran = shown ? spawnSync(powershell, args, { encoding: 'utf8', windowsHide: true }) : spawnSync(desktopRun, [app.spawnargs[1], powershell, ...args], { encoding: 'utf8', windowsHide: true });
  if (ran.status !== 0) throw new Error(`the app's window could not be ${how}d: ${FAILED[ran.status] ?? `exit code ${ran.status}`} ${ran.stdout}${ran.stderr}${ran.error ?? ''}`.trim());
}
