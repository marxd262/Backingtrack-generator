# Oberfläche im Rack-Stil: Spielseite, Mixer, Makros, Startseite (Design)

Abgestimmt im Chat am 2026-11-13 mit klickbaren Entwürfen. Die freigegebenen Entwürfe liegen neben diesem Dokument und sind Teil der Vorgabe:

- [`2026-11-13-rack-ui/rack.html`](2026-11-13-rack-ui/rack.html): Spielseite in beiden Zuständen (Schalter oben rechts), mit Rack und Mixer
- [`2026-11-13-rack-ui/start.html`](2026-11-13-rack-ui/start.html): Startseite mit Wortwolke

Beide öffnen sich direkt im Browser. Inhalte darin (Makro-Namen, welche Detailregler ein Makro bewegt, Wörter der Wolke, Beschriftungen) sind **Vorschläge**, die Anordnung, die Bedienelemente und die Regeln unten sind **entschieden**. Wo „meine Entscheidung“ steht, hat der Nutzer sie noch nicht ausdrücklich bestätigt.

## Absicht und Warum

Die App ist über viele Funktionen gewachsen. Heute: 13 Knöpfe in der Kopfzeile, links 13 Klappgruppen, rechts 3, Mixer und Profile als eigene Fenster, 37 Klangschieber. Der Nutzer hat beim letzten Spielen erlebt:

1. **Spiel-Infos nicht im Blick.** Der Akkordkreis liegt unter dem Bildrand, der Verlauf der Instrumente ebenso.
2. **Instrumente umstellen ist mühsam.** Um alles auf Samples zu stellen, musste er sechs Gruppen aufklappen und sechs Dropdowns bedienen. Die Synth-Stimmen klingen ihm zu künstlich, er will gezielt alles auf Samples.
3. **Schlagworte sind undurchsichtig.** Man sieht nicht, was ein Wort bewirkt, welche sich ausschließen (Gegensätze entscheidet heute der Zufall, `OPPOSITES` in `src/core/tags.js`), welche kombinierbar sind; manche tun gar nichts (`INERT_TAGS`); die Liste ist lang (44 Wörter in 10 Kategorien); und ein einmal bewegter Regler hört stumm auf, den Schlagworten zu folgen.
4. **Zu viel Luft.** Große Abstände, dadurch noch unübersichtlicher.

Der Hauptzweck der App ist **Backingtracks erzeugen und visualisieren**: Ohne Visualisierung weiß man nicht, wo man ist und was man spielt. Stilvorbild ist **VCV Rack mit den Modulen von Mutable Instruments**: helle Frontplatten auf dunklen Rack-Schienen, schwarze und weiße Drehknöpfe, Türkis und Pink als einzige Akzentfarben, grünes LCD, kleine LEDs, gepunktete Verbindungslinien, dichte Anordnung, alles Wichtige auf der Frontplatte statt in Untermenüs.

## Ziele

1. **Ein Bildschirm, zwei Zustände** auf der Spielseite, umgeschaltet mit einem Schalter **Fokus / Einstellen** in der Kopfleiste.
   - **Fokus:** nur Visualisierung, groß; keine Einstellungen.
   - **Einstellen:** dieselbe Visualisierung, flacher, und darunter das **Rack** mit allen Einstellungen. Die Visualisierung bleibt sichtbar, damit man beim Drehen die Wirkung sieht.
2. **Visualisierung immer vollständig sichtbar, ohne Klick und ohne Scrollen:** Tonart und Skala, nächster Akkord, Griffbrett, Akkordkreis mit Progression, Songform mit Position, und je Instrument eine Spur, die zeigt, wie dicht es spielt.
3. **Rack aus Modulen**, jedes eine Frontplatte mit allem, was zu ihm gehört. Keine Klappgruppen mehr.
4. **Schlagworte werden zweigeteilt:** auf der Startseite eine **Wortwolke** zum Beschreiben; im Rack **Makro-Regler** je Instrument, deren Wirkung auf die Detailregler sichtbar ist.
5. **Ein Griff für „alles auf Samples“.**
6. **Mixer als eigenes Modul** mit Fader, Pan und Stumm je Instrument und einer Pegelanzeige.
7. **Startseite** mit Satz (Tonart, Stil, Tempo), Wortwolke, „Überrasch mich“ und „Weitermachen“.

