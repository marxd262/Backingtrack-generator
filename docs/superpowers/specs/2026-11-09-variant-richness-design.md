# Reichere Varianten (Design-Notiz)

Branch `feat/variant-drift`, aufbauend auf `feat/live-sound-controls`. Nachts ohne Rückfrage entstanden: **alles unten, was nicht im Chat abgestimmt wurde, ist meine Wahl** und lässt sich ändern oder verwerfen.

## Anlass

Der Nutzer wollte, dass die Variante mehr bewirkt: "die variante ändert zwar etwas, aber die auswirkung ist nicht immer groß genug. Mehr sachen sollten durch die variante abhängig sein." Die Frage, was sich beim Wechseln zuerst deutlich ändern soll, blieb unbeantwortet. Daher meine Annahme: **Muster, Spielweise und Klangfarbe** sollen sich spürbar ändern, **Stil, Tempo, Tonart und Schlagworte** bleiben ("gleicher Stil, andere Version").

## Ist-Zustand

Der Seed (Variante 1 bis 9999) wählt die Akkordfolge, je Abschnitt ein Muster aus kleinen Listen (Kicks, Fills, Bass, Stabs, Arpeggios) und das Mikro-Timing. Die Werte aus den Schlagworten (Swing, Synkopen, Bass-Bewegung) und der Klang sind für alle Varianten gleich.

## Entscheidungen

1. **Schalter `variety` im Track** (Boolean, Standard aus). Aus: Ereignisstrom und Klang sind bitgleich wie vorher (Golden-Hashes, Pegel- und Klangmessungen der Bibliothek bleiben gültig, Interactive Scales merkt nichts). Die eigene Oberfläche setzt `variety: true`. *Alternative, die ich verworfen habe:* immer an, das hätte alle Golden-Werte und Messgrenzen verschoben.
2. **Streuung der Schlagwort-Werte (`driftParams` in `core/tags.js`):** Mit `variety` verschiebt der Seed `syncopation` und `bassMovement` um höchstens ±0,12 und skaliert `swing` mit einem Faktor 0,75 bis 1,25 (so bleibt `straight` bei 0 und ein Swing-Stil swingt etwas mehr oder weniger). `drive`, `bassLow`, `padWidth` bleiben, weil sie den Stil tragen. Eigener Zufall über `master.fork('drift')`, die Ströme der Schichten verschieben sich dadurch nicht.
3. **Größere Muster-Listen:** Mit `variety` kommen je Liste zusätzliche, von Hand geschriebene Muster dazu (Kicks je Stufe, Fills, Bass je Bewegungsstufe, Stabs, Arpeggios). Die alten bleiben die ersten Einträge.
4. **Klang-Drift (`resolveTrackTimbre`):** Mit `variety` und endlichem `seed` verschiebt der Seed sieben Klangfelder um höchstens ±0,08: `drums.snareTone`, `drums.hatBright`, `bass.cutoff`, `chords.brightness`, `pad.cutoff`, `pad.lfoSpeed`, `master.echo`. Reihenfolge der Quellen: Schlagworte, Drift, **Regler des Nutzers gewinnen immer**. Die Regler zeigen den hörbaren Wert, bewegen sich also beim Variantenwechsel mit, wenn sie nicht überschrieben sind.
5. **Nicht angefasst:** Akkordfolge (hängt schon vom Seed ab), Tempo, Tonart, Länge, Mischpult.

## Folgen

- Variante 1 klingt mit der Oberfläche anders als vorher (gewollt). Gleiche Variantennummer, gleicher Track, gleicher Strom bleibt erhalten.
- Neue Listeneinträge ändern, welches Muster ein Seed wählt, nur mit `variety: true`.
- Dokumentiert in `docs/interface.md` als optionales Feld.

## Grenzen

Ob die zusätzlichen Muster gut klingen, entscheidet nur die Hörprobe. Die Tests prüfen Gültigkeit (Zeiten, Bereiche, Tonhöhen), Determinismus, Grenzen der Streuung und dass `variety` aus nichts ändert.
