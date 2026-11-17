# Analyse Phase 1: Zeitlage und Takte (Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** App und Messwerkzeug analysieren dieselben Samples, Akkordwechsel dürfen ein Achtel vor dem Schlag liegen, und die Schläge von „Letting Go“ laufen gleichmäßig, gemessen an `timing` und `tempo steady`.

**Architecture:** Zuerst die Grundlage: Anleitung anpassen, ein Dekodierweg im Kern für App und `btg_analyze` (dr_libs, schon im Bau), Zwischenspeicher der Schläge an Größe und Änderungszeit gebunden, Ausgangsstand neu. Danach Versuche nach dem Ablauf der Anleitung, je eine Änderung in `analysis.cpp`, gemessen an allen fünf Sätzen, behalten oder verworfen, eingetragen in `native/ERGEBNISSE.md`.

**Tech Stack:** C++20 ohne JUCE im Kern (`native/core`), JUCE nur in `native/app`, Node 22 für die Messskripte, PowerShell, CMake/ctest über `native\build.ps1`.

**Spec:** [Erkennung messen.md](../../../Erkennung%20messen.md), [native/DIAGNOSE.md](../../../native/DIAGNOSE.md), [native/VORSCHLAEGE.md](../../../native/VORSCHLAEGE.md) und die Entscheidungen des Nutzers vom 2026-11-17 (Nr. 6 zuerst, Nr. 5 ja, Nr. 4 ja mit Grenzen, dann Halbierungsregel, dann Nr. 1 bis 3).

## Global Constraints

- Branch `exp/analysis-agent`. Commits auf Englisch, ein Thema je Commit, nicht pushen, nichts nach `main` oder `feat/native-spike`.
- Der Kern bleibt C++20 ohne JUCE und baut unter Linux. Keine neue Abhängigkeit ohne Rückfrage (dr_mp3, dr_wav, dr_flac sind schon da).
- Labels und `native/tools` werden nicht geändert. Erlaubt durch den Nutzer: `native/core/tools/analyze.cpp` (Nr. 5 und 6).
- Die generierten Sätze werden nicht neu erzeugt. Fehlt einer: anhalten und melden.
- Die fünf unangetasteten Tracks nicht öffnen, nicht messen, nicht suchen. `native/build/analysis` und `native/build/beats-cache` enthalten Reste davon: nichts darin öffnen oder löschen.
- Das Modell und seine Gewichte bleiben unverändert.
- Laufzeit der Analyse höchstens 22 s je Track.
- Hauptmaße für Takte und Zeitlage: `timing` und `tempo steady`. `changes on the one` ist nur Sicherung.
- Nr. 4: höchstens ein Achtel vor dem Schlag; `triads` und `root` fallen in keinem Satz (auf eine Nachkommastelle). Wo das Achtel liegt, bestimmt der Track (bei Swing etwa ein Drittel Schlag vor dem Schlag), nicht ein fester halber Schlag. Ist die Strecke vom Achtel bis zum Schlag kürzer als das Spektralfenster, bleibt das Verhalten wie heute; über diese Grenze hinaus wird in dem Versuch nicht nachgebessert. In den generierten Sätzen fällt `timing` nicht, und der Median von Δ wird nicht negativ.
- Höchstens 5 Werte je Knopf. Phase 1: höchstens 12 Versuche, oder bis 6 in Folge verworfen sind.
- `analysisVersion` nicht je Versuch hochzählen.

## Review Focus

1. **Dateinamen mit Umlauten in der App** (`Für Elise.mp3`): Der neue Dekodierweg muss sie öffnen. Test in Task 2.
2. **Datei mit Endung `.mp3`, die keine ist, oder leer:** kein Absturz, die App fällt auf JUCE zurück und meldet sonst „Diese Datei kann nicht gelesen werden.“ Test in Task 2.
3. **Alter Zwischenspeicher ohne Größe und Zeit, oder Ordner fehlt:** zählt als nicht vorhanden, die Schläge werden neu gerechnet. Prüfschritt in Task 3.
4. **Vorgezogener Akkord an Rändern:** erster und letzter Schlag, zwei Schläge dicht beieinander (unter 0,1 s Abstand, kommt aus dem Modell vor). Die Akkorde bleiben lückenlos und jeder hat `start < end`. Test in Task 5.
5. **Korrekturen des Nutzers auf der Seite bei vorgezogenen Akkorden:** Ein von Hand gesetzter Takt-Akkord beginnt am Taktanfang, nicht ein Achtel davor; „Tempo zählen ÷2 / ×2“ zeigt weiter jeden Akkord. Prüfschritt in Task 5 (`track-check.mjs` prüft Korrekturen; `native/tools` ist gesperrt, also kein neuer Test dort).