## Nicht-Ziele

- **Kleine Bildschirme.** Ziel sind große Monitore (Entwürfe gebaut für 1600 × 960). Unterstützung für Tablet und Handy folgt in einem späteren Schritt. Bis dahin: Ist das Fenster schmaler als das Rack, scrollt **nur das Rack** waagerecht; die heutigen Schubladen für schmale Fenster entfallen (meine Entscheidung, ausdrücklich ein Rückschritt für schmale Fenster, den der Nutzer in Kauf nimmt).
- Kabel/Patchen wie in VCV Rack. Es gibt keine Buchsen; der Rack-Stil ist Optik und Ordnung, keine Modularsynthese.
- Neue Klangfunktionen außer **Pan**, **Pegelmessung** (siehe Mixer) und der **Klangbearbeitung je Spur** (siehe „Makros wirken auf jede Stimme“).
- Ein frei anordenbares Rack (Module verschieben, eigene Module).
- Ein dunkles und ein helles Thema. Es gibt genau den einen Rack-Look.

## Anti-Ziele (Fehlschlag, auch wenn es technisch läuft)

- Beim Spielen muss man klicken oder scrollen, um Tonart, nächsten Akkord, Griffbrett, Akkordkreis, Form oder Spuren zu sehen.
- Ein Regler hört **stumm** auf, auf etwas zu reagieren (heute: bewegter Regler ignoriert danach die Schlagworte). Jede Wechselwirkung muss sichtbar sein.
- Zwei Wörter, die sich widersprechen, können gleichzeitig gewählt sein, und der Zufall entscheidet.
- Ein Bedienelement gibt es doppelt (heute: Tempo, Tonart/Skala, Stumm je zweimal).
- Die Oberfläche ist mit Tastatur oder Screenreader schlechter bedienbar als heute (heute: jede Gruppe und jeder Regler hat Beschriftung, `aria-*`, Fokusführung).
- Text, der kleiner als 11 px ist. Die Entwürfe haben teils 8 px, das ist der Platznot im Entwurf geschuldet, nicht die Vorgabe.
- Gespeicherte Profile und Profildateien von heute laden nicht mehr oder klingen danach anders.
- Gleicher Track + gleicher Seed ergibt andere Ereignisse als heute, solange nichts an Makros oder Wörtern geändert wurde (`tests/core/golden.test.js`).

## Gestaltung (Rack-Look)

Entschieden, Werte im Entwurf `rack.html` (CSS-Variablen in `:root`):

- **Rack:** Hintergrund fast schwarz, waagerechte Schienen mit Lochreihe oben und unten am Rack, 3 px Fuge zwischen Modulen.
- **Modul:** helle Platte (`#e9e9e6`), feiner Rand, zwei Schraubenpunkte oben, **Titel klein in Kleinbuchstaben oben rechts**.
- **Akzente:** nur **Türkis** (`#18a2a6`) und **Pink** (`#e3465e`). Sonst Grautöne und Schwarz.
- **Displays:** grünes LCD (`#161a14` / `#b9f26b`, zweite Farbe `#6fe3e6`) für alles, was ein gewählter Wert ist: Tonart, Skala, Stil, Tempo, Stimme, Vorlage, Takt, Variante, Teil-Typ, Länge, Übergang.
- **Drehknöpfe:** groß weiß mit schwarzem Rand (Haupt­regler wie Tempo), mittel schwarz, Makros mit türkiser oder pinker Kappe, klein schwarz für Details.
- **Tasten:** kleine schwarze Quadrate mit weißem Ring; runde schwarze Taster für Aktionen (Start/Stop, würfeln, Los); LEDs für An/Aus und Auswahl aus wenigen Werten (Taktart, Akkordfarbe, Crash, Sperre, Stumm, Namen/Stufen).
- **Beschriftung:** Barlow (Text) und Share Tech Mono (Displays), Großbuchstaben für Reglernamen. Mindestgröße 11 px (siehe Anti-Ziele).
- **Dichte:** enge, gleichmäßige Abstände wie im Entwurf; keine Klappgruppen.

### Bogen an Drehknöpfen

Jeder Drehknopf zeigt einen farbigen Bogen **vom Ausgangswert bis zur Zeigerspitze**:

