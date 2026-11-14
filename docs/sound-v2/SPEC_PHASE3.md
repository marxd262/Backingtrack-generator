# SPEC_PHASE3 – Artikulations-Schicht

Stand: 2026-11-14, Branch `feat/sound-v2` (HEAD `d06d42c`). Grundlage: `SPIELREGELN.md` (Regeln des Nutzers, maßgeblich). Vorher lesen: `SOUND_CONTEXT.md` (Karte der Engine, Änderungslog Klang v2 mit allen Hör-Urteilen) und `SPEC_PHASE2.md` (Sample-Austausch).

Diese Spec sagt, **wie** die Regeln gebaut werden. Sie ändert keine Regel. Wo eine Regel unklar ist oder mit dem Code kollidiert, steht das in Abschnitt 10 als offene Frage; bis zur Antwort gilt der dort genannte Vorschlag.

## 0. Arbeitsweise

- Kein Build, keine Abhängigkeit, Synth-Stimmen (`synth/classic`, FM-Epiano) bleiben unberührt.
- Ein Schritt = ein Commit, `npm test` und `npm run test:e2e` grün. Jeder Schritt bekommt ein A/B-Paar (`scripts/render-step.mjs`, Eintrag in `STEPS`) und ist abschaltbar. **STOPP** nach jedem Schritt, der Nutzer urteilt nach Gehör. Nie behaupten, dass etwas besser klingt; alle Zahlen sind Startwerte.
- Neue Standardwerte erst nach dem Urteil. Bis dahin ist die Schicht aus (`ornaments` wirkt, aber `ART_DEFAULTS.on` = 0), der Ereignisstrom unverändert.
- Jeder Schritt ergänzt das Änderungslog in `SOUND_CONTEXT.md` (was, wo, Werte, Urteil).

## 1. Was es schon gibt

| Baustein | Ort | Stand |
|---|---|---|
| Feld `art` wird durchgereicht; `dead`/`mute` machen leiser und kürzer | `core/microtiming.js` (`ART`) | fertig, wird hier ersetzt (Abschnitt 2) |
| Gerechnete Artikulationen `slide`, `bend`, `vibrato`, `hammer`, `dead`, `mute` | `audio/voices/sampler.js` `playNote` (`art`, `artSemi`, `artTone`) | fertig, Namen werden angeglichen |
| Stab-Angabe `strum: [Index, Anzahl]`, Ab-/Aufschlag, Strum-Zeit, leisere späte Saiten | `core/events.js`, `audio/voices/sample.js` (`strumUp`, `strumTilt`) | Standard seit Schritt 6 |
| Hi-Hat-Choke, Zufall je Schlag, Pseudo-Round-Robin | `audio/voices/sample-hits.js` | Standard seit Schritt 5 |
| Ghost Notes (Snare vel 0,2), Fills, Crash auf der Eins, Wirbel, Stopps, Pausen | `core/events.js`, `core/form-post.js` | vorhanden |
| Hi-Hat-Lautstärke je Position | `core/grooves.js` (`tier.hat`) | vorhanden, andere Werte als in den Regeln (Frage 5) |
| Mikrotiming, Regler „Lockerheit“ (`track.loose`) | `core/microtiming.js` | Standard seit Schritt 4 |

Was die App **nicht** hat und die Regeln voraussetzen: Klavier, synthetisierte Orgel mit Leslie, Lead-Gitarre, Ride-Becken, halboffene Hi-Hat, Besen-Wischen, Palm-Mute-/Chuck-/Slap-Samples, die Stile Soul, Pop/Ballade, Jazz, Bossa. Abschnitt 6 und 9 sagen je Regel, worauf sie wartet.

## 2. Datenmodell

### Felder am Ereignis

Alle Felder sind optional. Ein Ereignis ohne sie klingt wie heute.

| Feld | Typ | Bedeutung |
|---|---|---|
| `art` | Text | eine Artikulation aus der Liste unten; Unbekanntes spielt normal |
| `artSemi` | Zahl (Halbtöne, mit Vorzeichen) | Abstand für `slideIn`, `slideOff`, `fall`, `scoop`, `bend`, `slideChord` |
| `artTime` | Zahl (s) | Dauer des Tonhöhenverlaufs; bei `slideIn`, `scoop`, `slideChord`, `rake`, `flam`, `ghostSkip` zugleich der Vorlauf: der Ton beginnt `artTime` vor dem Zielzeitpunkt |
| `artTone` | Zahl (dB je Halbton) | nur `bend` (vorhanden, Standard 9) |
| `strings` | `'low' \| 'full' \| 'high'` | Saitenauswahl eines Akkord-Anschlags (`stringSet`); zurückgestellt, Frage 6 |
| `ring` | Wahr | Ton nicht abschneiden (`letRing`, Arpeggio-Überlappung, `pedal`) |
| `plan` | Zahl | Nummer des Verzierungs-Plans (nur zur Prüfung in Tests) |

`dir` (Ab-/Aufschlag) wird nicht eingeführt: die Stimme leitet die Richtung weiter aus `strum` und `beat` ab (Abschnitt 5.3).

### Namen von `art`

Notenschichten: `staccato`, `legato`, `dead`, `slideIn`, `slideOff`, `hammer`, `pull`, `palmMute`, `chuck`, `choke`, `letRing`, `vibrato`, `bend`, `scoop`, `fall`, `octavePop`, `ghost`, `slideChord`, `embellish`, `roll`, `crush`, `rake`, `swell`. Nur mit eigenen Samples, ohne gerechnete Variante: `slap`, `pop`. Diese Liste ist zugleich der Namensvorrat für `art` an den Zonen der Format-2-Packs (`SPEC_PHASE2.md`, Teil A).
Neue Noten, die der Schritt einfügt (kein eigenes `art` nötig, aber so markiert): `approach`, `ghostSkip`, `doubleStop`, `boomChick`, `boogie`.
Schlagzeug bekommt keine `art`, sondern neue **Schlagnamen** in `DRUM_NAMES`: `hatHalf`, `hatPedal`, `ride`, `rideBell`, `sideStick`, `rimshot`. Dazu `flam` als `art` an einem Schlag.

Umbenennen im Bestand (in einem Commit, die Hörprobe Schritt 7–9 in `render-step.mjs` mit anpassen): `slide` → `slideIn`, `mute` → `palmMute`. `ART` in `microtiming.js` entfällt; Lautstärke und Dauer setzt der neue Schritt.

### Track

- `track.ornaments`: Zahl 0..1, fehlend 0,5 (Regel 8). Wirkung: Faktor `2 · ornaments` auf jedes `p`, Ergebnis höchstens 0,9; 0 = Schicht ganz aus, auch stilprägende Regeln (Frage 8). Die Stilwahl setzt einen Startwert je Stil, der Nutzer steuert nach. Prüfung in `core/track.js` wie `loose` (Fehlercode `badOrnaments`), Profil-Teil `rhythm` (`core/profile-parts.js`), `laneKey` (`ui/lanes.js`), Knopf „Verzierungen“ im Rhythmus-Modul nach dem Muster von „Lockerheit“ (`ui/index.html`, `ui/rhythm.js`, `i18n`). Der Knopf ist eine UI-Änderung und braucht die Freigabe des Nutzers.
- `buildEvents(track, { timing, ornaments })`: `ornaments` überschreibt Feinwerte (`on`, `p` je Regel) für Hörprobe und A/B, wie `timing`.

## 3. Pipeline-Schritt

Neues Modul `core/articulation.js`, reine Logik, eigener Zufallszweig `master.fork('art')`.