## Dateien

| Datei | Änderung |
|---|---|
| `Erkennung messen.md` | Regeln, Stand, Ausgangsstand (Task 1, 4) |
| `native/core/include/btg/decode.h`, `native/core/src/decode.cpp` | neu: gemeinsamer Dekodierweg (Task 2) |
| `native/core/src/dr_flac_impl.cpp` | hält auch die Implementierung von dr_mp3 und dr_wav (Task 2) |
| `native/core/CMakeLists.txt` | `decode.cpp` in `btg_core` (Task 2) |
| `native/core/tools/analyze.cpp` | benutzt `btg::decodeFile`; Zwischenspeicher prüft Größe und Zeit (Task 2, 3) |
| `native/app/PluginProcessor.cpp` | versucht zuerst `btg::decodeFile` (Task 2); `analysisVersion` am Schluss (Task 9) |
| `native/core/src/analysis.cpp`, `native/core/include/btg/analysis.h` | Versuche (Task 5 bis 8) |
| `native/app/web/track.js` | Akkordwechsel zwischen den Schlägen anzeigen (Task 5) |
| `native/core/tests/test_analysis.cpp` | Tests zu Task 2 und 5 |
| `native/ERGEBNISSE.md`, `native/VORSCHLAEGE.md` | Protokoll, Entscheidungen |

---

## Ablauf je Versuch (gilt für Task 5 bis 8)

Jeder Versuch läuft so, die Tasks nennen nur Hypothese, Änderung und erwartete Gewinner:

- [ ] `native/ERGEBNISSE.md` lesen: Ist die Idee schon gemessen, nicht wiederholen.
- [ ] Änderung einbauen, `native\build.ps1 -NoApp` (Tests grün).
- [ ] Messen und die Ausgabe ablegen (`native/build/phase1/` liegt im Bauordner, nicht in Git):

```powershell
$env:BTG_BEATS_CACHE = "$PWD\native\build\beats-cache"
$n = '05-early-chords'   # Nummer und Name des Versuchs
node native/tools/analysis-score.mjs C:\dev\samples-raw\analysis-tests native\build\analysis-set native\build\analysis-set-2 > native\build\phase1\$n-main.txt
node native/tools/analysis-score.mjs native\build\analysis-set-detuned > native\build\phase1\$n-detuned.txt
node native/tools/analysis-score.mjs native\build\analysis-set-tempo-labeled > native\build\phase1\$n-tempo.txt
```

- [ ] Gegen den Ausgangsstand aus Task 4 (`00-baseline-*.txt`) bzw. den letzten behaltenen Versuch prüfen: Regeln „Wann eine Änderung an den Takten oder der Zeitlage gut ist“ in der Fassung aus Task 1, Zeile für Zeile der Tracks, nicht nur die `==`-Zeilen.
- [ ] Erfüllt: ein Commit mit den fünf `==`-Zeilen in der Nachricht. Nicht erfüllt: `git restore native/core native/app`.
- [ ] Eintrag in `native/ERGEBNISSE.md` unter „Phase 1: Zeitlage und Takte“: Hypothese, Änderung, Zahlen vorher und nachher, Tracks mit Gewinn und Verlust, behalten oder verworfen. Eigener Commit `docs: …` (bei verworfenen Versuchen der einzige).
- [ ] Je Idee höchstens eine Nachbesserung; die zählt als eigener Versuch.

---

### Task 1: Anleitung anpassen

**Files:**
- Modify: `Erkennung messen.md`
- Modify: `native/VORSCHLAEGE.md` (Kopfzeile)

