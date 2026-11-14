# SPIELREGELN – Spieltechniken je Instrument und Stil

Stand: 2026-11-14. Grundlage für SPEC_PHASE3.md (Artikulations-Schicht).
Alle Zahlen sind **Startwerte**, nicht gehört. Sie werden per A/B nach Gehör eingestellt.
`p` = Wahrscheinlichkeit, dass die Regel an einer passenden Stelle greift (vor dem Stil-Regler).

---

## 1. Grundprinzipien

1. **Weniger ist mehr.** Echte Musiker verzieren selten und an der richtigen Stelle. Im Zweifel niedrigere `p`.
2. **Übergänge sind der Ort für Verzierungen:** Akkordwechsel, Phrasenende (letzte 1–2 Schläge einer 2/4/8-Takt-Phrase), Formteil-Wechsel, vor Stopps. Mitten in der Phrase eher ruhig.
3. **Platz für den Solisten.** Der Nutzer spielt zum Backingtrack. Verzierungen dürfen ihn nicht zudecken: dichte Verzierungen vor allem am Phrasenende, nie mehrere Instrumente gleichzeitig (siehe Band-Regeln).
4. **Wiederholung mit Variation.** Groove ist Wiederholung. Nicht jede Note neu würfeln, sondern einen Verzierungs-Plan pro 2–4 Takte erzeugen. Bei der Wiederholung des Abschnitts den Plan zu ca. 70 % beibehalten, den Rest variieren.
5. **Energie-Kurve je Formteil.** Strophe zurückhaltend (gedämpft, kurz, geschlossene Hi-Hat), Refrain offen (ausklingen lassen, Ride/halboffene Hi-Hat, mehr Akzente), Bridge kontrastierend.
6. **Der Zielton kommt pünktlich.** Slides, Scoops, Rakes und Vorschläge beginnen *vor* der Zählzeit, damit der Zielton auf dem Raster (plus Groove-Offset) landet.
7. **Tempo skaliert.** Bei schnellem Tempo weniger und kürzere Verzierungen. Dauern an das Tempo koppeln, aber mit Unter- und Obergrenze in ms.
8. **Ein Regler „Verzierungen“ je Track (0–1, Standard 0,5)** skaliert alle `p`. 0 = alles aus (für A/B), 1 = doppelte `p` (gekappt bei 0,9).

## 2. Begriffe (Kurz-Glossar)

| Begriff | Bedeutung |
|---|---|
| 1 e + a | Zählweise der 16tel: „1“ = Zählzeit, „+“ = Achtel-Offbeat, „e“/„a“ = schwache 16tel |
| Backbeat | Zählzeiten 2 und 4 (Snare) |
| Ghost Note | sehr leise, eher gefühlte als gehörte Note (Snare oder Bass) |
| Dead Note | abgedämpfte Saite, perkussiver „Klack“ ohne klare Tonhöhe |
| Palm Mute (PM) | Handballen dämpft die Saiten am Steg: kurzer, dumpfer, druckvoller Ton |
| Chuck/Scratch | gedämpfter Gitarren-Anschlag: nur Geräusch, kein Akkord |
| Choke | Akkord sofort nach dem Anschlag abstoppen (Staccato-Stab) |
| Slide | Rutschen auf der Saite in den Zielton (hörbarer Tonhöhenverlauf) |
| Hammer-on/Pull-off | Ton durch Aufschlagen/Abziehen des Fingers ohne neuen Anschlag (legato) |
| Approach Note | Annäherungston einen Halbton über/unter dem nächsten Zielton |
| Turnaround | Wendung in den letzten 2 Takten eines Blues-Durchgangs zurück zum Anfang |
| Voicing | Lage und Auswahl der Akkordtöne |
| Leslie | rotierender Lautsprecher der Orgel; langsam („Choral“) oder schnell („Tremolo“) |

## 3. Kontext-Signale, die der Generator bereitstellen muss

