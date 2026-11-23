// The page's only door to the app's shell (native/PROTOKOLL.md section 7): it keeps the last texts the shell sent (the session's state, derived, tables,
// profiles, the position, the lanes; the engine's reports and the voices' state), tells its listeners what changed, and sends the page's actions and
// the transport's messages. No other module of the page talks to window.__JUCE__.
const backend = window.__JUCE__.backend;
const listeners = new Set();

export const session = {
  tables: null, state: null, derived: null, profiles: null, position: null,
  change: null, // the flags of the last answer to an action (null after one without)
  lanes: null, // { number, bpm, beats, events }: the events at the tempo bpm, the loop's length in beats
  voices: null, // Engine::voiceStatus per layer ("ready", "silent", "error: ...")
  reported: null, // derived().voices as they were when the voices' state last came
  voicesDue: false, // an answer's engine call sets voices or the track: its voices' state follows before the next answer
  engine: { playing: false, standing: false, beats: 0, bpm: 120, peaks: {}, at: 0 },
};

/** fn(what) after the shell sent something new: 'tables', 'state', 'profiles', 'position', 'lanes', 'voices', 'playing' (the transport started or
 *  stopped, or its lead ended), 'language' (with the language the app's strip chose). */
export const listen = (fn) => listeners.add(fn);
const tell = (what, value) => { for (const fn of listeners) fn(what, value); };

/** A message to the shell other than an action: playSession, stop, seek, loop, language (section 7). */
export const post = (type, fields = {}) => backend.emitEvent('btg', { type, ...fields });

// Every action has a number; the shell's answer names the number of the action it answers. A step the shell drops because the next one replaces it
// gets no answer of its own: the newer one's answer covers it. The numbers start at this load's time (in ms, below 2^31 for the shell's int): a late
// answer to the page loaded before is not taken for one of this page's.
let sent = Date.now() % 1e9;
const held = new Map(); // control -> the number of the last action it sent
const waiting = []; // { n, resolve } of send()
let starting = null; // { n, resolve } of start()

/** An action (section 3). `control`: the element that sent it; it shows the hand, not the session, until the answer to this or a newer action
 *  has come (a fader being dragged does not jump back to an older answer). Resolves with the state that answers it. */
export function send(action, control) {
  const n = ++sent;
  if (control) held.set(control, n);
  post('action', { json: JSON.stringify(action), seq: n });
  return new Promise((resolve) => waiting.push({ n, resolve }));
}
/** The control still shows the hand: an action it sent is not answered yet. */
export const holds = (control) => held.has(control);

/** "Los": the shell plays the session's song from bar 1. Resolves with the engine's first report of this start (its `run` is the start's number):
 *  `playing` false and `error` when the start failed. */
export function start() {
  const n = ++sent;
  post('playSession', { seq: n });
  return new Promise((resolve) => { starting = { n, resolve }; });
}

const on = (name, fn) => backend.addEventListener(name, fn);
on('tables', (m) => { session.tables = JSON.parse(m.json); tell('tables'); });
on('derived', (m) => { session.derived = JSON.parse(m.json); }); // comes before the state it belongs to, when its text changed
on('state', (m) => {
  session.state = JSON.parse(m.json);
  session.change = m.change ?? null;
  const c = session.change;
  if (c && (c.events || c.voices || c.restart)) session.voicesDue = true;
  if (typeof m.seq === 'number') {
    for (const [control, n] of held) if (n <= m.seq) held.delete(control);
    for (let i = waiting.length - 1; i >= 0; i--) if (waiting[i].n <= m.seq) waiting.splice(i, 1)[0].resolve(session.state);
  }
  tell('state');
});
on('profiles', (m) => { session.profiles = JSON.parse(m.json); tell('profiles'); });
on('position', (m) => { session.position = JSON.parse(m.json); tell('position'); });
on('events', (m) => { session.lanes = { number: m.number, bpm: m.bpm, beats: m.beats, events: JSON.parse(m.json) }; tell('lanes'); });
on('voices', (m) => {
  session.voices = m;
  session.reported = session.derived?.voices ?? null;
  session.voicesDue = false;
  tell('voices');
});
on('engine', (m) => {
  const before = session.engine;
  session.engine = { ...m, at: performance.now() };
  if (starting && m.run === starting.n) {
    starting.resolve(session.engine);
    starting = null;
  }
  if (m.playing !== before.playing || m.standing !== before.standing) tell('playing');
});
on('language', (lang) => tell('language', lang));

/** The transport's place now: the engine's beats, run on at its tempo since its last report (not in the lead, where its clock stands). */
export const beatsNow = () => {
  const e = session.engine;
  return e.beats + (e.playing && !e.standing ? ((performance.now() - e.at) / 1000) * (e.bpm / 60) : 0);
};

// After every load (pageshow comes with the first load too, and when JUCE returns to the page with goBack): everything the page draws from.
addEventListener('pageshow', () => post('sync'));
