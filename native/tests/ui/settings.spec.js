// The settings file of the app's window (the audio device's setup, the processor's state) lies in the app's storage folder (StandaloneApp.cpp,
// FileStorage::settingsFile), not in %APPDATA%\Backingtrack Generator, which a test's app never reads: on the test's empty folder the app opens
// the system's default device (Windows Audio, shared); a settings file laid into the folder that names DirectSound gives DirectSound.
import { test, expect } from './fixture.js';

// the audio device of the engine's next report (PluginEditor.cpp, timerCallback)
const device = (page) => page.evaluate(() => new Promise((resolve) => {
  window.__JUCE__.backend.addEventListener('engine', (m) => { if (m.deviceType) resolve({ type: m.deviceType, name: m.device }); });
}));
const attribute = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

test('Einstellungen: die App liest die Audio-Einstellungen aus ihrem eigenen Ordner, ohne Datei das Standardgerät', async ({ app }) => {
  const fresh = await device(app.page);
  expect(fresh.type, 'the device type on an empty folder').toBe('Windows Audio');
  // the same output under DirectSound, where it has that name; else DirectSound's default output (JUCE falls back to it)
  const settings = `<?xml version="1.0" encoding="UTF-8"?>\n<PROPERTIES>\n  <VALUE name="audioSetup">\n    <DEVICESETUP deviceType="DirectSound" audioOutputDeviceName="${attribute(fresh.name)}" audioInputDeviceName=""/>\n  </VALUE>\n</PROPERTIES>\n`;
  const page = await app.restart({ 'Backingtrack Generator.settings': settings });
  expect((await device(page)).type, 'the device type of the settings file in the folder').toBe('DirectSound');
});