```
Spieler → sortieren → form-post (Pegel, Wirbel, Stopps, Pausen, Crash) → articulate() → applyMicrotiming()
```

`articulate(events, { track, bars, sections, params, g, rng, options })` arbeitet in fünf festen Durchgängen:

1. **Kontext** (Abschnitt 4): je Ereignis ein Objekt mit den Signalen, nichts wird verändert.
2. **Plan** **Vorschlag angenommen (2026-11-14).** (Regel 4): je Schicht und Phrase (4 Takte, `phrasesOf`) wird ein Plan gezogen. Der Zufall dafür kommt aus `rng.fork(schicht + ':' + teilTyp + ':' + phraseImTeil)`; damit bekommt die Wiederholung eines Teils denselben Plan. Bei `repetitionIndex` > 0 wird jede Entscheidung mit Wahrscheinlichkeit 0,3 aus `rng.fork(... + ':' + repetitionIndex)` neu gezogen (70 % bleiben).
3. **Regeln** (Abschnitt 5) in fester Reihenfolge je Schicht: Notenwahl (`approach`, `boomChick`, `boogie`, eingefügte `dead`/`chuck`/`ghostSkip`) → Länge (`staccato`, `legato`, `choke`, `letRing`, `pedal`) → Verzierung (`slideIn`, `slideOff`, `hammer`, …). Jede Regel prüft ihre Bedingung an den Signalen und greift mit `p · Faktor`. **Beantwortet (2026-11-14): Bridge als eigener Songteil.** Neuer Teil-Typ `bridge` in `core/form-types.js` (`PART_TYPES`, `TYPE_TABLE`), Vorschlag für die Zeile: Schichten Bass, Schlagzeug, Akkorde, Pad; Dichte −0,05; Pegel −2 dB; Übergang `fill`; kein Crash. „Kontrastierend“ heißt für die Regeln: die Bridge nimmt je Schicht die Grundhaltung, die der Refrain **nicht** hat (Refrain offen und `letRing` → Bridge `palmMute`/`staccato`; Refrain Ride → Bridge Hi-Hat oder `sideStick`), und zieht einen eigenen Verzierungs-Plan. Der Typ muss in die Form-Vorlagen (`core/form-roll.js`), die Prüfung, die Übersetzungen und die Form-Oberfläche: eigener Schritt mit Freigabe für die UI-Änderung, vor den Regeln, die `section` auswerten. `break` bleibt der leise Teil mit Stopp.
4. **Band-Regeln** **Vorschlag angenommen (2026-11-14).** (Abschnitt 5.9): Budget, „nur einer füllt“, gemeinsame Stopps. Sie streichen oder ersetzen Entscheidungen aus Durchgang 3.
5. **Vorlauf**: Ereignisse mit Vorlauf (`artTime` bei `slideIn` usw.) werden um `artTime` vorgezogen. Fällt der neue Beginn vor den Taktanfang, wechselt das Ereignis in den Takt davor (`bar − 1`, `beat` entsprechend); im allerersten Takt entfällt der Vorlauf. Danach neu sortieren. So bleibt die Regel „jedes Ereignis liegt in seinem Takt“ aus den vorhandenen Tests gültig, und der Zielton landet pünktlich (Regel 6).

Tempo-Skalierung (Regel 7): `tempoFaktor = clamp(110 / bpm, 0,5, 1,2)` (bei 6/8 und 12/8 mit dem Tempo der punktierten Viertel) multipliziert jedes `p`; Dauern in ms werden mit demselben Faktor skaliert und auf die Grenzen der Regel geklemmt (Frage 9).

Einstimmigkeit: Nach dem Schritt gilt weiter, dass Bass- und Lead-Noten nicht ineinander klingen. `legato` setzt die Dauer genau bis zum Beginn der nächsten Note; die Überlappung von 0–10 ms macht die Stimme über ihre Release-Zeit, nicht der Ereignisstrom.

## 4. Kontext-Signale

| Signal | Herleitung aus dem Bestand |
|---|---|
| `beatPos` | `e.beat`, `b.sub`: bei `sub` 4 `'1' \| 'e' \| '+' \| 'a'` aus `Math.round(e.beat · 4) % 4`; bei `sub` 3 (6/8, 12/8) `'1' \| 't2' \| 't3'` |
| `isAccent` | Zählzeit 1 jedes Takts; Akkord-Stab auf einer Zählzeit; Schlagzeug: Kick und Snare mit `vel` ≥ 0,8; sonst `vel` ≥ 0,85 |
| `nextIsAccent` | `isAccent` des nächsten Ereignisses derselben Schicht |
| `isChordChange` | `e.beat` = 0 und `b.chord` ≠ Akkord des Takts davor (Grundton oder Qualität) |
| `lastBeforeChordChange` | letzte Note der Schicht im Takt und `b.next` ≠ `b.chord` |
| `phraseStart`, `phraseEnd` | erste Note der Schicht in einer Phrase; Noten in den letzten 2 Schlägen der Phrase. Phrase = 4 Takte ab Teilbeginn (`phrasesOf`); ohne Songform 4 Takte ab Abschnittsbeginn aus `buildArrangement` |
| `beforeStop` | letzter Takt eines Teils, dessen Nachfolger `transition: 'stop'` hat (`resolved.transition` des nächsten Abschnitts) |
| `isFillBar` | `sec.fillAtEnd` und letzter Takt des Abschnitts (dort steht schon der Marker `fill`) |
| `drumFillActive` | `isFillBar` und `e.beat` ≥ Taktschläge − `g.fillBeats` |
| `section` | `sec.kind`: `intro`, `verse`, `build`, `chorus`, `break`, `outro`; ohne Songform `null` |
| `energy` | mit Songform `clamp(0,5 + densityAt(resolved, Takt im Teil), 0, 1)`; ohne Songform `params.drive` |
| `tempo` | `track.bpm`, Taktart aus `b.sub`/`b.beats` |
| `intervalToNext`, `durToNext` | `midi` und `t` der nächsten Note derselben Schicht (über Taktgrenzen) |
| `repetitionIndex` | Anzahl früherer Abschnitte mit gleichem `kind` |
| `profile` | Stil-Profil, Abschnitt 6 |

Die Regeln sagen „Strophe/Refrain/Bridge“. Zuordnung zu den Teilen der App: Strophe = `verse` und `intro`; Refrain = `chorus`; Aufbau = `build` (zählt als Strophe mit steigender `energy`); Bridge = neuer Teil `bridge` (Frage 3); `break` zählt als Strophe mit niedriger `energy`; `outro` wie Strophe. Ohne Songform entscheidet `energy`: unter 0,45 Strophe, sonst Refrain.

## 5. Regeln

Spalten: **Bedingung** an den Signalen · **Wirkung** auf das Ereignis · **p** vor Profil-, Tempo- und Reglerfaktor (ein Strich heißt: aus dem Profil, Abschnitt 6) · **braucht** (leer = geht mit dem Bestand).

### 5.1 E-Bass (`bass`, Stimmen `sample/finger`, `sample/pick`)