Jede Regel unten greift auf diese Signale zurück:

- `beatPos`: Position im Takt (1, e, +, a … bzw. Triolen-Positionen)
- `isAccent`, `nextIsAccent`
- `isChordChange` (Note beginnt auf neuem Akkord), `lastBeforeChordChange` (letzte Note vor dem Wechsel)
- `phraseEnd` (letzte 1–2 Schläge einer 2/4/8-Takt-Phrase), `phraseStart`
- `beforeStop` (nächster Takt/Schlag ist Stopp oder Pause), `isFillBar`, `drumFillActive`
- `section` (intro/verse/chorus/bridge/outro) und `energy` 0–1
- `tempo`, `intervalToNext` (Halbtöne zur nächsten Note), `durToNext`
- `repetitionIndex` (wie oft dieser Abschnitt schon gespielt wurde, für Regel 4)

---

## 4. Instrumenten-Kataloge

Priorität: **A** = zuerst bauen, größte Wirkung · **B** = danach · **C** = später/optional.

### 4.1 E-Bass

| Artikulation | Was | Wann (Regel) | Startwerte | Prio |
|---|---|---|---|---|
| `sustain` | normal gezupft | Standard | – | – |
| `staccato` | kurz, abgedämpft, mit Dämpfgeräusch | Funk, Reggae-Akzente, vor Pausen, Rock-Achtel (Pick) | Dauer 30–60 % des Rasters | **A** |
| `legato` | Ton bis zur nächsten Note halten | Balladen, Soul, Reggae | Überlappung 0–10 ms | **A** |
| `dead` | Dead Note, perkussiv | schwache 16tel (e/a) vor betonter Note | vel 0,3–0,5, 30–60 ms | **A** |
| `slideIn` | von unten in den Zielton rutschen | `isChordChange` auf der 1, Phrasenanfang, Formteil-Start | meist 1–2 HT darunter (selten 5–7 HT = „langer Slide“); 40–100 ms, höchstens 1/16 | **A** |
| `slideOff` | „Fall“: Ton abwärts ausrutschen | `phraseEnd` vor Pause oder `beforeStop` | 3–7 HT abwärts, 100–250 ms, ausblendend | B |
| `hammer` / `pull` | Folgeton ohne Anschlag | 1–2 HT Abstand, in Fills/melodischen Stellen; Blues: kleine→große Terz | Folgeton −20 % vel, kein Anschlagsgeräusch | B |
| `approach` | Annäherungston (Notenwahl!) | `lastBeforeChordChange`: Halbton unter/über dem neuen Grundton | – | **A** |
| `octavePop` | Oktave, hell und kurz gezupft | Funk/Disco auf Offbeats | vel +10 %, kurz | B |
| `palmMute` | gedämpft mit Pick | Rock-Strophe, treibende Achtel | Tiefpass ~1–1,5 kHz, kurz | B |
| `vibrato` | leichtes Beben auf langen Noten | Noten ≥ 1 Schlag in Ballade/Slow Blues | ±10–20 ct, 5 Hz, Einsatz nach 200 ms | C |
| `slap`/`pop` | Slap-Technik | Funk (optional) | braucht Samples | C |

### 4.2 Kontrabass (Upright)

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| `pizz` | normal gezupft | Standard | – | – |
| `ghostSkip` | leiser Triolen-Vorschlag vor der Zählzeit | Walking Bass, vor betontem Schlag | vel 0,25, letztes Triolen-Achtel | B |
| `slideIn` | wie E-Bass, weicher | Phrasenanfang, Akkordwechsel | 1–2 HT, 60–120 ms | B |
| `fall` | Abrutschen am Ende | Schlussnote, `beforeStop` | 5–12 HT, 200–400 ms | C |
| `dead` | perkussiver Klack | Swing, vor Akzenten | vel 0,3 | C |

### 4.3 Rhythmusgitarre