- Regler **mit Mitte** (Ausgangswert 0,5 bzw. zweipolig): Bogen ab **12 Uhr**, nach links **türkis**, nach rechts **pink**. Das sind alle Makros, Komplexität, Struktur, Dynamik, Pan, Helligkeit, Hall, Echo, Pegel und Dichte eines Teils und alle Detailregler, deren Wert in `DEFAULT_TIMBRE` 0,5 ist.
- Regler, die **bei null beginnen** (Ausgangswert 0 in `DEFAULT_TIMBRE`, z. B. Fuzz, Overdrive, Distortion, Sub, Rundung, Chorus, Tremolo, Schimmer, Raum) sowie Pausen und Zufall: Bogen ab dem **linken Anschlag**, pink (meine Entscheidung zur Farbe).
- **Wähler** (Tonart, Skala, Tempo): kein Bogen, der Wert steht im Display.

### Farben der Akkorde (gilt überall gleich)

- **Pink** = jetzt klingender Akkord.
- **Hellpink mit pinkem Rand** = derselbe Akkord geht im nächsten Schritt weiter.
- **Türkis** = nächster **Wechsel** (nächster Akkord mit anderen Tönen). Griffbrett, Tonart-Modul („nächster“), Akkordkreis und Progression zeigen dasselbe.
- **Weiß** = später.

## Spielseite

### Seitenaufbau und Platz (meine Entscheidung)

- Maßstab ist die **Fenster-Innengröße** 1600 × 960. Bei Beschriftungen ab 11 px werden die Module größer als im Entwurf; dann gilt: Die Kopfleiste und die Visualisierung bleiben **fest sichtbar** (Mindesthöhen so, dass Griffbrett, Akkordkreis und alle Spuren lesbar bleiben), das Rack bekommt den Rest der Höhe und **scrollt in sich**, senkrecht wie waagerecht. Die Seite selbst scrollt nie.
- **Aufruf der App:** Es öffnet immer die Startseite (dort steht „Weitermachen“). Zurück zur Startseite geht es über den Namen der App in der Kopfleiste (ersetzt den heutigen Knopf „Zum Start“); die Wiedergabe läuft dabei weiter wie heute.

### Kopfleiste (immer da)

Start/Stop (runder Taster mit LED), Takt `005 / 096`, aktueller Teil (`VERSE 1`), Variante mit ‹ › und Würfel, Name der App (führt zur Startseite), Schalter **Fokus / Einstellen**, Profile, Sprache DE/EN.

### Visualisierung (oben, in beiden Zuständen)

Obere Reihe:

- **Tonart:** große Anzeige der Tonart (`Am`), Skala darunter, dann **„nächster · in N Schlägen“** mit dem nächsten Wechsel (`Dm`). Der Countdown in Schlägen ist neu.
- **Griffbrett:** wie heute (Skalentöne, aktueller Akkord, Grundton mit Ring, nächster Akkord, in beiden, außerhalb der Skala), in den Farben oben. Umschalter **Namen / Stufen** direkt am Modul. Die Legende nur im Fokus.
  - **22 Bünde** plus Leersaiten (heute `FRETS = 15` in `src/core/fretboard.js`), Bundmarken bei 3, 5, 7, 9, 12 (doppelt), 15, 17, 19, 21.
  - **Bundmarken deutlich** (vom Nutzer gewünscht, heute zu versteckt): markierte Bünde leicht dunkler hinterlegt, Punkte größer und dunkler, und die Bundzahlen in einer eigenen Zeile unter dem Griffbrett, wo keine Note sie verdecken kann (Entwurf: 12 px, halbfett, dunkelgrau).
  - Zweiter Umschalter am Modul: **echte Bünde / gleich breit** (vom Nutzer gewünscht, um es im Spiel auszuprobieren). Echte Bünde = Abstände nach 12tel-Teilung wie heute; gleich breit = alle Bünde gleich. Standard: echte Bünde. Die Wahl merkt sich der Browser wie die anderen Layout-Einstellungen (`layoutStorage`). Bei echten Bünden werden die Notenkreise in engen Bünden kleiner, damit sie hineinpassen (Entwurf: Radius höchstens 40 % der Bundbreite); sie bleiben lesbar.
  - Platz bei 1600 px Fensterbreite: ~1150 bis 1200 px Breite, also ~52 px je Bund (gleich breit) bzw. ~89 px bis ~27 px (echt).