| Prio | `art` | Bedingung | Wirkung | p | braucht |
|---|---|---|---|---|---|
| A | `staccato` | Profil Funk/Reggae-Akzent/Rock mit Pick; oder `beforeStop`; oder nächste Note nach Pause | `dur` = 30–60 % des Rasterschritts (gezogen je Plan), Stimme blendet in 10–30 ms aus | – | |
| A | `legato` | Profil Ballade/Soul/Reggae/Blues | `dur` = bis zur nächsten Note | – | |
| A | `dead` | `beatPos` e oder a, dort spielt der Bass nicht, die nächste Note ist `isAccent` | neue Note: Tonhöhe der nächsten Note, `vel` 0,3–0,5, `dur` 0,03–0,06 s | – | |
| A | `slideIn` | `isChordChange` auf der 1, `phraseStart` oder erster Takt eines Teils | `artSemi` −1 oder −2 (je 50 %; mit p 0,1 davon −5 bis −7), `artTime` 0,04–0,1 s, höchstens ein 16tel | – | |
| A | `approach` | `lastBeforeChordChange`, mindestens ein Achtel Platz vor der 1 | neue Note einen Schritt unter (60 %) oder über dem neuen Grundton (Halbton nur in Blues und Jazz, sonst der nächste Tonleiterton, siehe Frage 7) auf dem letzten Achtel, `vel` wie die Linie; ersetzt eine dort liegende Note | – | Frage 7 |
| B | `slideOff` | `phraseEnd` vor Pause, oder `beforeStop` | `artSemi` −3 bis −7, `artTime` 0,1–0,25 s am Notenende, ausblendend | – | Sampler: Verlauf am Ende |
| B | `hammer` / `pull` | `intervalToNext` = +1/+2 bzw. −1/−2, in `isFillBar` oder bei `energy` ≥ 0,6; Blues: kleine→große Terz | Folgenote `art`, `vel` −20 % | – | |
| B | `octavePop` | Profil Funk, `beatPos` + oder a | Note eine Oktave höher, `vel` +10 %, `dur` kurz (wie `staccato`) | – | |
| B | `palmMute` | Profil Rock, Strophe, Achtelkette | `art`, Tiefpass 1–1,5 kHz, kurz | – | |
| C | `vibrato` | `dur` ≥ 1 Schlag, Profil Ballade/Slow Blues | ±10–20 Cent, 5 Hz, Einsatz nach 0,2 s | – | Sampler: Parameter |
| C | `slap` / `pop` | Profil Funk | – | – | Samples (Phase 2) |

### 5.2 Kontrabass (`bass/sample/upright`)

| Prio | `art` | Bedingung | Wirkung | p | braucht |
|---|---|---|---|---|---|
| B | `ghostSkip` | Triolen-Raster, vor betontem Schlag | neue Note auf dem letzten Triolen-Achtel, `vel` 0,25 | – | |
| B | `slideIn` | `phraseStart`, `isChordChange` | `artSemi` −1/−2, `artTime` 0,06–0,12 s | – | |
| C | `fall` | letzte Note des Tracks oder `beforeStop` | `artSemi` −5 bis −12, 0,2–0,4 s | – | Sampler: Verlauf am Ende |
| C | `dead` | Profil Jazz, vor Akzent | wie 5.1, `vel` 0,3 | – | |

### 5.3 Rhythmusgitarre (`chords`, Sample-Gitarren; Stäbe mit `strum`)

| Prio | Regel | Bedingung | Wirkung | p | braucht |
|---|---|---|---|---|---|
| A | Ab-/Aufschlag | Profil Funk: Zählzeit Abschlag, alles daneben Aufschlag (heutiger Standard). Sonst 16tel-Spiel (das Stab-Muster des Grooves nutzt e oder a): Zählzeit und + Abschlag, e/a Aufschlag; Achtel-Spiel: Zählzeit Abschlag, + Aufschlag | Stimme: Feinwert `strumUp` wird je Track gesetzt (1 bzw. 2); Aufschlag nur die oberen 3–4 Töne, `vel` −15 % | immer | Frage 1 |
| A | Strum-Zeit | Lautstärke, Tempo, Gitarrentyp | vorhanden (Schritt 6); Grenzen 8–15 ms (leise, schnell, E-Gitarre) bis 20–35 ms (laut, langsam, `steel`/`nylon`/`twelve`): Feinwert `strum` je Variante | immer | |
| – | `strings` | zurückgestellt (Frage 6): die Akkorde bleiben dreistimmig, die Saitenauswahl hätte keine Wirkung | – | – | greifbare Voicings |
| A | `palmMute` | Profil Rock, Achtelkette | `art` | Strophe 0,7, Refrain 0,1–0,2 | |
| A | `chuck` | Funk: jeder unbetonte 16tel-Platz ohne Stab; Pop: Zählzeit 2 und 4 | neuer Stab, `art`, `vel` 0,4, `dur` 0,03 s | Funk 0,8, Pop 0,3 | |
| A | `choke` | Funk-Stab mit `isAccent`; Reggae immer; `beforeStop` | `dur` = ein 16tel | Funk 0,6, Reggae 1 | Frage 8 |
| A | `letRing` | letzter Stab vor Pause oder Trackende; Refrain-Akzent; Profil Ballade | `ring`, `dur` bis zum nächsten Stab | – | |
| A | Arpeggio-Überlappung | Akkord-Schicht spielt Arpeggio (`params.arp`), Profil Ballade oder Strophe mit `energy` < 0,45 | `ring`, `dur` jeder Note bis zum Akkordwechsel | immer | |
| B | `slideChord` | Stab mit `isAccent`, Profil Funk/Blues/Soul | ganzer Stab `artSemi` ±1, `artTime` 0,04–0,08 s | 0,15 | |
| B | `embellish` | Stab mit `dur` ≥ 2 Schläge, Profil Pop/Rock/Soul/Country | Terz des Akkords beginnt als Sekunde oder Quarte, nach einem Achtel `hammer` auf die Terz | 0,15 | |
| B | `boomChick` | Profil Country | Muster ersetzt die Stäbe: Basston (Grundton/Quinte) auf 1 und 3, Stab `high` auf 2 und 4 | immer | |
| B | `boogie` | Profil Blues-Shuffle | Muster: Quinte–Sexte(–kleine Septime) über dem Grundton auf den Triolen-Achteln 1 und 3, `strings: 'low'` | 0,5 je Phrase, `palmMute` 0,5 | |
| C | `doubleStop` | `phraseEnd`, Profil Soul | zwei Töne in Sexten/Terzen aus der Tonleiter, zwei Achtel | 0,25 | |
| C | `rake` | Stab mit `isAccent`, Profil Funk/Blues | gedämpfte Töne des Stabs `artTime` 0,02–0,04 s vorher | 0,15 | |

### 5.4 Klavier, 5.5 E-Piano, 5.6 Orgel

| Prio | Regel | Bedingung | Wirkung | braucht |
|---|---|---|---|---|
| A | `pedal` (Klavier, E-Piano) | Profil Ballade/Pop immer, Rock/Blues 0,5, Jazz 0 | `ring`; Notenende = 0,02–0,05 s vor dem nächsten Akkordwechsel; die neue Note beginnt normal | Klavier-Stimme (Phase 2); für `chords/sample/epiano` sofort baubar |
| A | Stimmen-Gewichtung | jeder Stab einer Tasten-Stimme | oberster Ton `vel` +10 %, mittlere −10 % (über `strum[0]`) | |
| A | `staccato` (Stabs) | Profil Jazz/Funk/Soul | `dur` 1/16 bis 1/8 | |
| A | Register-Regel | Bass-Schicht an | kein Akkordton unter MIDI 48 (C3); tiefere Töne eine Oktave hoch | |
| B | `roll` | Schlussakkord, Akzent, Profil Ballade | Stab von unten nach oben, 0,015–0,04 s gesamt, p 0,2 | |
| B | `crush` | Profil Blues, Akkord mit großer Terz | kleine Terz 0,03–0,06 s vor und zusammen mit dem Stab, dann aus, p 0,2 | |
| B | `bark` (E-Piano) | `isAccent`, Profil Funk/Soul | `vel` +15 %, Helligkeit auf | Feinwert der FM-/Sample-Stimme |
| B | Tremolo/Autopan (E-Piano) | je Track | vorhandener Klangregler `chords.tremolo`; Rate Ballade 3–4 Hz, Funk 5–6 Hz | Rate als Feinwert |
| A | Leslie langsam/schnell (Orgel) | schnell: `chorus`, `build`, letzter Takt vor `chorus` | Hochlauf 1 s, Auslauf 2–3 s | Orgel-Synth (eigene Arbeit, `SAMPLE_SOURCES.md`) |
| B | `swell`, Percussion, Key-Click, Stabs/Fläche (Orgel) | wie in den Regeln | – | Orgel-Synth |
| C | `tremolo`, `gliss` (Klavier), Reggae-„Bubble“, `smear` (Orgel) | wie in den Regeln | Muster/Verläufe | Klavier, Orgel-Synth |