- [ ] **Step 1: `Erkennung messen.md` ändern**

  - Kopf und „Ablauf“: Phase 1 läuft; Reihenfolge der Arbeit (Nr. 6, Nr. 5, Ausgangsstand, Nr. 4, Halbierungsregel, Nr. 1 bis 3).
  - „Testdateien“: Der Absatz mit den vier Befehlen zum Neuerzeugen wird ersetzt durch: „Die generierten Sätze werden nicht neu erzeugt. Fehlt ein Satz, anhalten und dem Nutzer melden.“ Die Befehle bleiben als Hinweis, womit die Sätze entstanden sind.
  - „Messen“: Der Satz „tempo“ gehört immer dazu (nicht mehr „ab Phase 1 zusätzlich“).
  - „Wann eine Änderung an den Takten oder der Zeitlage gut ist“, Punkt 1 neu:
    1. Mindestens eins davon trifft zu (Hauptmaße `timing` und `tempo steady`):
       - Der `timing`-Anteil im Satz „echt“ oder „tempo“ steigt um mindestens 2 Punkte.
       - `tempo steady` (`off`) wird im Satz „echt“ oder „tempo“ besser.
       - Ein Zähler für Tempo oder Taktart steigt in einem Satz.
       - Die Drift im Satz „tempo“ halbiert sich.
  - Punkt 3 neu: „`changes on the one` ist nur noch Sicherung, weil vorgezogene Akkorde die Zahl verfälschen: Sie fällt in keinem Satz um mehr als einen Punkt, und kein einzelner Track verliert mehr als fünf Punkte, ohne dass der Grund bekannt ist. Die Lage der Eins messen die generierten Sätze direkt: `bars` fällt in keinem Satz um mehr als einen Punkt.“
  - Tabelle „Was gemessen wird“ und der Abschnitt „Wie die Lage der Eins gemessen wird“: ein Satz vorweg, dass `timing` und `tempo steady` die Hauptmaße sind.
  - „Ablauf je Versuch“, Punkt 2: „… mit `timing`, `tempo steady` oder `--confusions` begründen“.
  - Ausgabeformat: bei der Beschreibung des JSON ergänzen, dass `chords[].t` ab Nr. 4 ein Achtel vor einem Schlag liegen kann.

- [ ] **Step 2: `native/VORSCHLAEGE.md`**: unter die Überschrift eine Zeile „Entscheidung des Nutzers, 2026-11-17: Nr. 6 ja (gemeinsamer Dekodierweg im Kern), Nr. 5 ja, Nr. 4 ja (nur ein Achtel vor dem Schlag, Änderung an der Seite klein halten, `triads` und `root` fallen nicht).“

- [ ] **Step 3: Commit** `docs: timing and steady tempo are the main measures for bars; the generated sets stay as they are`

### Task 2: Ein Dekodierweg im Kern (Nr. 6)

**Files:**
- Create: `native/core/include/btg/decode.h`, `native/core/src/decode.cpp`
- Modify: `native/core/src/dr_flac_impl.cpp`, `native/core/CMakeLists.txt`, `native/core/tools/analyze.cpp`, `native/app/PluginProcessor.cpp:133-165`
- Test: `native/core/tests/test_analysis.cpp`

**Interfaces:**
- Produces:

```cpp
// btg/decode.h
namespace btg {
// Reads a WAV, FLAC or MP3 file (told by its ending) into memory, all channels. Null: another kind of file, or
// unreadable, or without samples; `error` then says why. The app and btg_analyze both decode with this, so what is
// measured is what the app analyses and plays.
std::shared_ptr<AudioClip> decodeFile(const std::filesystem::path& file, std::string* error = nullptr);
std::vector<float> monoOf(const AudioClip& clip); // the mean of all channels per frame
}
```

Entscheidungen:
- Dekoder: dr_mp3, dr_wav, dr_flac (schon im Bau, kein neues Paket). `#define DR_MP3_IMPLEMENTATION` und `DR_WAV_IMPLEMENTATION` kommen in `dr_flac_impl.cpp` (die Datei wird schon ohne Warnungen gebaut); `decode.cpp` ist eigener Code mit `/W4`.
- Die Datei wird über `std::ifstream(file, std::ios::binary)` mit dem `std::filesystem::path` gelesen (Umlaute unter Windows), dann `dr*_open_memory_and_read_pcm_frames_f32` wie heute in `analyze.cpp:33-65`. Dieser Code zieht um, er wird nicht neu geschrieben.
- `btg_analyze` ruft `decodeFile(argv[i])` und `monoOf`; die eigenen `#define DR_*` und `decodeMono` entfallen, ebenso `target_include_directories(btg_analyze … dr_libs_dir)`.
- App: vor `formats.createReaderFor` zuerst `btg::decodeFile (std::filesystem::path (trackFile.getFullPathName().toWideCharPointer()))`. Gelingt es, läuft der Clip durch den vorhandenen Zweig `if (systemClip != nullptr)` (JUCE-Leser und Systemdekoder werden dann nicht gefragt). Die Mono-Schleife dieses Zweigs wird durch `btg::monoOf` ersetzt. Ogg, AIFF, WMA gehen weiter über JUCE, M4A und Video über das System.
- Kommentar in `CMakeLists.txt:26` („the app decodes with JUCE“) anpassen.

- [ ] **Step 0: Alten Stand festhalten.** Mit dem heutigen Bau, `BTG_NO_BEAT_MODEL=1`, das JSON von „Letting Go“ (MP3) und einer WAV aus `native\build\analysis-set` nach `native\build\phase1\alt-*.json` schreiben (Vergleich in Step 5).
- [ ] **Step 1: Failing test** in `test_analysis.cpp` (vor dem Abschnitt „File player“):