- **Akkorde:** Quintenzirkel (Dur außen, Moll innen; aktuell pink, nächster türkis, Leitertöne grau hinterlegt, weitere Akkorde der Progression umrandet; Tonart in der Mitte) und darunter die **Progression mit Stufen** (i, iv, V).

Untere Reihe, über die ganze Breite:

- **Form & Spuren:** der Formstreifen (Breite = Takte, Höhe = Pegel, wie heute) und direkt darunter **eine Spur je Instrument** auf derselben Takt-Achse (Deckkraft = Dichte je Takt, wie der heutige Verlauf `src/ui/lanes.js`; stumme Spuren gestreift; LED je Spur blinkt, wenn das Instrument spielt). Abspielmarke über Streifen und Spuren. Gesperrte Teile mit schwarzer Ecke.
- **Im Zustand Einstellen** klappen links und rechts vom Streifen zwei gleich aufgebaute Felder auf (Displays oben, Drehregler darunter, Tasten unten hinter einer gepunkteten Linie):
  - links **ganzes Lied:** Vorlage, Zielgröße, Struktur, Dynamik, Pausen, Zufall; Tasten würfeln, + Teil.
  - rechts **gewählter Teil:** Kästchen „TEIL N“ in der Farbe des Blocks (sonst keine Einfärbung), Typ, Länge, Übergang davor, Pegel, Dichte; Tasten schieben ‹ ›, kopieren, löschen, Crash, Sperre.
  - Klick auf einen Teil im Streifen wählt ihn. Der gewählte Teil zeigt Griffe an den Kanten: **Länge durch Ziehen** ist neu (zusätzlich zu − / +).
  - Im Fokus verschwinden beide Felder.

Heute vorhandene Bedienung der Form (Pfeiltasten, Pos1/Ende, Enter im Streifen; Sperrlogik) bleibt erhalten.

### Rack (nur im Zustand Einstellen)

Von links nach rechts, eine Reihe:

1. **Harmonie:** Tonart (Display + Wähler), Skala (Display + Wähler), Akkordfarbe (4 LEDs + Taste: 3-Klang, 7er, erweitert, power), Progression (Akkorde mit Stufen, Farben wie oben) mit **+** für „Akkord hinzufügen“ (zweistufig wie heute: Grundton, dann Akkordart; Ort der Auswahl überlässt das Dokument dem Bauenden).
2. **Rhythmus:** Tempo (großer weißer Knopf + Display BPM), Taktart (5 LEDs), Komplexität (Makro-Knopf), Groove (Display mit ‹ ›).
3. **Charakter (meine Entscheidung, im Entwurf nicht gezeichnet):** Stil im Display mit ‹ ›, die gewählten Wörter als kleine Schilder, eine Taste öffnet die **Wortwolke** (dieselbe wie auf der Startseite) als Fenster über der Seite. Grund: Die Schlagworte brauchen auch während des Spielens einen Ort, und der freie Platz rechts im Rack reicht dafür.
4. **Ein Modul je Instrument** (Schlagzeug, Bass, Akkorde, Pad, Lead, Percussion), gleich aufgebaut:
   - Titel mit LED (blinkt, wenn das Instrument spielt).
   - **Stimme:** Display mit Art-Kennung (`SMP` = Sample, `SYN` = Synth) und Name, darunter ‹ stimme ›. Varianten einer Stimme gehören in dieselbe Liste (meine Entscheidung; heute zwei Dropdowns). Ladezustand eines Sample-Packs im Display sichtbar.
   - **Aufgabe** (Lead: Job; Percussion: Part) als Display, wo es sie gibt.
   - **Makros:** ein oder zwei Makro-Knöpfe mit Namen-Schild (türkis / pink) und den beiden Enden beschriftet (z. B. „boomy … punchy“).
   - **Detailregler** darunter (alle heutigen Klangfelder des Instruments), getrennt durch eine gepunktete Linie. Überfahren oder Fokussieren eines Makros hebt die Detailregler hervor, die es bewegt.
   - Regler, die die gewählte Stimme nicht nutzt, sind gedimmt (wie heute `usesTimbreField`), mit Hinweis.
   - Kein Pegel und kein Stumm mehr im Instrument-Modul (die sind im Mixer).