### 5.7 Pad und Streicher

| Prio | Regel | Bedingung | Wirkung | braucht |
|---|---|---|---|---|
| A | `swell` | erster Takt eines Teils; Akkordwechsel im Profil Ballade | Einsatzzeit 0,3–1,5 s je Note (`art` + `artTime`) | Stimme: Einsatzzeit je Note |
| A | Stimmführung | immer | je Akkordwechsel bleiben gemeinsame Töne liegen, die anderen gehen zum nächsten Akkordton (kleinster Schritt); ersetzt die feste Lage in `playPad` | |
| A | Dichte-Regel | Songform | Pad nur in `chorus`, `break`, `build`; in `verse` aus. Ohne Songform und im Profil Ballade immer an | Frage 4 |
| C | `tremolo` | `build` | – | Streicher-Samples |

### 5.8 Schlagzeug und 5.9 Percussion

| Prio | Regel | Bedingung | Wirkung | braucht |
|---|---|---|---|---|
| A | Hi-Hat-Akzentmuster | immer | Achtel 1,0 / 0,7; 16tel 1,0 / 0,6 / 0,8 / 0,6, als Faktor auf den Grundwert der Stufe | Frage 5 |
| A | Hi-Hat-Artikulationen | geschlossen in Strophe; `hatHalf` im Rock-Refrain; offen auf + oder a, auf der nächsten Zählzeit geschlossen; `hatPedal` auf 2 und 4, wenn Ride spielt oder Profil Jazz | Schlagnamen; Choke gibt es | `hatPedal`: Taste 44 liegt schon in allen Kits. `hatHalf`: fehlt (Phase 2) |
| A | Ride statt Hi-Hat | Refrain; Profil Jazz immer; `rideBell` für Akzente | Hi-Hat-Schläge des Teils werden `ride` | Ride-Samples (Tasten 51, 53 fehlen in den Packs; Frage 10) |
| A | Snare-Schlagarten | `rimshot`: Profil Rock im Refrain; `sideStick`: Ballade-Strophe, Bossa, Reggae, leise Blues-Durchgänge (`energy` < 0,4) | Schlagname statt `snare` | `sideStick`: Taste 37 liegt schon in allen Kits. `rimshot`: fehlt (Phase 2) |
| A | Ghost Notes | Funk/Soul auf e/a; Shuffle auf dem letzten Triolen-Achtel | vorhanden (`tier.ghosts`); `vel` 0,15–0,3 statt fest 0,2; p aus dem Profil statt `0,6 · syncopation` | Frage 2 |
| A | Crash + Choke | Crash auf der 1 nach Fill/Teilwechsel (vorhanden); `beforeStop`: Crash auf den letzten Schlag vor der Stille, abgewürgt nach 0,05–0,15 s | `art: 'choke'` am Crash, `artTime` | Choke je Schlag in `sample-hits.js` |
| B | Fills | Phrasenende; Länge 1–2 Schläge, ganzer Takt nur bei Teilwechsel; Start auf 3 oder 4; nicht jede Phrase gleich | `g.fillBeats` je Fill aus dem Plan statt fest | |
| B | `flam` / Drag | in Fills und auf Akzenten | zweiter Schlag gleichen Namens 0,015–0,03 s vorher, `vel` 0,4 | |
| B | Kick-„Feathering“ | Profil Jazz | Kick auf jeder Zählzeit, `vel` 0,2–0,3 | |
| B | Besen | Profil Jazz-Ballade, `energy` < 0,4 | Wischen + Tupfer auf 2 und 4 | Besen-Samples oder Rauschen (Phase 2) |
| B | Shaker vor/zurück | Percussion-Job mit Shaker | abwechselnd zwei Klangfarben | zwei Shaker-Samples (Phase 2); bis dahin `vel` abwechselnd ±15 % |
| B | Tamburin | Refrain, Profil Soul/Pop | auf 2 und 4; in `build` 16tel | |
| C | Conga-Schlagarten, Martillo, Clave-Muster, Cowbell | Profil Latin | neue Muster in `core/percussion.js` | Conga-Schlagarten: Samples |

### 5.10 Lead (`lead/sample/sax`, `flute`)

| Prio | `art` | Bedingung | Wirkung | p |
|---|---|---|---|---|
| B | `scoop` | `phraseStart` oder `isAccent` | `artSemi` −0,5 bis −1, `artTime` 0,05–0,1 s (Vorlauf) | 0,3 |
| B | `fall` | `phraseEnd`, nur `sax` | `artSemi` −2 bis −5, 0,15–0,3 s am Notenende | 0,25 |
| B | `vibrato` | `dur` ≥ 1 Schlag | Einsatz nach 0,15–0,3 s, 5–6 Hz | 0,6 |
| C | Legato-Gruppen | Kette von Noten ≤ ein Achtel | die ersten zwei `legato`, der Rest normal | – |
| C | `ghost` | Profil Jazz, `sax` | `vel` 0,3 | 0,15 |

`bend` steht in keinem Katalog der Regeln (nur in der Fallback-Tabelle). Er bleibt im Sampler, wird aber von keiner Regel gesetzt, bis es eine Lead-Gitarre gibt (Frage 11).

### 5.11 Band-Regeln (Durchgang 4)

| # | Regel | Umsetzung |
|---|---|---|
| 1 | Bass und Kick gekoppelt | `slideIn` am Bass nur, wenn auf dem Zielzeitpunkt (±1 Rasterschritt) ein Kick liegt; sonst entfällt er. Die Lage der Bass-Hauptnoten selbst ist Sache der Groove-Muster, nicht dieser Schicht (Frage 12) |
| 2 | Nur einer füllt | bei `drumFillActive`: am Bass keine `slideIn`, `slideOff`, `hammer`, `approach`; Gitarren-Stab `letRing`. Bass-`hammer` in Fills nur in Takten ohne `isFillBar` |
| 3 | Stopps zusammen | `beforeStop`, letzter Schlag vor der Stille: Crash mit Choke, Gitarre `choke`, Bass `staccato`, Tasten `staccato` |
| 4 | Comping aufteilen | wartet auf eine zweite Akkord-Schicht (heute gibt es nur `chords`) |
| 5 | Register trennen | Register-Regel aus 5.4; Gitarren-Stäbe bleiben in MIDI 48–76 |
| 6 | Teilwechsel als Aufbau | letzter Takt vor `chorus`: Fill (vorhanden), Pad `swell`, Bass `slideIn` auf die 1 (p 1 statt Profilwert), Crash (vorhanden), Leslie schnell |
| 7 | Gemeinsame Akzente | wartet auf „Hits“ in den Groove-Mustern (gibt es nicht) |
| 8 | Verzierungs-Budget | je Schicht höchstens eine auffällige Verzierung (`slideIn`, `slideOff`, `fall`, `roll`, Fill, `doubleStop`) in den letzten 2 Schlägen einer Phrase; je Phrasenende höchstens zwei Schichten. Vorrang: Schlagzeug, Bass, Akkorde, Lead, Pad; Überzählige entfallen |

