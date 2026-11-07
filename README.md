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

## Tests

```sh
npm test          # Logik-Tests (node:test)
npm run test:e2e  # Browser-Tests (Playwright, Chromium; einmalig: npx playwright install chromium)
```

## Dokumentation

- Schnittstelle für Interactive Scales: [docs/interface.md](docs/interface.md)
- Entwurf: [docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md](docs/superpowers/specs/2026-11-07-backingtrack-generator-design.md)
- Umsetzungsplan: [docs/superpowers/plans/2026-11-07-backingtrack-generator.md](docs/superpowers/plans/2026-11-07-backingtrack-generator.md)
