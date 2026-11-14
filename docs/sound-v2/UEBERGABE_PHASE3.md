# Übergabe Phase 3 (Artikulations-Schicht), Stand 2026-11-14

Du übernimmst die Arbeit an „Klang v2, Phase 3“ des Backingtrack Generators. Dieses Dokument sagt, was gebaut ist, was der Nutzer dazu geurteilt hat, was fehlt und worauf du achten musst. Es ersetzt nicht die Quellen unten, es führt zu ihnen.

## 1. Zuerst lesen

| Datei | Wozu |
|---|---|
| `FABLE_PHASE1.md` | Arbeitsregeln. Die Abschnitte „Du kannst nicht hören“, „Phase 2“ und „Regeln gegen Leerlauf“ gelten weiter. |
| `SPIELREGELN.md` | Die Spielregeln des Nutzers, aus denen Phase 3 gebaut wird. |
| `SPEC_PHASE3.md` | Bauplan: Datenmodell, Regeln je Instrument (Abschnitt 5), Stil-Profile (6), Reihenfolge (9), Antworten des Nutzers auf 18 Fragen (10). |
| `SOUND_CONTEXT.md`, Abschnitt „Änderungslog Klang v2“ | Verbindliches Protokoll: je Schritt Werte, Messungen, Commit und das Urteil des Nutzers. Hänge neue Einträge an. |
| `docs/interface.md` | Öffentliche Schnittstelle (Track-Felder, Ereignisstrom, Stimmen). |

Diese Dateien liegen seit 2026-11-14 eingecheckt unter `docs/sound-v2/`.

Branch: `feat/sound-v2`, Ziel für Pull Requests: `develop`.

## 2. Arbeitsregeln, die der Nutzer durchsetzt

- **Keine festen Zeiten für Artikulationen.** Urteil des Nutzers zum Bend mit festen 180 ms: „zu mechanisch, passt nicht zum Rhythmus, teils zu lang, teils zu kurz“. Bei Bend, Vibrato und Verwandtem müssen Rhythmus (Raster, Tempo) und Absicht (Notenlänge, Stelle in der Phrase) die Zeit bestimmen. Vorbild: `gridTime` in der Regelgruppe `lead`.
- **Du kannst nicht hören.** Behaupte nie, etwas klinge besser. Alle Zahlen sind Startwerte. Belege mit Messungen, das Urteil fällt der Nutzer.
- **Ein Schritt pro Commit**, jeder mit A/B-Hörprobe und höchstens zehn Zeilen Bericht (was geändert, worauf hören, Messwerte, Dateipfade). Danach **STOPP**, bis der Nutzer geurteilt hat.
- **Jede Änderung ist abschaltbar** (Feinwert in `MIX_TUNABLES['mix/art']` oder in `tunables.js`, sichtbar im Render-Harness).
- `npm test` bleibt grün. Vor einem Commit mit Wirkung auf Stimmen oder Oberfläche auch `npx playwright test --reporter=dot` (etwa 6 Minuten).
- Keine neuen Samples ohne Rückfrage. Keine Laufzeit-Abhängigkeiten. Kein Umbau der Architektur.
- Synth-Stimmen (`synth/classic`, FM-E-Piano) und die App-Oberfläche (`src/ui/`) nur mit Freigabe anfassen. Neue Einträge in Menüs, die aus den Registern entstehen (Stimmen, Aufgaben), hat der Nutzer für Lead-Gitarre und Riff ausdrücklich bestellt.
- Antworten an den Nutzer auf Deutsch. Commit-Nachrichten auf Englisch.

## 3. Wo was liegt