## 6. Stil-Profile und Zuordnung zur App

Der Track kennt seinen Stil nicht (die Stil-ID lebt nur in der Oberfläche, `ui/state.js`). Das Profil wird deshalb aus Groove und Schlagworten abgeleitet, in dieser Reihenfolge; der erste Treffer gilt:

| # | Bedingung am Track | Profil der Regeln |
|---|---|---|
| 1 | Groove `slowBlues` | Slow Blues |
| 2 | Groove `shuffle` | Blues-Shuffle |
| 3 | Groove `latin` | Bossa Nova / Latin |
| 4 | Groove `ballad68` oder `waltz` | Pop / Ballade |
| 5 | `rhythm` enthält `swing` | Blues-Shuffle (Stil `blues`: Swing im 4/4-Raster; Triolen-Regeln gelten auf den geswingten Achteln) |
| 6 | `rhythm` enthält `funky` | Funk (Stil `funk`) |
| 7 | `drums` enthält `halftime` und `rhythm` enthält `syncopated` | Reggae (Stil `reggae`) |
| 8 | `drums` enthält `halftime` oder `mood` enthält `dreamy` | Pop / Ballade (Stil `dreamy`) |
| 9 | `chordSound` enthält `ringing` und `bassSound` enthält `plucky` und `rhythm` enthält `straight` | Country (Stil `country`) |
| 10 | sonst (auch `rock`, `hardrock`, `poppunk`, `psych`, Grooves `straight`, `rock68`, `waltzRock`, `fiveFour`) | Rock |

Abweichungen innerhalb von Rock: Akkorde mit der Qualität `power` in `track.bars` (so kommen die Stile `hardrock` und `poppunk` an) setzen `strings: 'low'` und `palmMute` in der Strophe auf p 0,8; ab 160 BPM gilt Achtel-Spiel mit durchgehenden Abschlägen (`strumUp` 0). `psych` spielt Arpeggios: es gelten Arpeggio-Überlappung und Pad-Regeln, sonst Rock (Frage 13).

Die Profile **Soul / R&B**, **Jazz-Swing** und **Jazz-Ballade** haben in der App keinen Stil und keine Bedingung oben; ihre Werte werden als Tabellen angelegt, aber erst erreichbar, wenn es die Stile gibt (Abschnitt 11).

Werte je Profil (p vor den Faktoren; fehlt ein Eintrag, greift die Regel nicht):

| Profil | Bass | Gitarre | Schlagzeug |
|---|---|---|---|
| Blues-Shuffle | `legato` Grundhaltung; `approach` 0,4; `slideIn` 0,25; `slideOff` 0,2 | `boogie` 0,5 (mit `palmMute` 0,5); `slideChord` 0,15; letzter Stab `letRing` | Ghost Notes 0,2 (letztes Triolen-Achtel); `sideStick` bei `energy` < 0,4; Fill im letzten Takt der Folge |
| Slow Blues | `slideIn` 0,3; `vibrato` 0,5; `ghostSkip` vor der 1 0,3 | Arpeggio-Überlappung; `letRing`; `slideChord` 0,25 | `rimshot` oder `sideStick` auf dem Backbeat; Fills ganztaktig am Ende der Folge |
| Rock | `palmMute` Strophe 0,5; `slideIn` am Teilbeginn 0,15; `slideOff` vor Stopps 0,3; `dead` 0,05 | `palmMute` Strophe 0,7 / Refrain 0,1; Refrain-Akzente `letRing`; `choke` vor Stopps 1 | Hi-Hat geschlossen → `hatHalf`/`ride` im Refrain; `rimshot` im Refrain; Fills alle 4/8 Takte |
| Funk | `dead` 0,35; `octavePop` 0,3; `staccato` Grundhaltung; `slideIn` auf die 1 0,15; `hammer` in Fills 0,2 | `chuck` 0,8; `choke` auf Akzenten 0,6; `strings: 'high'`; `slideChord` 0,2; Aufschläge auf e/a | Ghost Notes 0,4 auf e/a; offene Hat auf + der 4 oder a 0,3 |
| Soul / R&B | `legato`; Ghost-`dead` 0,2; `slideIn` 0,2; `hammer` 0,15 | `doubleStop` 0,25; `choke` auf 2 und 4; `strings: 'high'`; `slideChord` 0,15 | Ghost Notes 0,25; `sideStick` in der Strophe; Tamburin auf 2 und 4 im Refrain |
| Pop / Ballade | `legato`; `slideIn` 0,1; `vibrato` 0,3 | Strophe Arpeggio-Überlappung; Refrain `chuck` auf 2 und 4 0,3; `embellish` 0,15 | `sideStick` Strophe → Snare/`rimshot` Refrain; Hi-Hat → `ride`; Wirbel in den Refrain (vorhanden) |
| Jazz-Swing | `approach` auf Schlag 4 0,5; `ghostSkip` 0,15 | Viertel-Comping mit `choke` | `ride` immer, `hatPedal` auf 2 und 4, Feathering, Snare-Comping 0,1 |
| Jazz-Ballade | lange Noten, `slideIn` 0,3 | Arpeggio-Überlappung | Besen, leichtes `ride` |
| Reggae | `legato`; `slideIn` 0,15 | `choke` 1; Aufschlag auf 2 und 4; `strings: 'high'` | `sideStick` oder `rimshot` auf der 3; sparsame Tom-Fills |
| Bossa / Latin | `legato` | leise, `strings: 'high'` | `sideStick`-Muster; Kick leise auf 1 und 3 |
| Country | Walk-up (`approach` in 3 Schritten) 0,4; `slideIn` 0,1 | `boomChick`; `embellish` 0,2 | `sideStick` auf dem Backbeat |

Die Einträge `strings: …` in der Tabelle sind die Werte aus den Regeln; sie wirken erst, wenn es greifbare Gitarren-Voicings gibt (Frage 6). Tasten-, Pad- und Percussion-Werte je Profil stehen in den Regeln (Abschnitt 6 dort) und werden unverändert übernommen, sobald die Stimmen existieren.

## 7. Klang-Umsetzung und Fallbacks

Reihenfolge je Note (nur Notenschichten; Schlagzeug wählt über Schlagnamen): Pack hat Zonen mit diesem `art` (Format 2, `SPEC_PHASE2.md`) → diese spielen; sonst die gerechnete Variante; gibt es keine, spielt die Note normal.