5. **Mixer:** je Instrument ein Kanal mit **Fader** (oben = 100 %, lauter geht nicht, wie heute), daneben eine **LED-Pegelanzeige**, darunter **Pan** und **Stumm** (LED pink = stumm). Rechts ein Gesamtkanal mit Schalter **alle SYN ⇄ alle SMP**, Hall, Echo, Helligkeit und Gesamtfader. Der Stumm-Zustand ist derselbe wie die Spur-LED oben (heute `state.track.layers`).

Was heute in Gruppen „Ansichten“ steckt (Griffbrett und Akkordkreis ausblenden), entfällt; der Fokus-Zustand deckt das ab (meine Entscheidung).

### Was es dafür an neuer Funktion braucht

- **Pan je Instrument** (neu im Audio-Teil, `src/audio/`), gespeichert wie der Mix (`backingtrack.mix`) und als Teil des Profil-Teils „Mixer“.
- **Pegelmessung je Instrument** für die Anzeigen im Mixer (neu, z. B. ein Analyser je Schicht). Die LEDs an Modulen und Spuren dürfen stattdessen aus den Ereignissen kommen.
- **Alle auf Samples / alle auf Synth:** setzt jede Schicht auf ihre Standard-Sample-Stimme bzw. den klassischen Synth (`src/core/voices.js`). Danach bleibt jedes Instrument einzeln umstellbar. Steht die Mischung auf „gemischt“, zeigt der Schalter das (meine Entscheidung).
- **Länge durch Ziehen** am gewählten Teil.
- **Countdown** bis zum nächsten Wechsel.

## Schlagworte, Makros, Wortwolke

### Zwei Arten von Wörtern

Heute stecken in `TAG_CATEGORIES` zwei Arten: Wörter, die ändern, **was** gespielt wird (`EFFECTS` in `src/core/tags.js`: treibend, Swing, synkopiert, Arpeggio, Aufbau …), und Wörter, die ändern, **wie es klingt** (`TIMBRE_EFFECTS` in `src/core/timbre-effects.js`). Künftig:

- **Wortwolke** (Startseite und Charakter-Modul): wenige Wörter in vier Bereichen: **Stimmung** (dunkel, hell, warm, verträumt, psychedelisch …), **Feel** (treibend, locker, halftime, funky, gerade, swing, synkopiert), **Aufbau** (baut langsam auf, voll von Anfang an, mit Breaks) und **Klang** (trocken/weit, sauber/dreckig, fett/luftig, bissig/weich, schimmernd). Die genaue Liste ist ein Vorschlag (Entwurf `start.html`); der Bauende darf sie anpassen, solange jedes Wort eine Wirkung hat.
- **Makros** in den Instrument-Modulen ersetzen die instrumentbezogenen Klang-Kategorien (`drumSound`, `bassSound`, `chordSound`, `padSound`). Ein Makro ist ein zweipoliger Regler: Gegensätze, die heute zwei Wörter sind (boomy/punchy, rund/resonant, mellow/bissig …), sind die zwei Enden **eines** Reglers. Welche Makros es je Instrument gibt und welche Detailregler sie wie stark bewegen, leitet der Bauende aus den heutigen `TIMBRE_EFFECTS` ab (Vorschlag im Entwurf); das Lead bekommt mindestens ein Makro, die Percussion keins.

### Regeln (entschieden)