| Artikulation | Was | Wann (Regel) | Startwerte | Prio |
|---|---|---|---|---|
| `down` / `up` | Anschlagrichtung | Zählzeiten und „+“ = Abschlag; „e“/„a“ bzw. Offbeat bei Achteln = Aufschlag. Hand pendelt durch, ausgelassene Anschläge sind Luftschläge | Abschlag: tief→hoch; Aufschlag: hoch→tief, nur obere 3–4 Saiten, vel −15 % | **A** |
| Strum-Zeit | Versatz zwischen Saiten | abhängig von Lautstärke, Tempo, Gitarrentyp | 8–15 ms (leise/schnell/E-Gitarre) bis 20–35 ms (laut/langsam/Akustik) | **A** |
| `stringSet` | welche Saiten | `low` (Powerchords, 2–3 Saiten), `full` (5–6), `high` (obere 3–4: Funk, Soul, Reggae) | je Stil | **A** |
| `palmMute` | gedämpft am Steg | Rock-Strophe, treibende Achtel, Powerchords | Strophe p 0,7, Refrain p 0,1–0,2 | **A** |
| `chuck` | gedämpfter Geräusch-Anschlag | Funk: alle unbetonten 16tel; Akustik-Pop: auf 2 und 4 | Funk: Mehrheit der Anschläge; Pop p 0,3 | **A** |
| `choke` | Akkord sofort abstoppen | Funk-Stabs, Reggae-Skank (immer), vor Stopps | Dauer ≈ 1/16 | **A** |
| `letRing` | ausklingen lassen | letzter Akkord vor Pause/Ende, Refrain-Akzente, Balladen | Release lang, nächster Akkord überblendet | **A** |
| Arpeggio-Überlappung | gezupfte Akkordtöne klingen weiter | Balladen, Folk, ruhige Strophen | vorherige Töne nicht abschneiden, bis Akkordwechsel halten | **A** |
| `slideChord` | Akkord von 1 Bund darunter/darüber anrutschen | Funk (9er-Akkorde), Blues, Soul; auf Akzent-Anfängen | p 0,15, 40–80 ms | B |
| `embellish` | Hammer-on im Akkord (sus2/sus4 → Dur) | gehaltene Akkorde in Pop, Rock, Soul, Country | p 0,15 | B |
| `boomChick` | Basston auf 1/3 (Wechselbass Grundton/Quinte), Anschlag auf 2/4 | Country, Folk | Muster | B |
| `boogie` | Riff Quinte–Sexte (–kleine Septime) auf tiefen Saiten | Blues-Shuffle, Rock'n'Roll | mit PM p 0,5 | B |
| `doubleStop` | Zweiklang-Fills (Sexten/Terzen) | Soul/R&B am `phraseEnd` | p 0,25 | C |
| `rake` | gedämpftes Durchstreichen vor dem Akzent | Funk/Blues-Akzente | 20–40 ms vor dem Schlag | C |

### 4.4 Klavier

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| `pedal` | Haltepedal, bei jedem Akkordwechsel neu („Legato-Pedal“) | Ballade, Pop, Gospel: immer; Rock/Blues: teilweise; Jazz: kaum | Pedal 30–80 ms *nach* dem neuen Akkord treten, 20–50 ms *vor* dem nächsten lösen | **A** |
| Stimmen-Gewichtung | oberster Ton (Melodie) lauter, Mittelstimmen leiser | immer | Oberstimme +10 % vel, Mittelstimmen −10 % | **A** |
| `staccato` | kurze Akkord-Stabs | Jazz-Comping, Funk/Soul-Stabs, Rock'n'Roll-Achtel | 1/16–1/8 | **A** |
| `roll` | Akkord schnell von unten nach oben brechen | Balladen, Schlussakkorde, Akzente | 15–40 ms gesamt, p 0,2 | B |
| `crush` | Vorschlag kleine→große Terz fast gleichzeitig | Blues, Gospel auf Akkordtönen | kleine Terz 30–60 ms, dann loslassen; p 0,2 | B |
| Register-Regel | linke Hand nicht zu tief | wenn Bass spielt | linke Hand nicht unter ca. C3 | **A** |
| `tremolo` | schneller Wechsel zwischen Akkordtönen | Rock'n'Roll/Gospel im Aufbau | 1/16 oder 1/32 | C |
| `gliss` | Glissando über die Tasten | Rock'n'Roll-Übergänge | – | C |