| `art` | Gerechnet (in `sampler.js` `playNote`, wenn nicht anders genannt) | Stand |
|---|---|---|
| `staccato`, `choke` | `dur` kommt aus dem Ereignis; Ausblenden 0,01–0,03 s statt der Release der Zone | neu |
| `dead`, `chuck` | Tiefpass 900 Hz, höchstens 0,05 s (`chuck`: 0,02–0,04 s, alle Töne des Stabs) | `dead` da, `chuck` neu |
| `palmMute` | Tiefpass 800–1500 Hz (Feinwert), Abklingen ≤ 0,5 s | da (als `mute`), umbenennen |
| `slideIn`, `scoop`, `slideChord` | Verlauf von `artSemi` auf den Ton über `artTime`, beginnt am Notenanfang (der Vorlauf kommt aus dem Ereignisstrom) | da (als `slide`, fest 0,08 s), `artTime` neu |
| `slideOff`, `fall` | Verlauf vom Ton auf `artSemi` über `artTime` am Notenende, Pegel blendet mit aus | neu |
| `bend` | S-Kurve, höchstens 0,04 s halten, höchstens 0,18 s ziehen, Höhenregal läuft mit (`artTone` 9), ohne zusätzliches Abklingen | da (Urteil: besser, Sustain wichtig) |
| `hammer`, `pull`, `legato` | Sample beginnt 0,03 s später, Einsatz ≥ 0,02 s, leiser | da |
| `vibrato` | Kurve auf der Abspielgeschwindigkeit; Tiefe, Rate und Einsatz als Parameter | da, Parameter neu |
| `letRing`, `ring`, `pedal` | Release der Zone auf 2 s (Obergrenze `MAX_RELEASE`), `oneShot` bleibt | neu |
| `swell` | Einsatzzeit = `artTime` | neu |
| `octavePop`, `ghost`, `approach`, `ghostSkip`, `embellish`, `roll`, `crush`, `rake`, `doubleStop`, `boomChick`, `boogie` | reine Noten-, Zeit- und Lautstärke-Änderungen im Ereignisstrom, kein eigener Klang | neu |
| Schlagnamen | `sideStick` Taste 37, `hatPedal` Taste 44: in `HIT_KEYS.drums` (`sample-hits.js`) eintragen; im Synth-Kit (`drums.js`) fällt `sideStick` auf `snare`, `hatPedal` auf `hat`, `ride`/`rideBell` auf `hat`, `hatHalf` auf `openHat`, `rimshot` auf `snare` zurück (Zuordnung in der Schlag-Stimme, die Synth-Klangerzeuger bleiben unverändert) | neu |
| Crash-Choke, `flam` | `sample-hits.js`: `art: 'choke'` würgt den eigenen Schlag nach `artTime` ab | neu |

Die Synth-Stimmen ignorieren `art`. Längen-, Lautstärke- und Noten-Änderungen aus dem Ereignisstrom wirken dort trotzdem.

## 8. Testfälle

**Unit (`tests/core/articulation.test.js`):**

- `ornaments` 0 oder `on` 0: `buildEvents` liefert denselben Strom wie vorher (die Golden-Prüfsummen bleiben, bis die Schicht Standard wird).
- Reproduzierbar: gleicher Track, gleicher Strom. `ornaments` 1 setzt mindestens so viele Artikulationen wie 0,5, kein `p` über 0,9.
- Je Regel der Prio A ein Fall: gebauter Mini-Track, an der erwarteten Stelle steht das `art`, an verbotenen Stellen nicht (z. B. `dead` nur auf e/a vor einem Akzent; `choke` im Reggae an jedem Stab).
- Regel 6: bei `slideIn` liegt `t + artTime` auf dem Zeitpunkt, den die Note ohne Artikulation hätte (±1 µs vor dem Mikrotiming).
- Regel 4: zwei Abschnitte gleicher Art teilen mindestens 60 % ihrer Entscheidungen, aber nicht alle (über 20 Seeds gemittelt).
- Band-Regeln: kein Bass-`slideIn` bei `drumFillActive`; je Phrasenende höchstens zwei Schichten mit auffälliger Verzierung; bei `beforeStop` haben Bass, Gitarre und Crash ihre Stopp-Artikulation.
- Bestand: alle Ereignisse im Takt, sortiert, Bass und Lead einstimmig, keine negative Dauer (wie `microtiming.test.js`, für `ornaments` 0, 0,5 und 1, alle Profile).
- Profil-Zuordnung: jeder der 9 Stile der App und jeder der 9 Grooves ergibt das Profil aus Abschnitt 6.

**Browser (`tests/e2e/voices-sample-sound.spec.js`):** jedes gerechnete `art` ändert den Ton, bleibt endlich und unter 1 (Test vorhanden, Namen erweitern); `sideStick` und `hatPedal` klingen und unterscheiden sich von `snare` und `hat`.

**A/B-WAVs (aus den Regeln, auf die App abgebildet; „All samples“, gleicher Seed):**

| Fall | Track | Worauf hören |
|---|---|---|
| Funk 100 BPM, 8 Takte | Stil `funk`, `fullFromStart` | Dead Notes, Chucks, Chokes, offene Hi-Hat |
| Rock 120 BPM, 4 + 4 Takte | Stil `rock`, Songform `verse` 4 + `chorus` 4 | Palm Mute → offen, Hi-Hat → Ride (sobald vorhanden), Crash, `slideIn` am Refrain-Beginn |
| Blues-Shuffle 90 BPM, 12 Takte | Stil `blues`, Groove `shuffle` (12/8), 12-Takt-Folge | Approach Notes, Slides, Fill im letzten Takt (Turnaround: Frage 14) |
| Ballade 70 BPM, 8 Takte | Stil `dreamy`, Akkorde `sample/epiano` | Pedal, Arpeggio-Überlappung, Pad-Swell, Side-Stick |

`render-step.mjs` rendert heute Rock 120, Funk 100, Psych 90 über 8 Takte ohne Songform. Für Phase 3 bekommt `CASES` je Eintrag Stil, BPM, Groove, Songform und Stimmen; die Hörseite bleibt.

## 9. Reihenfolge

Jeder Punkt ist ein Schritt mit A/B und STOPP. Reihenfolge nach den Regeln (Abschnitt 8 dort), innerhalb davon nach „geht mit dem Bestand“.

0. **Vorarbeiten aus den Antworten:** (a) Songteil `bridge` (Frage 3); (b) Stile schlagen Stimmen vor und setzen den Startwert von `ornaments` (Fragen 8 und 16). Beide ändern die Oberfläche und brauchen je eine Freigabe und eine Hörprobe; (b) kann auch nach Schritt 5 kommen.
1. **Gerüst:** `core/articulation.js` mit Kontext-Signalen, Plan, Profil-Zuordnung, `track.ornaments`, Feinwerte, Tests. Noch keine Regel; Strom unverändert. Umbenennen `slide`/`mute`.
2. **Bass A:** `staccato`, `legato`, `dead`, `slideIn` (mit Vorlauf), `approach`.
3. **Gitarre A:** Ab-/Aufschlag nach Profil und Spielweise, `palmMute`, `chuck`, `choke`, `letRing`, Arpeggio-Überlappung.
4. **Schlagzeug A, was die Packs hergeben:** `sideStick`, `hatPedal`, Hi-Hat-Akzentmuster, Ghost-Note-Lautstärke, Crash-Choke.
5. **Band-Regeln 1–3 und 8**, Teilwechsel (Regel 6).
6. **Tasten und Pad A:** `pedal` und Stimmen-Gewichtung am E-Piano, `staccato`, Register-Regel; Pad `swell`, Stimmführung, Dichte-Regel.
7. **Prio B** in der Reihenfolge Bass, Gitarre, Lead, Schlagzeug, Tasten.
8. **Prio C.**
9. **Wartet auf Phase 2 oder neue Stimmen** **Vorschlag angenommen (2026-11-14).** (jeweils eigener Schritt, sobald vorhanden): Ride und `hatHalf`, `rimshot`, Besen, Shaker-Klangfarben, Conga-Schlagarten, Slap, echte Dead-Note-/Palm-Mute-Samples, Klavier, Orgel-Synth mit Leslie, Lead-Gitarre mit `bend`. „Phase 2“ heißt in dieser Spec: kommt über die Import-Pipeline. `SPEC_PHASE2.md` selbst liefert nur Growlybass, Emilyguitar und Naked Drums; Klavier, Besen, Shaker, Conga und Slap brauchen weitere Libraries (`SAMPLE_SOURCES.md`).

