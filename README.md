# Backingtrack-Generator

Erzeugt im Browser Begleit-Tracks zum Üben (Schlagzeug, Bass, Akkorde, Pad) aus Tonart, Stil, Tempo und Schlagworten.
Reines JavaScript (ES-Module), kein Build-Schritt. Die Variantennummer auf der Startseite ist eingebbar (1 bis 9999):
dieselbe Nummer ergibt in derselben Tonart wieder dieselbe Akkordfolge.

## Starten

```sh
npm install
npm start
```

Dann im Browser öffnen: <http://localhost:4173/ui/index.html> (der Server lauscht nur auf localhost).

Entwicklerseite zum Anhören der drei Stile: <http://localhost:4173/ui/render-harness.html>

## Die Oberfläche

- **Startseite:** der Startsatz (Tonart und Leiter, Stil, Tempo), Variantennummer, **Los** und **Feintuning**. Läuft die Wiedergabe, zeigt Los „Stopp“ und „Zur Spielseite“ führt zurück.
- **Spielseite:** in der Mitte untereinander **Griffbrett**, **Verlauf** (mit den Stummschaltern je Schicht) und **Akkordrad**. Links die Seitenleiste **Klang** (Stil, Schlagworte, Tempo, Länge), rechts **Akkorde** (Tonart, Leiter, Akkordfolge bearbeiten, Ansichten).
- **Klang-Schlagworte:** vier eigene Gruppen (Schlagzeugklang, Bassklang, Akkordklang, Padklang) sowie Stimmungen wie dunkel, hell, warm formen den Klang (die Noten bleiben gleich, nur „träumerisch“ verschiebt wie bisher auch die Padlage); die drei Stile nutzen sie, und eine Auswahl startet die laufende Wiedergabe neu.
- Beide Seitenleisten lassen sich ein- und ausklappen; der Zustand wird im Browser gemerkt (`localStorage`). Auf schmalen Fenstern liegt eine offene Leiste als Schublade über der Mitte (Escape schließt sie).
- **Griffbrett:** zeigt alle Töne der Leiter, hebt den jetzigen Akkord hervor und markiert den folgenden; der Schalter **Namen/Stufen** wechselt die Beschriftung (Stufen zählen vom Grundton der Tonart).
- Unter **Ansichten** (rechte Leiste) lassen sich Griffbrett und Akkordrad ausblenden; der Verlauf bleibt immer sichtbar.

## Tests

```sh
npm test          # Logik-Tests (node:test)
npm run test:e2e  # Browser-Tests (Playwright, Chromium; einmalig: npx playwright install chromium)
npx playwright test tests/e2e/play.spec.js --no-deps  # eine Datei allein
```

Die Echtzeit-Tests (Projekt `realtime`) laufen erst nach den rechenintensiven Offline-Renders (`offline`: `levels.spec.js`, `sound.spec.js`), damit ihre Timer nicht unter Last verrutschen. Ohne `--no-deps` läuft vor einer einzelnen Echtzeit-Datei das Projekt `offline` mit.

## Dokumentation

- Schnittstelle für Interactive Scales: [docs/interface.md](docs/interface.md)
- Entwurf: [docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md](docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md)
- Umsetzungsplan: [docs/superpowers/plans/2026-11-07-backingtrack-generator.md](docs/superpowers/plans/2026-11-07-backingtrack-generator.md)
