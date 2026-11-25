// Checks the gate of startApp (native/tools/app-window.mjs) without starting the app: three processes that come to it at the same instant pass
// it at least START_GAP_MS apart, a process killed while it holds the gate does not hold up the next one, and a connection to the gate's port
// is closed at once.
// Usage: node native/tools/start-gate-check.mjs (about 4 s; not beside the page tests or a check that starts the app: they pass the same gate)
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';
import { connect } from 'node:net';
import { GATE_PORT, START_GAP_MS, passGate } from './app-window.mjs';

const [role, instant] = process.argv.slice(2);
if (role === 'pass') {
  // one of the three: waits for the instant, then passes; prints when it came and when it passed
  await new Promise((r) => setTimeout(r, Number(instant) - Date.now()));
  const came = Date.now();
  console.log(JSON.stringify({ came, passed: await passGate(() => Date.now()) }));
} else if (role === 'hold') {
  // takes the gate and stands inside it until it is killed (at most 10 s, should the check itself have died)
  await passGate(() => { writeSync(1, 'held\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10_000); });
} else {
  const problems = [];
  const run = (...args) => spawn(process.execPath, [import.meta.filename, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });
  const output = (child) => new Promise((resolve) => { let text = ''; child.stdout.on('data', (d) => (text += d)); child.on('exit', () => resolve(text)); });

  const at = Date.now() + 600; // a node process starts in about 100 ms
  const three = (await Promise.all([1, 2, 3].map(() => output(run('pass', String(at))))))
    .map((text) => { try { return JSON.parse(text); } catch { return { came: NaN, passed: NaN, text }; } })
    .sort((a, b) => a.passed - b.passed);
  const apart = three.slice(1).map((p, i) => p.passed - three[i].passed);
  if (three.some((p) => !Number.isFinite(p.passed))) problems.push(`a process did not pass the gate: ${JSON.stringify(three)}`);
  else if (three.some((p) => p.came > at + 100)) problems.push(`a process came to the gate after the instant (${three.map((p) => p.came - at).join(', ')} ms): the check proves nothing, run it again`);
  else {
    if (apart.some((ms) => ms < START_GAP_MS)) problems.push(`three processes at the same instant passed ${apart.join(' and ')} ms apart, not at least ${START_GAP_MS}`);
    if (three.at(-1).passed - at > 2 * START_GAP_MS + 500) problems.push(`the last of the three passed ${three.at(-1).passed - at} ms after the instant: the gate holds longer than ${START_GAP_MS} ms`);
  }

  const holder = run('hold');
  const held = await new Promise((resolve) => { holder.stdout.once('data', () => resolve(true)); holder.once('exit', () => resolve(false)); });
  let passedAt = null, killedAt = null, stray = null;
  if (!held) problems.push(`the holding process ended without taking the gate (exit code ${holder.exitCode})`);
  else {
    const passing = passGate(() => (passedAt = Date.now()));
    await new Promise((r) => setTimeout(r, START_GAP_MS + 250)); // longer than a holder that lives holds it after its spawn
    if (passedAt !== null) problems.push('a process passed the gate while another held it');
    killedAt = Date.now();
    holder.kill();
    await passing;
    if (passedAt - killedAt > START_GAP_MS) problems.push(`after the holder was killed the next process passed only ${passedAt - killedAt} ms later`);
    // while this process holds the gate: a connection to its port (a fetch that took it for a debug port) is accepted and closed at once
    stray = await new Promise((resolve) => {
      const from = Date.now(), socket = connect(GATE_PORT, '127.0.0.1');
      let connected = false;
      socket.on('connect', () => (connected = true)).on('error', () => {}).once('close', () => resolve({ connected, ms: Date.now() - from }));
      setTimeout(() => { resolve({ connected, ms: null }); socket.destroy(); }, START_GAP_MS / 2);
    });
    if (!stray.connected) problems.push(`nothing listened on the gate's port ${GATE_PORT} while the gate was held`);
    else if (stray.ms === null) problems.push(`a connection to the gate's port stayed open ${START_GAP_MS / 2} ms`);
  }

  for (const p of problems) console.log(p);
  console.log(problems.length ? `start-gate-check: ${problems.length} problems`
    : `start-gate-check: three processes at the same instant passed ${apart.join(' and ')} ms apart (at least ${START_GAP_MS}); the holder killed, the next passed after ${passedAt - killedAt} ms; a connection to the port ${GATE_PORT} closed after ${stray.ms} ms`);
  process.exitCode = problems.length ? 1 : 0;
}