### 4.5 E-Piano (Rhodes/Wurlitzer)

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| `pedal` | wie Klavier | Balladen, Soul | wie 4.4 | **A** |
| `bark` | hoher Anschlag → angezerrter, bellender Ton | Akzente in Soul/Funk | Anschlag → Zerre/Helligkeit | B |
| Tremolo/Autopan | Pendeln der Lautstärke/Stereo | als Song-Einstellung, nicht je Note | Ballade 3–4 Hz, Funk 5–6 Hz | B |
| Stabs | wie Klavier-Staccato | Funk, Soul | – | B |

### 4.6 Orgel (synthetisiert)

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| Leslie langsam/schnell | Geschwindigkeit des rotierenden Lautsprechers | schnell: Refrain, Aufbau, letzter Takt vor Refrain; langsam: Strophe, Ballade | Hochlaufen ~1 s, Auslaufen ~2–3 s (asymmetrisch, das Übergangsgeräusch ist Teil des Klangs) | **A** |
| `swell` | Expression-Pedal (Lautstärke-Schweller) | Crescendo in den Refrain, Decrescendo zum Ende | über 1–2 Takte | B |
| Percussion | kurzer Anschlag-Oberton | Jazz/Blues-Staccato; aus bei Flächen. Wie beim Original nur beim ersten Ton, wenn keine andere Taste gehalten wird | – | B |
| Key-Click | Anschlag-Klick | immer leicht, stärker bei Rock | – | B |
| Stabs vs. Fläche | kurze Akkorde oder gehaltene Akkorde | Funk/Gospel-Stabs; Blues/Soul-Flächen | – | B |
| Reggae-„Bubble“ | Offbeat-16tel-Muster | Reggae | Muster | C |
| `smear` | Handflächen-Glissando | Gospel/Rock-Übergänge | – | C |

### 4.7 Pad und Streicher

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| `swell` | weich einblenden | neuer Formteil, Akkordwechsel in Balladen | Attack 0,3–1,5 s | **A** |
| Stimmführung | gemeinsame Töne halten, andere Stimmen in kleinsten Schritten bewegen | immer | – | **A** |
| Dichte-Regel | nur in Refrain/Bridge oder Balladen | Strophen meist leer | – | **A** |
| `tremolo` | Streicher-Tremolo | Aufbau vor dem Refrain | – | C |