- `src/core/articulation.js`: die ganze Schicht. Läuft in `buildEvents` nach der Songform und vor dem Mikrotiming. Enthält den Takt-Kontext, den Verzierungs-Plan (`planRoll`, per Seed reproduzierbar, Wiederholungen behalten 70 %), die Stil-Profile (`profileOf`) und die Regelgruppen in `RULES`.
- `ART_DEFAULTS` dort: ein Schalter je Regelgruppe. `track.ornaments` (0 bis 1, fehlend 0,5) skaliert alle Wahrscheinlichkeiten, 0 schaltet alles ab.
- Ereignisfelder: `art`, `artSemi`, `artTime`, `artTone`, `artRate`, `ring`, `strumUp`.
- `src/audio/voices/sampler.js` (`playNote`): gerechnete Fallbacks je `art`. Hat das Pack eine Zone mit `zone.art === art`, nimmt `pickArtZone` diese und der Fallback entfällt. So schalten die Artikulationen später auf Sample-Gruppen um (der Sampler aus `SPEC_PHASE2.md` existiert noch nicht).
- `src/core/event-helpers.js` `DRUM_FALLBACK`: Schlagnamen ohne Sample fallen auf ihren Grundschlag zurück (`rimshot` → Snare, `ride` → Hi-Hat, `hatHalf` → offene Hi-Hat).
- `src/core/lead.js`: Lead-Aufgaben, neu `riff`.
- `scripts/render-step.mjs`: A/B-Hörproben. `node scripts/render-step.mjs <n>` schreibt `step<n>-<thema>-A.wav`, `-B.wav` und eine `.html` nach `.superpowers/audio-ab/` (nicht eingecheckt). Die Fälle stehen in `ART_CASES` (Funk 100, Rock 120 mit Strophe und Refrain, Blues-Shuffle 90, Ballade 70, Reggae 76 mit Stopp, Country 112).
- `.superpowers/audio-ab/hoerfuehrer.html`: Hörseite mit Sprungknöpfen zu den Stellen, an denen B etwas anderes spielt. Der Nutzer arbeitet damit. Die Zeiten stammen aus dem Ereignisstrom (Vergleich von A und B), nicht aus dem Gehör.

## 4. Was gebaut ist

Reihenfolge nach `SPEC_PHASE3.md`, Abschnitt 9. „Standard“ heißt: eingeschaltet in `ART_DEFAULTS`.

| Schritt der Spec | Inhalt | Stand | Urteil des Nutzers |
|---|---|---|---|
| 1 Gerüst | Kontext, Plan, Profile, `track.ornaments`, Feinwerte | fertig (`a245e31`) | – |
| 2 Bass A | `staccato`, `legato`, `dead`, `slideIn`, `approach` | Standard (`cf46973`, `186e9a4`) | „B klingt etwas besser“ |
| 3 Gitarre A | Anschlagrichtung, `palmMute`, `chuck`, `choke`, `letRing`, Arpeggio-Überlappung | Standard (`584fb6a`) | „B klingt etwas besser“ |
| 4 Schlagzeug A | Hi-Hat-Akzente, Geisternoten-Lautstärke, `sideStick`, `rimshot`, Ride mit `hatPedal` im Refrain, Crash mit Choke vor dem Stopp | Standard (`bea9e6a`, `d6c0dc1`, `be889d9`) | Blues „klingt gut“; Rock-Refrain mit halboffener Hi-Hat „viel zu viel“, deshalb bleibt sie dort geschlossen |
| 5 Band-Regeln | Regeln 1, 2, 3 und 6 für Bass, Gitarre, Tasten | Standard (`9478ca6`) | „besser“ |
| 6 Tasten und Pad A | E-Piano: Pedal, Stimmgewichtung, kurze Stabs. Pad: Stimmführung, `swell` | Standard (`16951cd`, `beadb45`) | beide „besser“ |
| 7 Prio B, Bass | `slideOff`, `hammer`/`pull`, `octavePop`, `palmMute` | Standard (`babb74c`) | Funk „besser“; Palm Mute in der Rock-Strophe ohne eigenes Urteil |
| 7 Prio B, Gitarre | `slideChord`, `embellish` | gebaut, **aus** (`chordsB`) | kein Urteil. Boom-Chick entfernt („das Standardmuster ist besser“, `d370f69`). Boogie-Muster entfernt und als Lead-Aufgabe neu gebaut |
| 7 Prio B, Lead | `scoop`, `fall` (Saxofon), `vibrato` | Standard (`485fd9f`, `f86bd8b`) | Vibrato mit festen 5,5 Hz „etwas schnell“; folgt jetzt dem Tempo (4 Hz bei 60 BPM bis 5,5 Hz ab 120 BPM), das fand der Nutzer „um einiges besser“ |
| 7 Prio B, Schlagzeug | `flam` | Standard (`a0bdab6`) | „besser“ |
| 7 Prio B, Tasten | `roll`, `crush`, `bark` | Standard (`a0bdab6`) | Blues „besser“. Der `roll` hat in der Probe nie ausgelöst und ist ungehört |
| 9 Lead-Gitarre | Stimme `lead/sample/guitar` auf den vorhandenen Freepats-Samples; Regeln `bend`, `slideIn`, `hammer`/`pull` | fertig (`d96722e`, `90a6f13`, `b725eba`) | B „besser“ (2026-11-15) |
| außerhalb der Spec | Lead-Aufgabe `riff` (Boogie-Linie, einstimmig, MIDI 45 bis 67) | fertig (`53932f0`, `c438252`) | B „besser“ (2026-11-15) |