```cpp
// Decoding: the one way for the app and btg_analyze. A WAV written here, 16 bit, stereo, 8000 Hz, 4 frames.
{
    const auto file = std::filesystem::temp_directory_path() / std::filesystem::path(u8"btg-töne.wav");
    // header 44 bytes, then L = 16384 (0.5), R = -8192 (-0.25) four times
    ...
    std::string error;
    const auto clip = btg::decodeFile(file, &error);
    CHECK(clip && clip->channels == 2 && clip->rate == 8000.0 && clip->samples.size() == 8);
    CHECK(clip && std::fabs(clip->samples[0] - 0.5f) < 1e-4f && std::fabs(clip->samples[1] + 0.25f) < 1e-4f);
    CHECK(clip && std::fabs(btg::monoOf(*clip)[3] - 0.125f) < 1e-4f);
    auto broken = file; broken.replace_extension(".mp3");            // the same bytes are no MP3
    std::filesystem::copy_file(file, broken, std::filesystem::copy_options::overwrite_existing);
    CHECK(!btg::decodeFile(broken, &error) && !error.empty());
    CHECK(!btg::decodeFile(file.parent_path() / "btg-missing.wav", &error));
    CHECK(!btg::decodeFile(file.parent_path() / "btg.ogg", &error));
}
```

- [ ] **Step 2:** `native\build.ps1 -NoApp` → schlägt fehl (`btg/decode.h` fehlt).
- [ ] **Step 3:** `decode.h`, `decode.cpp`, `dr_flac_impl.cpp`, `CMakeLists.txt`, `analyze.cpp` wie oben.
- [ ] **Step 4:** `native\build.ps1 -NoApp` → „all checks passed“, alle ctest-Tests grün.
- [ ] **Step 5: Das Werkzeug misst dasselbe wie vorher.** Dieselben zwei Dateien wie in Step 0 noch einmal analysieren: `Compare-Object (Get-Content alt-….json) (Get-Content neu-….json)` liefert nichts.
- [ ] **Step 6: App umstellen**, dann `native\build.ps1` (mit App).
- [ ] **Step 7: App und Werkzeug liefern dasselbe.** Für „Letting Go“, „Late Night Groove“ und `pGi9fs2HhZ0`:

```powershell
$t = 'C:\dev\samples-raw\analysis-tests'
node native/tools/position-check.mjs "$t\<Datei>.mp3" 5 0          # schreibt native/build/position/app-analysis.json
native\build\core\Release\btg_analyze.exe "$t\<Datei>.mp3" native\build\position\tool.json   # ohne BTG_BEATS_CACHE
node -e "const a=JSON.parse(require('fs').readFileSync('native/build/position/app-analysis.json')),b=JSON.parse(require('fs').readFileSync('native/build/position/tool.json'));console.log(JSON.stringify(a.beats)===JSON.stringify(b.beats),JSON.stringify(a.chords)===JSON.stringify(b.chords))"
```

  Erwartet: `true true` für alle drei. Bei `false`: nicht weitermachen, Ursache suchen (superpowers:systematic-debugging) und dem Nutzer melden.
- [ ] **Step 8:** `node native/tools/track-check.mjs "$t\pGi9fs2HhZ0.mp3"`: alle Formate laden wie vorher (WAV, FLAC, MP3 jetzt über den Kern), Anzeige 20/20, 0 Fehler.
- [ ] **Step 9: Commit** `feat(native): one decoder in the core for the app and btg_analyze (WAV, FLAC, MP3)`

### Task 3: Zwischenspeicher an Größe und Änderungszeit binden (Nr. 5)

**Files:**
- Modify: `native/core/tools/analyze.cpp:112-131` und der Kommentar am Dateikopf

Entscheidung: Der Dateiname im Ordner bleibt (`<Name>.beats.json`, damit die Befehle in `DIAGNOSE.md` und `beats-inspect.mjs` weiter passen). In die Datei kommt als erster Schlüssel `"file":[<Größe in Bytes>,<Änderungszeit in ganzen Sekunden>]`, beide als ganze Zahlen geschrieben (`std::filesystem::file_size`, `last_write_time`). Gelesen wird mit dem vorhandenen `numbersAfter(text, "file")`; stimmt das Paar nicht mit der Datei überein (oder fehlt es, wie in allen alten Dateien), gelten die Schläge als nicht vorhanden und werden neu gerechnet und überschrieben. Der Ordner muss damit nie mehr geleert werden.