## 10. Offene Fragen

Bis zur Antwort gilt der Vorschlag. Nichts davon ist stillschweigend geändert.

1. **Ab-/Aufschlag auf dem „+“. Beantwortet (2026-11-14, zwei Runden):** Der Standard bei 16teln ist 1 runter, e hoch, + runter, a hoch; Stile dürfen davon abweichen. Runter, hoch, hoch, hoch (der heutige Standard `strumUp` 2) kann laut Nutzer im Funk sehr gut klingen, erst recht mit Dead Notes. Entscheidung: Die Anschlagrichtung ist ein Wert des Stil-Profils. Profil Funk behält `strumUp` 2 (so bestätigt in der Hörprobe von Schritt 6); alle anderen Profile bekommen bei 16tel-Mustern den Standard-Wechsel (Zählzeit und + runter, e und a hoch) und bei reinem Achtel-Spiel Zählzeit runter, + hoch. Nach dem Bau je Profil einmal gegenhören.
2. **Ghost Notes.** Heute steuert `syncopation` die Häufigkeit (`0,6 · syncopation`), die Regeln geben feste p je Stil. Vorschlag: p aus dem Profil, `syncopation` als Faktor 0,5–1,5 darauf.
3. **Bridge.** Die App hat keine Bridge, aber `build` (Aufbau) und `break` (leiser Teil mit Stopp). Vorschlag: „Bridge kontrastierend“ = `break`. Oder soll es einen Teil `bridge` geben?
4. **Pad in der Strophe.** Die Dichte-Regel sagt „Strophen meist leer“. Heute entscheidet die Songform, welche Schichten ein Teil hat (`verse` hat schon kein Pad), ohne Songform spielt das Pad immer. Vorschlag: nichts ändern, die Regel ist mit Songform schon erfüllt.
5. **Hi-Hat-Akzente.** **Vorschlag angenommen (2026-11-14).** Die Grooves haben eigene Werte (16tel z. B. 0,6 / 0,25 / 0,45 / 0,25, also im Verhältnis 1 / 0,42 / 0,75 / 0,42), die Regel will 1 / 0,6 / 0,8 / 0,6, also flacher. Ersetzen oder die Groove-Werte behalten?
6. **`stringSet` bei drei Tönen. Beantwortet (2026-11-14):** Die Akkorde bleiben vorerst, wie sie sind; sie werden nicht auf 5–6 Töne erweitert. Vorgabe des Nutzers für jede spätere Erweiterung: Gitarren-Akkorde so, wie sie menschlich greifbar sind (niemand greift gleichzeitig 12 Bünde höher, also keine oktavierten Töne weit oben); Akkorde dürfen offene Saiten haben, und die dürfen klingen. Die Saiten-Regel hält der Nutzer für sinnvoll, sobald Dead Notes oder Mutes dabei sind, zum Beispiel bei kräftig gespielten Powerchords. Folge für diese Spec: `strings` wird in Schritt 3 **nicht** als eigene Regel gebaut; die Saitenauswahl wirkt nur dort, wo sie mit drei Tönen etwas ändert (Powerchords `low` gibt es über die Akkord-Qualität `power` schon; beim Aufschlag bleibt es bei `vel` −15 % und den leiseren späten Tönen aus Schritt 6). Greifbare Voicings mit offenen Saiten sind ein eigenes späteres Thema.
7. **`approach` und `boogie` ändern Töne. Beantwortet (2026-11-14):** Töne außerhalb der Tonleiter darf es geben, sie sollen aber nicht der Standard sein; stilabhängig findet der Nutzer gut. Entscheidung wie vorgeschlagen: `approach` nimmt den nächsten Tonleiterton unter oder über dem neuen Grundton; nur in den Profilen Blues-Shuffle, Slow Blues und Jazz ist der chromatische Halbton erlaubt (höchstens ein Achtel lang, nie auf einer Zählzeit). `boogie` gibt es nur im Blues-Shuffle. Zweck der App laut Nutzer: beim Improvisieren mit einer Tonleiter eine automatisch erzeugte, gut klingende Begleitung, die nicht immer dieselbe ist.
8. **„Immer“-Regeln und der Regler. Beantwortet (2026-11-14):** 0 ist aus, ohne Ausnahme, auch für Regeln, die zum Stil gehören (Reggae-`choke`, Funk-`chuck`). Der Stil setzt den Regler: jeder Eintrag in `STYLE_PRESETS` bekommt einen Startwert `ornaments`, den die Stilwahl in den Track schreibt (wie sie heute die Schlagworte setzt); der Nutzer kann danach immer nachsteuern. Zwischen 0 und 1 bleibt es beim Vorschlag: Regeln mit p ≥ 0,8 werden nicht skaliert, alle anderen mit `2 · ornaments`, höchstens 0,9. Startwerte je Stil (Vorschlag, nicht gehört): funk 0,6, blues 0,6, reggae 0,5, country 0,5, rock 0,4, hardrock 0,35, poppunk 0,3, psych 0,4, dreamy 0,3.
9. **Tempo-Skalierung.** Regel 7 nennt keine Zahlen. Vorschlag: Faktor `clamp(110 / bpm, 0,5, 1,2)` auf p und auf Dauern.
10. **Ride, halboffene Hi-Hat, Rimshot. Beantwortet (2026-11-14):** In der Technik mitdenken, aber noch keine neuen Samples hinzufügen. Also: die Schlagnamen `ride`, `rideBell`, `hatHalf`, `rimshot` kommen in `DRUM_NAMES`, die Regeln setzen sie, und jede Schlag-Stimme fällt auf einen vorhandenen Schlag zurück, solange ihr Pack den Namen nicht kennt (Tabelle in Abschnitt 7: `ride`/`rideBell` → `hat`, `hatHalf` → `openHat`, `rimshot` → `snare`). `sideStick` (Taste 37) und `hatPedal` (Taste 44) liegen schon in den Packs und werden sofort benutzt. Nichts wird aus MuseScore_General nachgezogen. Noch offen: der Vorrang zwischen „Refrain Ride“ und „Rock-Refrain halboffen“, sobald beides klingt; bis dahin im Rock-Refrain `hatHalf`, sonst `ride`.
11. **Bend. Beantwortet (2026-11-14):** Bends gibt es nur bei Saiteninstrumenten, und nur dort, wo sie musikalisch sinnvoll sind: Lead-Gitarre und Einzelnoten-Spiel. Bei Akkorden machen sie wenig Sinn („nur weil es technisch möglich ist, heißt es nicht, dass es sinnvoll ist“). Folge: Keine Regel setzt `bend` an Akkord-Stäbe, Tasten, Bläser, Pad oder Schlagzeug. Der Bass bekommt vorerst auch keinen (er ist ein Saiteninstrument, der Nutzer nennt aber die Lead-Gitarre; Bass-Bends sind unüblich). `bend` bleibt im Sampler und wird erst von den Regeln einer künftigen Lead-Gitarre gesetzt (Einzelnoten, lange Töne, `phraseEnd`). Die Regel für Saxofon und Flöte bleibt `scoop` (höchstens ein Halbton).
12. **Band-Regel 1.** **Vorschlag angenommen (2026-11-14).** „Bass-Hauptnoten liegen auf Kick-Schlägen“ ist eine Aussage über die Muster, nicht über Artikulation. Die Groove-Muster von Bass und Kick sind unabhängig gewählt. Soll Phase 3 die Bass-Muster an den Kick binden, oder nur die Slides?
13. **Psych.** **Vorschlag angenommen (2026-11-14).** Passt zu keinem Profil. Vorschlag: Rock-Werte, aber Arpeggio- und Pad-Regeln wie Ballade.
14. **Turnaround.** **Vorschlag angenommen (2026-11-14).** „Turnaround in Takt 11–12“ setzt eine 12-Takt-Form voraus. Die App kennt nur Akkordfolgen beliebiger Länge. Vorschlag: Turnaround = letzter Takt der Akkordfolge, wenn sie 12 Takte hat; sonst entfällt er.
15. **Regel 4 gegen `randomness`.** **Vorschlag angenommen (2026-11-14).** Mit Songform wechselt heute je Phrase mit Wahrscheinlichkeit `randomness` das Muster. Vorschlag: Die 70 % gelten für die Verzierungen, `randomness` weiter für die Muster.
16. **Stimmen und Stile.** Mehrere Regeln setzen ein Instrument voraus („Rock: Pick“, „Jazz: Ride“, „Bossa: Nylon“). In der App setzt kein Stil Stimmen. Sollen Stile künftig Stimmen vorschlagen, oder wirken die Regeln nur, wenn der Nutzer die Stimme selbst gewählt hat? Vorschlag: Letzteres. **Beantwortet (2026-11-14): Stile sollen Instrumente vorschlagen.** Jeder Eintrag in `STYLE_PRESETS` bekommt ein Feld `voices` (Vorschlag je Schicht); die Stilwahl schreibt es in `track.voices`, wie sie die Schlagworte setzt, und der Nutzer kann jede Stimme danach ändern. Das hebt die bisherige Regel „kein Stil setzt Stimmen“ auf und ist eine Verhaltensänderung der Oberfläche (eigener Schritt, eigene Hörprobe, Tests zu Stilwahl und Profilen anpassen). Offen ist nur die Tabelle selbst; Vorschlag aus den Regeln und den vorhandenen Stimmen: rock/hardrock/poppunk Bass `pick`, Akkorde `guitar` (hardrock, poppunk: `muted`), Kit `standard`; funk Bass `finger`, Akkorde `funk`, Kit `standard`; blues Bass `finger`, Akkorde `jazz`, Kit `jazz`; reggae Bass `finger`, Akkorde `muted`, Kit `rimshot`; country Bass `upright`, Akkorde `steel`, Kit `brushes`; dreamy Bass `finger`, Akkorde `epiano`, Kit `brushes`; psych Bass `finger`, Akkorde `twelve`, Kit `standard`. Nichts davon ist gehört.
17. **Vibrato.** **Vorschlag angenommen (2026-11-14).** Der Sampler hat ±25 Cent ab 30 % der Notenlänge, die Regeln ±10–20 Cent nach 150–300 ms. Die Regelwerte werden übernommen; gehört sind beide nicht einzeln.
18. **Hi-Hat „auf der nächsten Zählzeit schließen“.** **Vorschlag angenommen (2026-11-14).** Im Funk liegt die offene Hat auf „a“ oder „+ der 4“; die nächste Zählzeit kann ein Takt später sein, und dort steht nicht immer eine geschlossene Hat. Vorschlag: fehlt sie, wird `hatPedal` eingefügt.