Hörproben dazu: Schritte 10 bis 26 in `scripts/render-step.mjs`. Seit dem Urteil vom 2026-11-14 gilt für die Schritte 12 bis 20: A = Standard ohne die Gruppe, B = Standard.

## 5. Zustand im Moment der Übergabe

- Alles ist committet, letzter Commit `e542f6b` (Zeiten von Bend und Vibrato aus Raster und Notenlänge, Probe `step27-bendtime`). Der Arbeitsbaum ist sauber bis auf die nicht eingecheckten Dokumente aus Abschnitt 1 und diese Datei.
- `npm test`: 698 bestanden. Browser-Tests: 664 bestanden bei `53932f0`. Die Commits danach ändern einen Feinwert der Lead-Gitarre, den Anschlag des Riffs und die Zeiten von Bend und Vibrato; dafür liefen `npm test` und die Browser-Tests des Samplers (`tests/e2e/voices-sample-sound.spec.js`, 183 bestanden).
- Gerendert und auf der Hörseite verlinkt: `step24-leadguitar` (Lead-Gitarre, Melodie), `step25-leadguitar2` (Frage und Antwort), `step26-riff`, `step27-bendtime` (A = feste Zeiten, B = aus Raster und Notenlänge).
- **Urteil zu `step27-bendtime`: „klingt so deutlich besser und stimmiger“, bleibt Standard.** Zum Stand danach (Proben 24, 25, 26 und die Frage, ob auch Slides, Scoop, Fall und Flam auf Raster und Notenlänge umgestellt werden): „das kann so erstmal bleiben“. Das heißt: nichts weiter umbauen, bis der Nutzer etwas Neues bestellt. Ein ausdrückliches Einzelurteil zu Lead-Gitarre und Riff ist es nicht. Nächster Schritt: sein Urteil abwarten, nichts Neues bauen.
- Zwei Pegel habe ich nach Messung korrigiert, nicht nach Gehör: Die Lead-Gitarre klingt jetzt langsam ab (`decay` 10, `level` 2,15), weil gezogene und bebende Töne sonst herausstanden. Das Riff spielt mit 0,6 des Lead-Anschlags, weil es mit vollem Anschlag allein so laut war wie die übrige Band.

## 6. Offene Urteile des Nutzers

1. Lead-Gitarre (Proben 24 und 25): Taugt sie als Lead-Stimme (Lage, Sustain, Lautstärke)? Klingen Bends, Hammer-ons und Pull-offs richtig?
2. Riff (Probe 26): als eigene Stimme hörbar? In welchen Stilen passt es?
3. Zeiten der übrigen Artikulationen: `slideIn`, `scoop`, `fall`, `slideOff`, `slideChord`, Flam, Roll und Crush sind nur ans Tempo gekoppelt, nicht an Raster und Notenlänge. Nach dem Urteil zum Bend ist zu erwarten, dass der Nutzer das auch dort will; frag ihn, bevor du es umbaust.
3a. Gitarre B (`slideChord`, `embellish`): nie beurteilt, bleibt aus. Die Probe `step22-guitarsolo` fand der Nutzer „schwierig einzuschätzen“.
4. Palm Mute am Bass in der Rock-Strophe: mit Bass B eingeschaltet, ohne eigenes Urteil.
5. Staccato-Länge am Bass: gebaut sind 30 bis 60 % der Notenlänge, die Spec sagt „des Rasterschritts“.
6. Wirkung auf die Synth-Stimmen: Der Nutzer hat nur mit Samples gehört, die Synth-Stimmen sind aber der Standard der App. Dort klingen `sideStick` und `rimshot` wie die Snare, `ride` wie die Hi-Hat, und im Refrain kommen zwei Hi-Hat-Schläge auf 2 und 4 dazu.

## 7. Was aus Phase 3 fehlt

**Braucht eine Freigabe für die Oberfläche (Schritt 0 der Spec):**
- Knopf „Verzierungen“ im Rhythmus-Modul, dazu Profil-Teil `rhythm` und `laneKey`. Das Track-Feld `ornaments` und seine Prüfung gibt es schon.
- Songteil `bridge` (Antwort auf Frage 3).
- Stile schlagen Stimmen vor und setzen den Startwert von `ornaments` (Fragen 8 und 16).