### 4.8 Schlagzeug

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| Hi-Hat-Akzentmuster | Lautstärke nach Position | immer | Achtel: Zählzeit 1,0 / „+“ 0,7; 16tel: 1,0 / 0,6 / 0,8 / 0,6 | **A** |
| Hi-Hat geschlossen / halboffen / offen / Fuß | Artikulationen | geschlossen: Strophe; halboffen: Rock-Refrain; offen auf „+“ oder „a“ und auf der nächsten Zählzeit schließen (Disco/Funk); Fuß-„Chick“ auf 2 und 4 (Jazz, oder wenn Ride spielt) | offene Hat wird von der nächsten geschlossenen abgewürgt | **A** |
| Ride statt Hi-Hat | Becken-Wechsel nach Formteil | Strophe Hi-Hat, Refrain Ride; Jazz immer Ride; Ride-Glocke für Akzente (Latin, Funk, Rock-Refrain) | – | **A** |
| Snare: Mitte / Rimshot / Cross-Stick | Schlagarten | Rimshot: Rock-Backbeat im Refrain; Cross-Stick: Ballade-Strophe, Bossa, Reggae, leise Blues-Durchgänge | – | **A** |
| Ghost Notes | leise Snare-Schläge | Funk/Soul/R&B auf „e“/„a“; Shuffle auf dem letzten Triolen-Achtel | vel 0,15–0,3 | **A** (gibt es schon) |
| Crash + Choke | Crash auf der 1 nach Fill/Formteil; bei Stopps sofort abwürgen | Formteil-Wechsel; `beforeStop` | Choke nach 50–150 ms | **A** |
| Fills | Tom-/Snare-Figuren | Ende einer 4/8-Takt-Phrase; Länge meist 1–2 Schläge, ganzer Takt nur bei Formteil-Wechseln; Start meist auf 3 oder 4; nicht jede Phrase gleich | – | B (gibt es teilweise) |
| Flam / Drag | Doppelschlag-Verzierungen | in Fills und Akzenten | Flam 15–30 ms Vorschlag | B |
| Wirbel | Buzz-Roll mit Crescendo | in den Refrain hinein | gibt es (Songform) | – |
| Jazz-Kick „Feathering“ | sehr leise Viertel auf der Bassdrum | Swing | vel 0,2–0,3 | B |
| Besen | Wischen (kontinuierliches Rauschen) + Tupfer auf 2 und 4 | Jazz-Ballade, leise Stellen | braucht Besen-Samples/Rauschen | B |

### 4.9 Percussion

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| Shaker vor/zurück | zwei Klangfarben je Richtung | immer abwechselnd vor/zurück, Akzente auf Offbeats oder Zählzeiten je Stil | zwei Round-Robin-Gruppen | B |
| Tamburin | auf 2 und 4, im Aufbau geschüttelt | Refrain in Soul, Gospel, Pop | – | B |
| Conga: offen / Slap / gedämpft / Ballen-Spitze | Schlagarten | Tumbao-Grundmuster: Ballen-Spitze auf 1, Slap auf 2, zwei offene Töne auf 4 und „+“ | – | C |
| Bongo „Martillo“ | durchlaufendes Achtel-Muster | Latin | – | C |
| Claves | Clave-Muster (3-2/2-3) | Latin; Bossa mit eigenem Rim-Click-Muster | – | C |
| Cowbell | Akzente | Latin, Funk, Rock | – | C |

### 4.10 Lead (Saxofon, Flöte)

| Artikulation | Was | Wann | Startwerte | Prio |
|---|---|---|---|---|
| `scoop` | von unten in den Ton schleifen | Phrasenanfang, betonte Noten | 50–100 ct darunter, 50–100 ms | B |
| `fall` | Abfallen am Phrasenende | Saxofon, `phraseEnd` | 2–5 HT, 150–300 ms | B |
| verzögertes Vibrato | Vibrato erst nach dem Einschwingen | Noten ≥ 1 Schlag | Einsatz nach 150–300 ms, 5–6 Hz | B |
| Legato-Gruppen | erste zwei Töne gebunden, Rest angestoßen | schnelle Linien | – | C |
| Ghosted Notes | verschluckte Töne in Jazz-Linien | Jazz-Sax | vel 0,3 | C |

---

## 5. Band-Regeln (Zusammenspiel)

