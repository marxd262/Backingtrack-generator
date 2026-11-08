# Weitere Gitarren-Stile (Design-Notiz)

Branch `feat/more-styles`, aufbauend auf `feat/variant-drift`. Nachts ohne Rückfrage entstanden: **Auswahl und Werte sind meine Wahl**, abgestimmt war nur "bekannte, gängige Musikrichtungen, die gerne mit Gitarre gespielt werden".

## Entscheidung

Sechs neue Stil-Vorlagen (`STYLE_PRESETS`), nur aus den vorhandenen Schlagworten gebaut. Keine neuen Muster, Tags oder Klangfelder: der Generator hat dafür schon genug Hebel (Swing, Synkopen, Bass-Bewegung, Treibkraft, Aufbau, 26 Klangfelder). Die drei bisherigen Stile bleiben unverändert (Golden-Hashes unverändert).

| Stil (de / en) | bpm | Charakter über die Schlagworte |
| --- | --- | --- |
| Blues-Shuffle / Blues shuffle | 88 | Swing, lockerer Beat, springender runder Bass, weiche Akkorde, warme Töne, Raum |
| Classic Rock / Classic rock | 124 | gerade Achtel, treibend und kräftig, knackige Snare, bissige Akkorde, hell |
| Hardrock / Hard rock | 148 | schwerer treibender Beat, dunkle Töne, tiefer verzerrter Bass, bissig und klingend |
| Reggae / Reggae | 76 | Halbzeit, lockerer One-Drop, synkopiert, runder Sub-Bass, kurze Skank-Akkorde |
| Country / Country | 112 | trockener, gerader Beat, wechselnder zupfender Bass, klingende helle Akkorde |
| Pop-Punk / Pop-punk | 172 | sehr schnelle gerade Achtel, hämmernd, helle bissige Akkorde, knackig |

Jeder Stil bekommt in allen vier Klang-Kategorien eine Wahl, die zu ihm passt, und beginnt mit `fullFromStart` (Rock-Stile setzen sofort alles ein; Blues, Reggae und Country ebenfalls). Pad-Wahl ist bei Stilen ohne Pad-Charakter nur eine dezente Färbung, der Nutzer kann die Schicht stumm schalten.

## Grenzen (offen benannt)

- Der Generator kennt nur Dur, Moll und vermindert, keine Septakkorde, und nur 4/4. **Blues** ist damit eine Annäherung (Shuffle-Gefühl über Swing, kein echter 12-Takt-Blues mit Dominantsept), **Reggae** hat kein echtes Off-Beat-Skank-Muster, sondern Synkopen und kurze Akkorde. **Hardrock** ist hart über Beat und Klang, ohne Powerchord-Spezialmuster.
- Ob es gut klingt, entscheidet nur die Hörprobe; die Tests prüfen Charakter-Eckwerte der aufgelösten Parameter, nicht den Geschmack.

## Folgen

Das Stil-Fenster zeigt neun statt drei Karten (Raster und Scrollen tragen das). Die Schnellauswahl links bekommt neun Knöpfe. `README.md` nennt weiter "styles" ohne feste Zahl.