**Geht mit dem Bestand, nicht gebaut:**
- Kontrabass (5.2): `ghostSkip`, `slideIn`.
- Gitarre: Strum-Zeit je Variante und Lautstärke (5.3, Zeile „Strum-Zeit“).
- Schlagzeug: Geisternoten-Häufigkeit aus dem Profil statt aus `syncopation` (Frage 2), Fills wechselnder Länge, Kick-Feathering, Tamburin im Refrain, Shaker abwechselnd lauter und leiser.
- E-Piano: Tremolo-Rate je Stil.
- Band-Regeln 5 (Gitarre in MIDI 48 bis 76 halten) und 8 (Verzierungs-Budget je Phrasenende). Regel 4 wartet auf eine zweite Akkord-Schicht, Regel 7 auf „Hits“ in den Groove-Mustern.
- Alles aus Priorität C (5.1 bis 5.10): Bass-Vibrato, `doubleStop`, `rake`, Legato-Gruppen im Lead, Latin-Muster der Percussion und weitere.
- Stil-Profile Soul, Jazz, Pop und Bossa samt den vorgeschlagenen Stilen und Schlagworten (Abschnitte 6 und 11).

**Wartet auf Samples oder neue Stimmen (Schritt 9 der Spec):**
- Ride, echter Rimshot, halboffene Hi-Hat, Besen, zwei Shaker-Klangfarben, Conga-Schlagarten, Slap, echte Dead-Note- und Palm-Mute-Samples, Klavier, Orgel-Synth mit Leslie.

**Bewusst zurückgestellt:** `strings` (Antwort auf Frage 6: Akkorde bleiben dreistimmig).

## 8. Abweichungen von der Spec

- **Slide-Vorlauf im Sampler statt im Ereignisstrom.** Das Ereignis bleibt auf dem Schlag, `playNote` beginnt früher. Im Strom hätte die Note ihren Takt verlassen und die Synth-Stimmen hätten zu früh gespielt. Live ist der Vorlauf durch die Vorausschau des Planers auf etwa 75 bis 100 ms begrenzt.
- **Becken-Wechsel im Refrain nur mit Songform**, sonst gäbe es keinen Kontrast zur Strophe. Im Rock bleibt die Hi-Hat geschlossen (Urteil).
- **Crash mit Choke vor dem Stopp nur im Sample-Kit.** Das Synth-Kit kann nicht abwürgen.
- **Lead-Gitarre vorgezogen** und aus den vorhandenen Samples der Akkord-Schicht gebaut (`packIdFor('lead', 'guitar')` → `chords-freepats`). Sie spielt wie jeder Lead in MIDI 72 bis 88; das Pack reicht bis 86, darüber wird hochgestimmt. Ob das zu dünn klingt, ist offen.
- **Riff bricht den Lead-Vertrag** an zwei Stellen (tiefer als 72, Töne der ganzen Tonleiter statt der Pentatonik). Das steht in `docs/interface.md`.

## 9. Stolpersteine

- **Der Standard-Ereignisstrom hat sich geändert.** Fremde Nutzer des Stroms (Interactive Scales) bekommen jetzt die neuen Schlagnamen und die Felder `art` und Verwandte. `tests/core/golden.test.js` wurde zweimal neu erzeugt. Ändert sich der Strom gewollt, erzeuge die Prüfsummen neu und sag es dem Nutzer.
- **Vertrag des Stroms**, von vielen Tests geprüft: `t` und `t + dur` liegen im Takt des Ereignisses, Bass und Lead sind einstimmig, der Bass liegt in MIDI 28 bis 52, Schlagnamen stammen aus `DRUM_NAMES`. Eine Regel, die Noten verlängert oder vorzieht, muss am Taktende begrenzen.
- **Regel-Tests laufen gegen eine feste Basis** (`BASIS` in `tests/core/articulation.test.js`: nur Bass und Gitarre A). Übergebene Feinwerte gelten über dieser Basis. So bleibt jede Gruppe einzeln prüfbar, obwohl fast alles Standard ist.
- **Mustertests bauen ihre Tracks mit `ornaments: 0`**, wo sie das rohe Muster des Generators prüfen (Flams und Side-Stick würden sie sonst brechen).
- **Die Band-Regeln koppeln die Schichten.** Ohne Schlagzeug-Schicht spielt der Bass anders (kein Slide ohne Kick).
- **Ein Unterschied im Signal ist noch kein hörbarer Unterschied.** Das Boogie-Muster wich um −2,2 dB vom Akkord ab und der Nutzer hörte nichts, weil es in derselben Lage und auf den Tönen des Pads lag. Miss deshalb auch die Bandpegel, nicht nur die Differenz.
- **Git Bash und Heredocs:** Lange JavaScript-Heredocs scheitern dort. Schreib Hilfsskripte als Datei und starte sie mit `node`.
- `error: failed to delete '.git/worktrees/base': Permission denied` beim Commit ist harmlos, der Commit gelingt.