1. **Bass und Kick sind gekoppelt.** Bass-Hauptnoten liegen auf Kick-Schlägen, Bass-Slides enden auf dem Kick.
2. **Nur einer füllt.** Während eines Drum-Fills: Bass spielt einfach (keine Slides, keine Fills), Gitarre `letRing`. Bass-Fills nur, wenn die Drums keinen Fill spielen.
3. **Stopps spielen alle zusammen.** `beforeStop`: Crash mit Choke, Gitarre `choke`, Bass `staccato`, Keys kurz.
4. **Comping aufteilen.** Gitarre und Keys spielen nicht beide dicht im selben Register. Spielt die Gitarre 16tel-Funk, halten die Keys Flächen oder setzen sparsame Stabs auf andere Positionen.
5. **Register trennen.** Gitarren-Voicings in der Mittellage, Keys darüber oder darunter, linke Hand nicht unter C3, wenn Bass spielt.
6. **Formteil-Übergang als Aufbau.** Letzter Takt vor dem Refrain: Drum-Fill, Leslie schnell, Pad-Swell, Bass `slideIn` auf die 1, Crash auf der 1.
7. **Gemeinsame Akzente.** Hat das Muster „Hits“ (Band-Akzente), betonen alle Instrumente sie gleichzeitig.
8. **Verzierungs-Budget.** Höchstens eine auffällige Verzierung (Slide, Fill, Roll, Fall) pro Instrument und Phrasenende. Und nicht mehr als zwei Instrumente gleichzeitig.

---

## 6. Stil-Profile

Falls die App Stile/Tags anders benennt (z. B. `swing`, `funky`, `straight`), legt SPEC_PHASE3 das Mapping fest. Stile, die die App nicht kennt, ignorieren.

**Blues-Shuffle** (Triolen-Feel, 80–140 BPM)
- Bass: Walking/Boogie-Linie; `approach` vor Akkordwechsel p 0,4; `slideIn` auf Akkordwechsel p 0,25; `slideOff` am Phrasenende p 0,2; überwiegend legato.
- Gitarre: Boogie-Riff (`boogie`, PM p 0,5) oder 9er-Akkorde; `slideChord` p 0,15; Turnaround in Takt 11–12; letzter Akkord `letRing`.
- Keys: Klavier `crush` p 0,2, Triolen-Comping, `roll` auf dem Schlussakkord; Orgel Leslie langsam, im letzten Durchgang schnell.
- Drums: Shuffle auf Hi-Hat/Ride, Ghost Notes auf dem letzten Triolen-Achtel p 0,2; Cross-Stick in leisen Durchgängen; Fill in Takt 12; Crash auf der 1 des neuen Durchgangs.

**Slow Blues** (12/8, 50–75 BPM)
- Bass: lange Noten, `slideIn` p 0,3, `vibrato`; Ghost-Triole vor der 1.
- Gitarre: 9er-Akkorde, Triolen-Arpeggien mit Überlappung, `letRing`, `slideChord` p 0,25.
- Keys: Orgelfläche mit `swell`, Klavier 12/8-Akkorde mit `crush`.
- Drums: Triolen auf Ride/Hi-Hat, Rimshot oder Cross-Stick auf dem Backbeat, große Fills im Turnaround.

**Rock** (gerade, 100–150 BPM)
- Bass: Pick, Achtel durchgehend, `palmMute` in der Strophe p 0,5; `slideIn` am Formteil-Start p 0,15; `slideOff` vor Stopps p 0,3; Dead Notes kaum (p 0,05).
- Gitarre: Powerchords (`stringSet: low`), PM Strophe p 0,7 / Refrain p 0,1, Refrain-Akzente `letRing`, `choke` vor Stopps.
- Keys: Orgel angezerrt, Leslie schnell im Refrain; Klavier Achtel.
- Drums: Hi-Hat geschlossen (Strophe) → halboffen/Ride (Refrain), Rimshot im Refrain, Crash auf der 1, Fills alle 4/8 Takte.