- [ ] **Step 1:** umsetzen, `native\build.ps1 -NoApp`.
- [ ] **Step 2: Prüfen** mit einer Datei aus `native\build\analysis-set` und einem neuen Ordner `native\build\beats-cache-check`:
  1. erster Lauf: stderr nennt `beat model: … beats, … bars, <mehrere Tausend> ms`
  2. zweiter Lauf: unter 100 ms, JSON gleich
  3. `(Get-Item <Datei>).LastWriteTime = Get-Date`, dritter Lauf: wieder mehrere Tausend ms
  4. die `"file"`-Angabe von Hand aus der Zwischenspeicher-Datei löschen: wieder neu gerechnet
  5. `BTG_BEATS_CACHE` auf einen Ordner, den es nicht gibt: Analyse läuft, kein Fehler
- [ ] **Step 3:** Abschnitt „Vorbereiten“ in `Erkennung messen.md`: die Hinweise zum Leeren ersetzen durch „Der Zwischenspeicher gilt je Datei nur, solange Größe und Änderungszeit stimmen. Leeren ist nur nötig, wenn `beat_model.cpp` geändert wurde.“
- [ ] **Step 4: Commit** `fix(native): the beats cache of btg_analyze holds only for the same file size and date`

### Task 4: Ausgangsstand neu messen und eintragen

- [ ] **Step 1:** Die drei Messbefehle aus „Ablauf je Versuch“ mit `$n = '00-baseline'`, `BTG_BEATS_CACHE` auf `native\build\beats-cache` (alte Einträge fallen durch Task 3 von selbst heraus). Danach ein zweites Mal messen: Ausgabe gleich.
- [ ] **Step 2:** Die fünf `==`-Zeilen und die Zeilen der echten Tracks und des Satzes „tempo“ mit den Tabellen in `Erkennung messen.md` vergleichen. Erwartet: gleich, weil das Werkzeug weiter mit dr_mp3 dekodiert. Jede Abweichung benennen und erklären, bevor es weitergeht.
- [ ] **Step 3:** `Erkennung messen.md`: „Stand der Zahlen“ neu (Datum, Commit, „nach dem gemeinsamen Dekodierweg; App und Werkzeug liefern für drei Tracks dasselbe JSON“), Tabellen aktualisieren, wo sich etwas geändert hat. `native/ERGEBNISSE.md`: neuer Abschnitt „Phase 1: Zeitlage und Takte (2026-11-17)“ mit dem Ergebnis von Task 2 Step 7 und dem Ausgangsstand.
- [ ] **Step 4: Commit** `docs: the baseline after the shared decoder`

### Task 5 (Versuch 1): Akkordwechsel ein Achtel vor dem Schlag (Nr. 4)

**Files:**
- Modify: `native/core/src/analysis.cpp` (nach der Regel für Stille, vor dem Aufbau von `result.chords`, heute Zeile 494-499), `native/core/include/btg/analysis.h:25`
- Modify: `native/app/web/track.js:132-147` und `:401`
- Test: `native/core/tests/test_analysis.cpp`

**Befund zur Seite (vom Nutzer verlangt, vor der Änderung geprüft):** `derive()` fragt für jeden Schlag `chordAt(Schlagzeit)` ab und baut `changes` aus diesen Schlägen. Ein Akkord mit `t` zwischen zwei Schlägen bricht nichts, erscheint aber erst am nächsten Schlag, also so spät wie heute. Anzeige „Jetzt/Als Nächstes“ und die Akkordkästen der Spur lesen nur `changes[].t`. Taktbeschriftung, Abschnitte, Korrekturen und „Takt, Schlag“ hängen an `byBeat` und bleiben, wie sie sind.

**Hypothese:** Wo die zweite Hälfte des Schlags vor einem Wechsel schon nach dem neuen Akkord klingt, liegt der Wechsel auf dem Achtel. Gewinnen sollen `timing` bei „Late Night Groove“ (37,2 %), „Letting Go“ (65,6 %), „Losing Control“ (75,6 %); `root` steigt dort mit.

**Regel in `analysis.cpp`:**

```cpp
// A chord may come an eighth early (pushed): where the second half of the beat before a change already sounds
// like the new chord and the first half like the old one, the change sits half a beat earlier. Triads only: the
// bass walks to the new root before the change and would pull every change forward.
std::vector<double> startOf(result.beats);
const double early = knob("EARLY", 0.1);
if (!compound) for (size_t b = 1; b < beatCount; ++b) {
    if (path[b] == path[b - 1]) continue;
    const double gap = result.beats[b] - result.beats[b - 1], mid = result.beats[b - 1] + swing * gap;
    if (result.beats[b] - mid < N / rate) continue; // shorter than the window of a spectrum: as before
    // first, second: the chroma of the frames whose centre lies in [beat b-1, mid) and [mid, beat b), normalised;
    // frames are placed as for beatChroma; fewer than 2 frames in a part: leave the change on the beat
    if (triad(second, path[b]) - triad(second, path[b - 1]) > early && triad(first, path[b - 1]) >= triad(first, path[b])) startOf[b] = mid;
}
```

