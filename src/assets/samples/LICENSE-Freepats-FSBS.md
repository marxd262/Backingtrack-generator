# Freepats FSBS Electric Guitar (clean, jazz)

The packs `chords-freepats` and `chords-freepatsjazz` are cut from the FreePats sound banks
"FSBS Electric Guitar Clean" and "FSBS Electric Guitar Jazz", version **2026-08-07**, small SF2 variant,
bridge pickup (a Fender electric guitar sampled through an audio interface, processed through an amplifier
and effects rack).

**License: CC0 1.0 Universal (public domain dedication),** https://creativecommons.org/publicdomain/zero/1.0/
Attribution is not required; it is given here anyway.

Source page: https://freepats.zenvoid.org/ElectricGuitar/clean-electric-guitar.html

Release files:

- https://github.com/freepats/electric-guitar-FSBS-clean/releases/download/2026-08-07/EGuitarFSBS-clean-bridge-small-SF2-20260807.7z
  (contains `EGuitarFSBS-clean bridge small 20260807.sf2`, preset "EGuitar Cl. Br. Sm.")
- https://github.com/freepats/electric-guitar-FSBS-jazz/releases/download/2026-08-07/EGuitarFSBS-jazz-bridge-small-SF2-20260807.7z
  (contains `EGuitarFSBS-jazz bridge small 20260807.sf2`, preset "EGuitar Jz. Br. Sm.")

Processing (`scripts/extract-samples.mjs --fsbs-clean ... --fsbs-jazz ...`): the 16-bit mono PCM of all 13
samples of each preset is copied unchanged, at the original sample rate (44.1 kHz); loop points are made
relative to each sample's start; zone data (key ranges, root keys, envelope) is taken from the preset. Nothing
else was changed (no resampling, trimming or normalization).