1. **Kein Wort ohne Wirkung.** Wörter ohne Eintrag (heute `INERT_TAGS`) fallen weg oder bekommen eine Wirkung.
2. **Gegensätze schließen sich sichtbar aus.** Wählt man ein Wort, treten seine Gegensätze zurück (blass, durchgestrichen, nicht wählbar), passende Wörter werden größer. Der Zufall entscheidet nie mehr zwischen zwei gewählten Gegensätzen.
3. **Die Wirkung ist sichtbar.** Überfahren/Fokussieren eines Wortes zeigt in einem Display, was es bewirkt (welche Makros in welche Richtung, welches Spielverhalten).
4. **Der Stil schlägt Wörter vor.** Ein Stil setzt eine Auswahl an Wörtern, sichtbar als umrandete Wörter in der Wolke; man kann sie abwählen und weitere dazunehmen.
5. **Klangwörter wirken über die Makros.** Ein Klangwort stellt die passenden Makros in allen Instrumenten; im Rack sieht man danach die Makro-Stellungen und über die Bögen die Detailregler.
6. **Nichts überschreibt still.** Wörter, Makros und Detailregler wirken zusammen, und an jedem Detailregler ist sichtbar, wo er steht. Mein Vorschlag für das Modell: Detailwert = Ausgangswert + Wirkung der Wörter + Wirkung der Makros + eigene Verschiebung des Nutzers, alles addiert und auf [0, 1] begrenzt. Ein Zurücksetzen je Instrument nimmt die eigenen Verschiebungen und die Makros zurück. Das genaue Modell entscheidet der Bauende, Regel 6 nicht.

### Makros wirken auf jede Stimme (vom Nutzer entschieden)

Heute reagieren die Sample-Stimmen kaum auf Klangregler (`uses` in `src/core/voices.js`: Schlagzeug-Samples nur `room`, Bass-Samples nur `cutoff`, Akkorde und Pad je zwei Felder, Lead und Percussion nur die Verzerrerkette). Der Nutzer will vor allem mit Samples spielen; Makros und Klangwörter dürfen dort nicht ausgegraut und wirkungslos sein. Deshalb bekommt **jede Instrumentspur eine Klangbearbeitung hinter der Stimme** (Vorschlag: Filter/EQ, Hüllkurven- bzw. Transientenformung, Kompression, Breite; die Auswahl trifft der Bauende), auf die die Makros wirken, egal ob Synth oder Sample. Ziel: Jeder Makro und jedes Klangwort hat bei jeder Stimme eine hörbare Wirkung. Detailregler, die nur eine Synth-Stimme hat, dürfen bei Samples weiter gedimmt sein, die Makros nicht.

Anti-Ziel dazu: Die Bearbeitung verändert den Klang der Samples, solange alle Makros und Wörter auf ihrem Ausgangswert stehen (neutral heißt neutral).

### Verträglichkeit

- `track.tags` und die Profil-Teile „Stil und Schlagworte“ und „Klangregler“ (`src/core/profile-parts.js`) müssen alte Daten weiter lesen. Alte Klang-Schlagworte werden beim Laden in Makro-Stellungen umgerechnet, sodass der Klang so nah wie möglich gleich bleibt. Neue Felder (Makros, Pan) kommen dazu; was ein altes Profil nicht hat, bleibt unverändert (wie heute).
- **Spielverhalten bleibt erhalten (meine Entscheidung):** Jedes heutige Schlagwort behält seine heutige Wirkung auf das, was gespielt wird (`EFFECTS`: `drive`, `swing`, `syncopation`, `bassLow`, `bassMovement`, `arp`, `padWidth`, `buildUp`). Wörter, die nicht mehr in der Wolke stehen (z. B. `heavy`, `deepFat`, `deepSynths`, `bouncy`, `calm`, `arpeggio`, `widePad`, `shimmering`), bleiben im Datenformat lesbar und wirken weiter; ihr Spielverhalten wird entweder über ein Wolkenwort, über einen Makro im Instrument-Modul (z. B. Bass „ruhig … hüpfend“, Akkorde/Pad „Arpeggio“) oder über die Stile erreichbar. Damit bleiben `tests/core/golden.test.js` und die Stile unverändert. **Neues** Verhalten (z. B. echtes Halftime im Schlagzeug) kommt nur unter einem neuen Wort, nie durch Umdeuten eines alten. Ausnahme: Wörter, die heute nichts tun (`INERT_TAGS`, z. B. `withBreakouts`), dürfen eine Wirkung bekommen.
- Das Track-Format ist in `docs/interface.md` beschrieben und wird dort nachgezogen.

## Startseite

Entwurf `start.html`. Eine Fläche im Rack-Look, zwei Module nebeneinander:

