#pragma once

// The sound model of the web app: the timbre knobs (src/core/timbre.js) and what they map to (src/audio/voice-params.js, fx-params.js,
// mod-fx.js, voices/sample-zones.js). The code follows the JavaScript line by line, in its order of operations and with its names,
// so that native/core/tests/test_logic.cpp can compare it with the web app function by function. Control thread only.

#include "btg/engine.h"

#include <functional>
#include <string>

namespace btg::detail {

// DEFAULT_TIMBRE as the defaults of the structs.
struct DrumsTimbre { double kickPunch = 0.5, kickLength = 0.5, snareTone = 0.5, snareSnap = 0.5, hatBright = 0.5, hatLength = 0.5, room = 0; };
struct BassTimbre { double sub = 0, fuzz = 0, overdrive = 0, distortion = 0, pluck = 0.5, cutoff = 0.5, resonance = 0.5, roundness = 0, vibrato = 0, chorus = 0; };
struct ChordsTimbre { double brightness = 0.5, length = 0.5, vibrato = 0, chorus = 0, tremolo = 0, fuzz = 0, overdrive = 0, distortion = 0; };
struct PadTimbre { double attack = 0.5, cutoff = 0.5, lfoSpeed = 0.5, lfoDepth = 0.5, shimmer = 0, thickness = 0.5, fuzz = 0, overdrive = 0, distortion = 0, vibrato = 0, chorus = 0; };
struct LeadTimbre { double fuzz = 0, overdrive = 0, distortion = 0, vibrato = 0, chorus = 0; };
struct MasterTimbre { double brightness = 0.5, echo = 0.5, reverb = 0.5, width = 0.5, roomSize = 0.5, roomWet = 0.5; };
struct Timbre { DrumsTimbre drums; BassTimbre bass; ChordsTimbre chords; PadTimbre pad; LeadTimbre lead; MasterTimbre master; };

struct MasterParams { double shelfDb, level, shelfFreq, echoWet, echoFeedback, echoTone, reverbWet, roomSize, roomWet, width; };
struct DrumParams { double kickStart, kickEnd, kickDrop, kickDecay, kickPeak, kickClick, snareFreq, snareQ, snareNoise, snareClick, snareTone, snareDecay, hatFreq, hatPeak, hatClosedDecay, hatOpenDecay, roomSend; };
struct BassParams { double sawDetune, q, lpStart, lpEnd, lpTime, sawMix, triMix, sineGain, peak, sustain, attack, release, holdMin, holdCut; };
struct ChordParams { double lpStart, lpEnd, lpTime, holdScale, release, peak, attack, chorusMix, chorusDetune, tremRate, tremDepth, tremBase; };
struct PadParams { double attack, peak, holdMin, holdCut, holdAttack, release, cutoff, q, lfoSpeed, lfoDepth, spread, extraMix, shimmerMix; };
struct FxStage { double mix, drive, makeup; bool operator==(const FxStage&) const = default; };
struct FxChainParams { bool active; FxStage od, dist, fuzz; double cab; bool operator==(const FxChainParams&) const = default; };
// LAYER_FX of fx-params.js: what the distortion chain and fxChainParams read of a layer (frequencies in Hz, gains in dB).
struct LayerFx { double ref; struct { double od, dist, fuzz; } trim; double odSlope, distHp, toneHz, cabHp, cabLp, cabPeakHz, cabPeakDb; };
struct ModParams { bool active; struct { bool on; double hz, depth; } vibrato; struct { double wet, norm; } chorus; };

// Calls f(group, field, value) for the 47 fields of t in DEFAULT_TIMBRE's order (completeTimbre and the logic test use it).
void forEachField(Timbre& t, const std::function<void(const char* group, const char* field, double& value)>& f);

// timbre.js: only an object counts, a group only when it is an object, a field only when it is a finite number (clamped to [0, 1]); the rest is DEFAULT_TIMBRE. Never throws.
Timbre completeTimbre(const std::string& timbreJson);

MasterParams masterParams(const MasterTimbre&);
DrumParams drumParams(const DrumsTimbre&);
BassParams bassParams(const BassTimbre&);
ChordParams chordParams(const ChordsTimbre&);
PadParams padParams(const PadTimbre&);
// bass, chords, pad, lead; throws std::invalid_argument for the other layers, as LAYER_FX[layer] is undefined for them.
const LayerFx& layerFx(Engine::Layer layer);
// bass, chords, pad, lead; a missing or invalid (NaN) knob counts 0. Throws std::invalid_argument for the other layers, as LAYER_FX[layer] does.
FxChainParams fxChainParams(double fuzz, double overdrive, double distortion, Engine::Layer layer);
ModParams modParams(double vibrato, double chorus, double bpm); // NaN bpm counts 100
double brightnessHz(double value01);                            // the low-pass of the brightness knobs; NaN counts 0.5

} // namespace btg::detail