- `swing` ist die Lage des Achtels im Schlag, aus dem Audio des Tracks: zu jedem Schlag der stärkste Einsatz (`onset`) zwischen 0,4 und 0,8 des Schlagabstands, gezählt nur, wenn er mindestens 0,3 der Stärke am Schlag hat; `swing` ist der Median dieser Lagen (0,5 gerade, etwa 0,67 bei Swing), 0,5 bei weniger als 16 solchen Schlägen. Ein Wert je Track (das Raster des Tracks), im Protokoll (`BTG_ANALYSIS_LOG`) ausgegeben.
- `triad(c, state)` ist der Dreiklang-Teil von `fit`: `(c[root] + c[third] + c[fifth]) / sqrt(3)`, ohne Bass, ohne Tonart-Vorsprung.
- `result.chords` wird wie heute je Schlag gebaut, mit `startOf[b]` als Beginn; danach bekommt jeder Akkord als `end` den Beginn des nächsten. Die Zuordnung der Schläge zu den Akkorden für `kind` bleibt dadurch dieselbe wie heute (`triads` ändert sich nicht durch die Regel selbst).
- 6/8 und 12/8 (`compound`): Dort sind `beats` schon die Unterteilungen, ein Wechsel eine Unterteilung vor dem Schlag ist heute schon darstellbar. Die Regel gilt dort nicht; sie würde auf Sechzehntel führen.
- `analysis.h:25`: „back to back; a change sits on a beat or half a beat before one“.

**Änderung an der Seite (so klein wie möglich):**

```js
const at = (t) => a.chords.findLast((c) => c.t <= t + 0.01) ?? a.chords[0];
// byBeat: { t, chord: edit ?? at(t).chord, from: edit ? t : at(t).t }
// changes: a change begins where its chord begins in the analysis if that is after the beat before, else on its beat
```

  und in `draw()`: `left` mindestens 1, damit kurz vor einem vorgezogenen Wechsel nicht „in 0 Schlägen“ steht.

- [ ] **Step 1: Failing test.** Den Aufbau des Testtracks in `test_analysis.cpp` in ein Lambda `build(double early)` fassen (Akkord zur Zeit `t` ist der des Takts von `t + early`), der vorhandene Track ist `build(0)`. Neu:

```cpp
// Pushed chords: every change an eighth before the bar line is found there, not on the beat after.
const auto pushedTrack = build(beat / 2);
const btg::Analysis pushed = btg::analyze(pushedTrack.data(), pushedTrack.size(), rate);
int onEighth = 0;
for (size_t i = 1; i < pushed.chords.size(); ++i) {
    const double want = std::round((pushed.chords[i].start + beat / 2) / (4 * beat)) * 4 * beat - beat / 2;
    if (std::fabs(pushed.chords[i].start - want) < 0.12) ++onEighth;
}
std::printf("pushed chords: %d of %zu changes on the eighth before the bar\n", onEighth, pushed.chords.size() - 1);
CHECK(onEighth >= bars - 4);
// Chords on the beat stay on a beat, and chords stay back to back.
for (const auto* found : { &a, &pushed })
    for (size_t i = 0; i < found->chords.size(); ++i) {
        CHECK(found->chords[i].start < found->chords[i].end);
        if (i) CHECK(found->chords[i].start == found->chords[i - 1].end);
    }
for (const auto& c : a.chords) CHECK(std::any_of(a.beats.begin(), a.beats.end(), [&](double t) { return t == c.start; }));
```

- [ ] **Step 2:** `native\build.ps1 -NoApp` → `CHECK(onEighth >= bars - 4)` schlägt fehl.
- [ ] **Step 3:** Regel einbauen, Tests grün.
- [ ] **Step 4:** Messen nach „Ablauf je Versuch“. Zusätzlich zur Regel der Anleitung: (a) `triads` und `root` fallen in keinem der fünf Sätze; (b) in den vier generierten Sätzen fällt der `timing`-Anteil nicht und der Median von Δ wird nicht negativ (dort wechseln die Akkorde auf dem Schlag, jeder vorgezogene Wechsel ist ein Fehlalarm). Vorher mit `BTG_ANALYSIS_LOG=1` den Wert `swing` aller echten Tracks mit Zeit-Labels ausgeben und in `ERGEBNISSE.md` festhalten, „Late Night Groove“ besonders. Ist (a) oder (b) verletzt: höchstens fünf Werte für `EARLY` (0,05 / 0,1 / 0,15 / 0,2 / 0,3, Bau mit `-Tuning`, `native\tools\analysis-sweep.ps1 EARLY …`); hilft keiner, verwerfen. Die Grenze „kürzer als das Spektralfenster“ wird in diesem Versuch nicht verschoben.
- [ ] **Step 5 (nur wenn behalten): Seite ändern**, `native\build.ps1`, dann `node native/tools/track-check.mjs "C:\dev\samples-raw\analysis-tests\Late Night Groove ….mp3"`: Anzeige 20/20 gegen die Analyse, Korrekturen und Schleife wie vorher, 0 Fehler. Von Hand in der App an einer Stelle mit vorgezogenem Akkord (Late Night Groove um 83,7 s): „Jetzt“ wechselt auf dem Achtel; Akkord des Takts von Hand setzen: beginnt am Taktanfang; „÷2“ und „×2“: kein Akkord verschwindet.
- [ ] **Step 6:** Commit `feat(native): a chord change may sit an eighth before the beat` (Kern, Test, Seite), dann der Eintrag in `ERGEBNISSE.md`.