- **Links:** der Satz „Spiel [Tonart Skala] im Stil [Stil] bei [Tempo] BPM“, die Werte als Displays; Klick öffnet die Auswahl wie heute (Tonart- und Skalen-Chips, Stilkarten, Tempo-Regler). Darunter die **Wortwolke** mit der Frage „Wie soll es sich anfühlen?“, dem Wirkungs-Display und einer kleinen Legende (vom Stil vorgeschlagen / von dir gewählt / passt nicht dazu).
- **Rechts:** **Los** (großer Taster), **Überrasch mich**, Variante mit ‹ ›, **Zuletzt gespielt** mit Zusammenfassung (Tonart, Stil, Tempo, Variante, Takt, wann) und **Weitermachen**, darunter Profile und Sprache.

Verhalten:

- **Los** startet mit diesem Startpunkt und wechselt auf die Spielseite (im Zustand Fokus; meine Entscheidung).
- **Überrasch mich** würfelt Tonart, Skala, Stil, Tempo, Variante und zwei bis drei Wörter, lässt aber stehen, was der Nutzer auf der Startseite selbst gewählt hat (gewählte Wörter; Tonart, Stil, Tempo, sobald einmal angefasst).
- **Weitermachen** stellt die letzte Sitzung vollständig wieder her und setzt die Wiedergabe beim gespeicherten Takt fort. Das ist neu: Heute merkt sich die App zwischen zwei Besuchen nur Mixer und Layout. Die Sitzung wird automatisch im Browser gespeichert (über dieselbe Erfassung wie die Profile, `readSession` in `src/ui/profile-session.js` und `captureParts`). Ohne gespeicherte Sitzung ist der Bereich leer bzw. ausgegraut.
- „Feinjustieren“ von heute entfällt; die Spielseite im Zustand Einstellen übernimmt das.

## Reihenfolge (meine Entscheidung; dem Nutzer vorgeschlagen, nicht widersprochen)

Das Ganze ist zu groß für einen Schritt. Jeder Schritt ist für sich nutzbar und testbar:

1. **Spielseite neu ordnen und im Rack-Look:** Kopfleiste, Fokus/Einstellen, Visualisierung (Tonart, Griffbrett, Akkorde, Form & Spuren), Form-Felder am Streifen, Rack mit Harmonie, Rhythmus, Charakter (vorerst mit der heutigen Wortliste), Instrument-Modulen (Stimme als Display, heutige Detailregler ohne Makros) und Mixer (Fader und Stumm wie heute, noch ohne Pan und Messung), Schalter alle SYN/SMP, Bögen, Akkordfarben. Kein Bedienelement doppelt. Profile-Fenster im neuen Look, gleicher Inhalt.
2. **Mixer vollständig:** Pan, Pegelmessung.
3. **Makros und Wortwolke:** Klangbearbeitung je Spur (damit Makros auch auf Samples wirken), neues Modell der Wörter und Makros, Gegensätze sichtbar, Wirkungs-Display, Verträglichkeit alter Profile; Charakter-Modul mit Wolke. Darf in 3a (Klangbearbeitung) und 3b (Makros und Wolke) geteilt werden.
4. **Startseite:** Satz, Wolke, Überrasch mich, Weitermachen (mit automatischem Speichern der Sitzung).

## Was dem Bauenden überlassen ist

- Aufteilung in Dateien und Komponenten; ob die Drehknöpfe als SVG, Canvas oder CSS gebaut werden.
- **Bedienung der Drehknöpfe**, mit diesen Mindestanforderungen: senkrecht ziehen, Mausrad, Pfeiltasten (Bild auf/ab für große Schritte), Doppelklick setzt auf den Ausgangswert; `role="slider"` mit Beschriftung und `aria-valuetext`.
- Bedienung der Displays mit ‹ › (Tastatur, Screenreader-Ansage), Auswahl-Fenster für lange Listen (Stimmen, Akkordarten).
- Genaue Makro-Zuordnung und Wortliste (innerhalb der Regeln oben).
- Animation beim Umschalten Fokus/Einstellen (zurückhaltend; `prefers-reduced-motion` beachten).
- Anpassung der bestehenden Tests: Viele Playwright-Tests in `tests/e2e/` greifen auf heutige Elemente zu (Leisten, Gruppen, Mixer-Fenster, Dropdowns). Sie werden auf die neue Oberfläche umgestellt, nicht gelöscht; was sie prüfen (Verhalten), bleibt geprüft.
- Die englische Übersetzung aller neuen Texte (`src/i18n/en.js`), wie heute für alles.