**Funk** (16tel, gerade oder leicht geswingt, 90–115 BPM)
- Bass: `dead` p 0,35; `octavePop` p 0,3; überwiegend `staccato`; `slideIn` auf die 1 p 0,15; `hammer` in Fills p 0,2. Pausen sind Teil des Grooves, die „1“ ist heilig.
- Gitarre: 16tel-Pendel, Mehrheit `chuck`, Akzente offen und `choke`, `stringSet: high`, `slideChord` (9er) p 0,2, Aufschläge auf e/a.
- Keys: E-Piano/Klavier-Stabs staccato, `bark` auf Akzenten; Orgel-Stabs. Nicht gleichzeitig mit der Gitarre dicht (Band-Regel 4).
- Drums: Ghost Notes p 0,4 auf e/a, Hi-Hat-16tel mit Akzenten, offene Hat auf „+“ der 4 oder „a“ p 0,3.
- Percussion: Conga, Tamburin-16tel, Cowbell.

**Soul / R&B** (70–110 BPM, oft geswingte 16tel)
- Bass: legato mit Ghost Notes p 0,2; `slideIn` p 0,2; `hammer` als Verzierung.
- Gitarre: `doubleStop`-Fills am Phrasenende, `choke`-Stabs auf 2 und 4, `stringSet: high`, `slideChord` p 0,15.
- Keys: Rhodes mit Tremolo und `pedal`; Orgelfläche mit langsamem Leslie.
- Drums: Snare 2 und 4 mit Ghost Notes p 0,25, Cross-Stick in der Strophe; Tamburin auf 2 und 4 im Refrain.

**Pop / Ballade** (60–90 BPM)
- Bass: legato, lange Noten, `slideIn` selten (p 0,1), leichtes `vibrato`.
- Gitarre: Strophe Akustik-Arpeggio mit Überlappung; Refrain Ab-/Aufschlag mit `chuck` auf 2 und 4 p 0,3; `embellish` p 0,15.
- Keys: Klavier immer `pedal`, `roll` auf Akzent-Akkordwechseln p 0,2, Oberstimme lauter; Pad-Swell im Refrain.
- Drums: Cross-Stick (Strophe) → Snare Mitte/Rimshot (Refrain), Hi-Hat → Ride, Crash auf der 1, sparsame Fills, Wirbel in den Refrain. Shaker in der Strophe.

**Jazz-Swing** (120–220 BPM)
- Bass: Walking-Viertel, `approach` auf Schlag 4 zum nächsten Akkord p 0,5; `ghostSkip` p 0,15; im Thema gelegentlich „2-Feel“ (Halbe).
- Gitarre: Viertel-Comping (kurz, Mittelsaiten, `choke`) oder Charleston-Rhythmus.
- Keys: Klavier staccato im Charleston-Rhythmus (1 und „+“ der 2) oder Vorziehen auf „+“ der 4; kein Pedal.
- Drums: Ride „spang-a-lang“ mit Akzent auf 2 und 4, Hi-Hat-Fuß auf 2 und 4, Kick-Feathering vel 0,2; Snare-Comping selten (p 0,1) auf Triolen-Positionen; kurze Fills in Takt 8; Besen in leisen Teilen.

**Jazz-Ballade** (50–80 BPM)
- Bass: 2-Feel, Slides, lange Noten.
- Keys: Klavier `roll`, `pedal`, sparsam.
- Gitarre: Akkorde als Arpeggien mit Überlappung.
- Drums: Besen-Wischen + Tupfer auf 2 und 4, leichtes Ride. Streicher-Pad optional.

**Reggae** (60–90 BPM, One Drop)
- Bass: rund und legato, Betonung auf der 3, die 1 oft frei; kleine `slideIn`.
- Gitarre: Skank auf 2 und 4 als Aufschlag, `stringSet: high`, **immer** `choke`.
- Keys: Orgel-„Bubble“, Klavier doppelt den Skank.
- Drums: One Drop (Kick + Cross-Stick/Rimshot auf der 3), Hi-Hat-Achtel geswingt, sparsame Tom-Fills.
- Percussion: Shaker.