### Task 6 (Versuch 2): Halbierungsregel und die 6-%-Toleranz (Vorschlag Nr. 2)

**Files:** `native/core/src/analysis.cpp:207-238`

**Hypothese:** Die Prüfung „halb oder doppelt so schnell“ scheitert am 20-ms-Raster des Modells (0,42 s gegen 0,39 s sind 7,7 %, der wahre Abstand ist 0,395 s). Mit feineren Abständen werden die Abschnittsanfänge erkannt, die vorhandene Regel `drop-start` greift, und die Abschnitte auf den Zwischen-Achteln verschwinden. Gewinnen soll „Letting Go“: `tempo steady` 14,7 % und `timing` 65,6 %.

**Änderung:** eine Hilfsfunktion `fine(gaps, median)`: das Mittel aller Abstände, die höchstens 10 % neben dem Median liegen (dieselbe Rechnung steht schon bei `result.bpm`, Zeile 304-308, und wird dort durch die Funktion ersetzt). Angewendet auf `usual` und auf `around[b]`. Die Toleranz `OCTAVE` bleibt 0,06.

- [ ] **Step 1:** Vorher mit `BTG_ANALYSIS_LOG=1` für „Letting Go“ festhalten: Zahl der Zeilen `keep` mit `faster 0` innerhalb der sieben Achtel-Abschnitte, und die Stelle `30.480 … around 0.420`.
- [ ] **Step 2:** umsetzen, bauen. Der Test „90 auf 126 bpm“ bleibt grün (`slow` 30 ± 3, `fast` 42 ± 4).
- [ ] **Step 3:** Protokoll erneut: Bei 30,48 s steht jetzt `faster 1`; Abschnitte 30,5 bis 59 s und 417,3 bis 449 s liegen auf den Vierteln (`beats-inspect.mjs … --bpm 76`).
- [ ] **Step 4:** Messen, entscheiden, eintragen. Besonders ansehen: Satz „tempo“ (`step-64-80-rock`, `step-80-62-hardrock`: kein echter Wechsel darf als Oktave gelten) und „Comfortably Numb“.
- [ ] **Step 5:** Wird die feinere Rechnung verworfen, ist die zweite Lesart von Vorschlag Nr. 2 der Versuch für Nr. 2 in Task 7: Toleranz um einen Rasterschritt weiter (`std::fabs(around[b] - usual / 2) < octave * usual / 2 + 0.02`, entsprechend für doppelt). Wird sie behalten, gilt Nr. 2 als erledigt.

### Task 7 (Versuche 3 und 4, bei Bedarf 5): Vorschläge Nr. 1 bis 3

**Files:** `native/core/src/analysis.cpp:234-252`

Vor jedem der beiden zuerst das Protokoll (`BTG_ANALYSIS_LOG=1`) von „Letting Go“ nach dem Stand von Task 6 ansehen und zählen, wie viele Fälle der Fehlerart noch da sind. Sind es null, den Versuch nicht machen und das in `ERGEBNISSE.md` vermerken (zählt nicht als Versuch).

**Nr. 1, Halbieren auf den Taktanfängen des Modells.**
- Hypothese: Wo ein halbierter Abschnitt trotzdem auf den Zwischen-Achteln läuft, sind die gestrichenen Schläge Taktanfänge des Modells (44 bei „Letting Go“).
- Änderung im Zweig `faster`, vor `drop-between`: Ist der Schlag dazwischen ein Taktanfang des Modells und der zuletzt behaltene keiner (`isOne(t) && !isOne(last)`), ersetzt er den zuletzt behaltenen (`result.beats.back() = t; last = t;`, Protokoll `swap-to-one`).
- Erwartet: „Letting Go“ `tempo steady` und `timing` besser; kein anderer echter Track ändert sich („Comfortably Numb“ hat keinen gestrichenen Taktanfang).