## 11. Stile und Schlagworte, die mit den Regeln sinnvoll wären

Das sind Vorschläge, keine Aufträge. Jede Zeile nennt, was dafür fehlt.

**Neue Stile** (ein Eintrag in `STYLE_PRESETS` plus Profil-Bedingung in Abschnitt 6):

| Stil | Profil | Fehlt dafür |
|---|---|---|
| Blues-Shuffle (12/8) | Blues-Shuffle | nichts: Groove `shuffle` gibt es; der Stil `blues` ist heute geswingter 4/4 |
| Slow Blues | Slow Blues | nichts: Groove `slowBlues` gibt es |
| Soul / R&B | Soul / R&B | Schlagwort oder Stil-Kennung zur Unterscheidung von Funk; Side-Stick (vorhanden), Tamburin (vorhanden) |
| Pop-Ballade | Pop / Ballade | Klavier wäre ideal; mit E-Piano sofort möglich |
| Bossa Nova | Bossa / Latin | Groove `latin` gibt es; Nylon-Gitarre (vorhanden), Side-Stick-Muster |
| Reggae (verbessert) | Reggae | nichts; heute wird Reggae nur aus zwei Schlagworten erraten |
| Jazz-Swing, Jazz-Ballade | Jazz | Ride-Becken, Walking-Bass-Muster, Besen-Wischen; Tempo bis 220 BPM (heute bis 200) |
| Rock'n'Roll | Blues-Shuffle mit `boogie` | Klavier für Achtel und Glissando; mit Gitarre sofort |
| Disco | Funk mit `octavePop` immer, offene Hat auf jedem „+“ | nichts |
| Folk / Singer-Songwriter | Country ohne Train-Beat, `boomChick`, `steel` | nichts |

Am wichtigsten wäre, dass der Track seinen Stil kennt: ein Feld `track.style` (ID des Stils), das die Oberfläche beim Wählen setzt. Dann entfällt das Erraten aus Schlagworten (Abschnitt 6), und Stile wie Soul und Funk lassen sich trennen.

**Neue Schlagworte.** Jedes würde p-Werte der Regeln verschieben, so wie heutige Schlagworte Muster-Parameter verschieben:

| Gruppe | Schlagwort | Wirkung |
|---|---|---|
| neu: Gitarre (Spielweise) | `palmMuted` | `palmMute` in allen Teilen hoch |
| | `chucking` | `chuck` an |
| | `skank` | Aufschlag auf 2 und 4, `choke` immer |
| | `openChords` | `letRing` hoch, `choke` aus |
| | `boomChick`, `boogie` | das jeweilige Muster an |
| `bass` (vorhanden) | `walking` | `approach` und Viertel-Linie |
| | `staccatoBass`, `legatoBass` | Grundhaltung der Notenlänge |
| | `slides` | `slideIn`, `slideOff` hoch |
| | `ghostNotes` | `dead` hoch |
| | `octaves` | `octavePop` an |
| `drums` (vorhanden) | `ride` | Ride statt Hi-Hat in allen Teilen |
| | `crossStick` | `sideStick` statt Snare |
| | `ghostNotes` | Ghost Notes hoch |
| | `openHat` | offene Hi-Hat häufiger |
| | `brushes` | Besen-Regeln (wählt heute nur der Nutzer als Kit) |
| neu: Tasten | `pedal`, `stabs`, `leslieFast` | die jeweilige Regel |
| neu: Verzierungen | `sparse`, `ornate` | verschiebt den Startwert von `ornaments` (0,3 / 0,8) |

**Vorhandene Schlagworte, die eine zusätzliche Wirkung bekämen:**

- `withBreakouts` (Gruppe `development`) ist heute das einzige Schlagwort ohne jede Wirkung. Es böte sich für „mehr Fills und Verzierungen am Phrasenende“ an (Budget aus Band-Regel 8 von 2 auf 3 Schichten, Fill-p hoch).
- `loose` und `driving` (`drums`): `loose` senkt `palmMute` und `staccato`, `driving` hebt sie.
- `calm` und `bouncy` (`bass`): `calm` → `legato`, `bouncy` → `staccato` und `octavePop`.
- `ringing` und `biting` (`chordSound`): `ringing` → `letRing`, `biting` → `choke`.
- `swelling` (`padSound`): Pad-`swell` länger.
- `syncopated` (`rhythm`): Ghost Notes und `dead` hoch (Frage 2).