**Bossa Nova / Latin** (Bossa 120–150 BPM)
- Bass: Grundton auf der 1, Quinte auf der 3 (oft vorgezogen auf „+“ der 2), legato.
- Gitarre (Nylon): Daumen-Bass auf 1 und 3, synkopierte Akkorde mit den Fingern, leise.
- Keys: weiches Comping.
- Drums: Cross-Stick-Bossa-Muster, Hi-Hat oder Shaker in Achteln, Kick leise auf 1 und 3.
- Percussion: Shaker, Claves, leise Conga.

**Country** (gerade/Two-Beat, 90–160 BPM)
- Bass: Wechselbass Grundton/Quinte auf 1 und 3; Walk-up zum neuen Akkord p 0,4 (3 Schritte vom alten zum neuen Grundton); `slideIn` p 0,1.
- Gitarre: `boomChick` mit Wechselbass, `embellish` (sus2 → Dur) p 0,2.
- Keys: Klavier mit `roll` und Vorschlägen (Honky-Tonk).
- Drums: Train-Beat oder Two-Beat mit Cross-Stick-Backbeat, Kick auf 1 und 3. Percussion: Shaker/Tamburin.

---

## 7. Klang-Umsetzung und Fallbacks

Jede Stimme braucht für jede Artikulation einen Fallback: Fehlt das Sample, nimmt sie die DSP-Variante oder spielt die Note normal (`sustain`).

| Artikulation | Mit Samples | DSP-Fallback |
|---|---|---|
| `staccato`, `choke` | Release-/Dämpf-Sample | kurze Hüllkurve, schnelles Ausblenden (10–30 ms) |
| `dead`, `chuck` | Geräusch-/Mute-Samples | sehr kurzer, stark gefilterter Anschlag (Tiefpass, 20–40 ms) |
| `palmMute` | PM-Samples | Tiefpass ~800–1500 Hz + schnelles Abklingen (Notlösung) |
| `slideIn`, `slideOff`, `fall`, `scoop`, `bend` | – | `playbackRate`-Rampe; dazu optional ein leises Rutschgeräusch |
| `hammer`, `pull`, Legato | Legato-Samples (selten) | Folgenote mit Sample-Start hinter dem Anschlag, kurze Überblendung, leiser |
| `vibrato` | – | LFO auf `playbackRate` |
| `letRing`, Arpeggio-Überlappung | Release-Samples | lange Release, Töne nicht abschneiden |
| `pedal` | Pedal-Samples (Salamander hat keine; optional) | Note-Off bis Pedal-Ende verzögern |
| Leslie | – | Synth: Amplituden- und Doppler-Modulation, getrennt für Horn und Rotor, mit Trägheit |
| Hi-Hat-Artikulationen, Rimshot, Cross-Stick | Samples der Drum-Library | – (braucht Samples) |

---

## 8. Umsetzungs-Reihenfolge

1. **Prio A, Bass und Gitarre:** `staccato`/`legato`, `dead`, `slideIn`, `approach`; Ab-/Aufschlag, Strum-Zeit, `stringSet`, `palmMute`, `chuck`, `choke`, `letRing`, Arpeggio-Überlappung.
2. **Prio A, Rest:** Klavier `pedal` und Stimmen-Gewichtung, Drums (Hi-Hat-Muster und -Artikulationen, Ride-Wechsel, Snare-Schlagarten, Crash-Choke), Pad-Swell und Stimmführung, Band-Regeln 1–3 und 8.
3. **Prio B**, danach **Prio C**.

### Testfälle für die A/B-WAVs

- **Funk 100 BPM, 8 Takte:** Dead Notes, Chucks, Chokes, offene Hi-Hat.
- **Rock 120 BPM, 4 Takte Strophe + 4 Takte Refrain:** PM → offen, Hi-Hat → Ride, Crash, `slideIn` am Refrain-Start.
- **Blues-Shuffle 90 BPM, 12 Takte:** Approach Notes, Slides, Turnaround, Fill in Takt 12.
- **Ballade 70 BPM, 8 Takte:** Pedal, Arpeggio-Überlappung, Pad-Swell, Cross-Stick.