**Nr. 2:** erledigt mit Task 6, oder dessen zweite Lesart (siehe Task 6 Step 5).

**Nr. 3, einzelne überzählige Schläge.**
- Hypothese: Ein Schlag außerhalb eines doppelt gezählten Abschnitts, der dichter als 0,6 des üblichen Abstands auf den letzten folgt, während der übernächste im üblichen Abstand liegt, ist überzählig (22 bei „Letting Go“, weitere bei Losing Control, Back Door Blues, One Last Time, Comfortably Numb).
- Änderung im Zweig ohne `faster`, vor dem Auffüllen:

```cpp
if (t - last < 0.6 * around[b] && b + 1 < n && std::fabs((model.beats[b + 1] - last) / around[b] - 1) < 0.15) { say(b, "drop-extra"); continue; }
```

- Erwartet: `tempo steady` im Satz „echt“ fällt (1,8 %), bei Losing Control (2,5 %) und Back Door Blues (3,0 %) sichtbar. Sicherung: Satz „tempo“ und der Test für 90 auf 126 bpm (am Wechsel stehen zwei Tempi nebeneinander, dort darf nichts gestrichen werden).

- [ ] Nr. 1 nach „Ablauf je Versuch“
- [ ] Nr. 3 nach „Ablauf je Versuch“

### Task 8 (Versuche bis 12): was danach noch offen ist

Nur solange das Budget reicht (12 Versuche, oder 6 in Folge verworfen). Jeder Kandidat braucht vor der Änderung eine Diagnose am Protokoll oder mit `--timing`; ohne belegte Ursache kein Versuch. Reihenfolge nach erwartetem Gewinn bei den Hauptmaßen:

1. `step-80-62-hardrock` (Satz „tempo“: `tempo steady` 46,3 %, gemeldet 122 bpm, `bars` 50 %) und `faster-60-66-psych` (39,4 %).
2. `slower-80-66-dreamy`: Schläge richtig, `bars` 50 %.
3. `9pH42-82Mz0`: 7 Wechsel der Taktmitte erst am nächsten Taktanfang (1,6 bis 1,8 s spät).
4. „Before The Dawn“ und „Back Door Blues“: einzelne Wechsel 1 s zu früh (Ursache offen).
5. Taktarten in generiert-2 (`hardrock-68-180`, `reggae-128-60`, `rock-34-160`).

- [ ] je Kandidat: Diagnose, dann „Ablauf je Versuch“

### Task 9: Phase 1 abschließen

- [ ] **Step 1:** `native\build.ps1` (mit App), Tests grün; Task 2 Step 7 für „Letting Go“ wiederholen (App und Werkzeug weiter gleich).
- [ ] **Step 2:** `analysisVersion` in `native/app/PluginProcessor.cpp:13` auf `2026-11-17f`, damit der Nutzer in der App den neuen Stand sieht und keine gemerkten Ergebnisse. (Abweichung von „erst am Schluss“: Phase 1 endet mit einer Prüfung durch den Nutzer; nach Phase 2 wird noch einmal gezählt.)
- [ ] **Step 2b: Prüf-Subagent mit frischem Kontext** (verlangt vom Nutzer; ersetzt die Schlussprüfung des Skills). Er bekommt nur `git diff feat/native-spike...HEAD` (als Datei) und `Erkennung messen.md` und prüft: Regeln der Anleitung eingehalten; keine Sonderfälle für einzelne Tracks oder Dateinamen; `native/tools` und Labels seit Beginn von Phase 1 (`22d0840`) unverändert; keine unangetasteten Tracks berührt. Berechtigte Befunde selbst beheben und nachmessen; alle Befunde in den Abschlussbericht.
- [ ] **Step 3:** `native/ERGEBNISSE.md`: Stand nach Phase 1 (Tabelle Ausgangsstand gegen Endstand für alle fünf Sätze, was behalten, was verworfen). `Erkennung messen.md`: Ausgangsstand für Phase 2 eintragen, „Wo es heute hakt“ nachführen, Phase 1 als erledigt markieren. Label-Verdachtsfälle, falls welche auffielen, in `native/LABEL-VERDACHT.md`.
- [ ] **Step 4:** Commit `docs: the state after phase 1`. Nicht pushen. Dem Nutzer melden: Zahlen vorher und nachher, was er in der App prüfen kann, was offen ist, die Befunde des Prüf-Subagenten, und dass Ogg, AIFF, WMA, M4A und Video in der App weiter über JUCE oder das System laufen und nicht mit dem Werkzeug abgeglichen sind. Phase 2 (Akkorde) beginnt erst nach seiner Rückmeldung.
