#include "sound_model.h"

#include "generator_internal.h"

#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <stdexcept>

namespace btg::detail {
namespace {

const double PI = 3.141592653589793; // Math.PI

// voice-params.js: continuous and monotonic, x = 0 -> lo, 0.5 -> mid, 1 -> hi, exponential in between
double span(double x, double lo, double mid, double hi) { return x < 0.5 ? mid * std::pow(lo / mid, 1 - 2 * x) : mid * std::pow(hi / mid, 2 * x - 1); }
// piecewise linear, for values that may reach 0
double lin(double x, double lo, double mid, double hi) { return x < 0.5 ? lo + (mid - lo) * 2 * x : mid + (hi - mid) * (2 * x - 1); }

// fx-params.js
double num(double x) { return std::isfinite(x) ? std::min(1.0, std::max(0.0, x)) : 0.0; }
double db(double x) { return std::pow(10.0, x / 20); }
const double OD_MAKEUP = 0.19, DIST_MAKEUP = 0.055, FUZZ_MAKEUP = 0.113;
double mix(double a) { return std::min(1.0, 8 * a); }

// mod-fx.js
const double VIB_CENTS = 40, CHORUS_LEVEL = 0.7; // MOD.vibCents, MOD.chorusLevel

} // namespace

void forEachField(Timbre& t, const std::function<void(const char* group, const char* field, double& value)>& f) {
    f("drums", "kickPunch", t.drums.kickPunch); f("drums", "kickLength", t.drums.kickLength); f("drums", "snareTone", t.drums.snareTone);
    f("drums", "snareSnap", t.drums.snareSnap); f("drums", "hatBright", t.drums.hatBright); f("drums", "hatLength", t.drums.hatLength); f("drums", "room", t.drums.room);
    f("bass", "sub", t.bass.sub); f("bass", "fuzz", t.bass.fuzz); f("bass", "overdrive", t.bass.overdrive); f("bass", "distortion", t.bass.distortion);
    f("bass", "pluck", t.bass.pluck); f("bass", "cutoff", t.bass.cutoff); f("bass", "resonance", t.bass.resonance); f("bass", "roundness", t.bass.roundness);
    f("bass", "vibrato", t.bass.vibrato); f("bass", "chorus", t.bass.chorus);
    f("chords", "brightness", t.chords.brightness); f("chords", "length", t.chords.length); f("chords", "vibrato", t.chords.vibrato); f("chords", "chorus", t.chords.chorus);
    f("chords", "tremolo", t.chords.tremolo); f("chords", "fuzz", t.chords.fuzz); f("chords", "overdrive", t.chords.overdrive); f("chords", "distortion", t.chords.distortion);
    f("pad", "attack", t.pad.attack); f("pad", "cutoff", t.pad.cutoff); f("pad", "lfoSpeed", t.pad.lfoSpeed); f("pad", "lfoDepth", t.pad.lfoDepth);
    f("pad", "shimmer", t.pad.shimmer); f("pad", "thickness", t.pad.thickness); f("pad", "fuzz", t.pad.fuzz); f("pad", "overdrive", t.pad.overdrive);
    f("pad", "distortion", t.pad.distortion); f("pad", "vibrato", t.pad.vibrato); f("pad", "chorus", t.pad.chorus);
    f("lead", "fuzz", t.lead.fuzz); f("lead", "overdrive", t.lead.overdrive); f("lead", "distortion", t.lead.distortion); f("lead", "vibrato", t.lead.vibrato);
    f("lead", "chorus", t.lead.chorus);
    f("master", "brightness", t.master.brightness); f("master", "echo", t.master.echo); f("master", "reverb", t.master.reverb); f("master", "width", t.master.width);
    f("master", "roomSize", t.master.roomSize); f("master", "roomWet", t.master.roomWet);
}

Timbre completeTimbre(const std::string& timbreJson) {
    Timbre result;
    const nlohmann::json given = nlohmann::json::parse(timbreJson, nullptr, false);
    if (!given.is_object()) return result;
    forEachField(result, [&](const char* group, const char* field, double& value) {
        const auto g = given.find(group);
        if (g == given.end() || !g->is_object()) return;
        const auto v = g->find(field);
        if (v != g->end() && v->is_number() && std::isfinite(v->get<double>())) value = clamp(v->get<double>(), 0, 1);
    });
    return result;
}

BassParams bassParams(const BassTimbre& t) {
    const double tone = span(t.cutoff, 0.35, 1, 3) * (1 - 0.5 * t.sub);
    const double harmonics = 1 - 0.6 * t.sub;
    BassParams p;
    p.sawDetune = 6;
    p.q = span(t.resonance, 1, 4, 14);
    p.lpStart = 2200 * tone * span(t.pluck, 0.5, 1, 2);
    p.lpEnd = 320 * tone;
    p.lpTime = span(t.pluck, 0.5, 0.15, 0.03) * span(t.resonance, 0.7, 1, 2.5);
    p.sawMix = harmonics * (1 - t.roundness);
    p.triMix = harmonics * t.roundness;
    p.sineGain = (1 + 2 * t.sub) * span(t.resonance, 1.3, 1, 0.4);
    p.peak = 0.5;
    p.sustain = t.pluck > 0.5 ? std::pow(0.2, 2 * t.pluck - 1) : 1;
    p.attack = 0.004;
    p.release = 0.05;
    p.holdMin = 0.03;
    p.holdCut = 0.06;
    return p;
}

DrumParams drumParams(const DrumsTimbre& t) {
    const double hatTime = span(t.hatLength, 0.3, 1, 2.5);
    DrumParams p;
    p.kickStart = span(t.kickPunch, 110, 150, 260);
    p.kickEnd = 46 * span(t.kickLength, 1.15, 1, 0.8);
    p.kickDrop = span(t.kickLength, 0.07, 0.12, 0.2);
    p.kickDecay = span(t.kickLength, 0.15, 0.4, 0.9);
    p.kickPeak = 0.9 * span(t.kickLength, 1.1, 1, 0.75);
    p.kickClick = 0.5 * std::max(0.0, 2 * t.kickPunch - 1);
    p.snareFreq = span(t.snareTone, 1200, 1900, 3200) * span(t.snareSnap, 0.85, 1, 1.5);
    p.snareQ = span(t.snareSnap, 0.6, 0.8, 2);
    p.snareNoise = 0.55 * span(t.snareSnap, 0.6, 1, 2.5) * span(t.snareTone, 0.6, 1, 3);
    p.snareClick = 1.6 * std::max(0.0, 2 * t.snareSnap - 1);
    p.snareTone = 0.3 * span(t.snareSnap, 2, 1, 0.4);
    p.snareDecay = span(t.snareSnap, 0.3, 0.16, 0.07);
    p.hatFreq = span(t.hatBright, 4500, 7500, 11000);
    p.hatPeak = 0.3 * span(t.hatBright, 0.6, 1, 5) * std::pow(hatTime, -0.25);
    p.hatClosedDecay = 0.04 * hatTime;
    p.hatOpenDecay = 0.2 * hatTime;
    p.roomSend = 7 * t.room;
    return p;
}

ChordParams chordParams(const ChordsTimbre& t) {
    const double bright = span(t.brightness, 0.2, 1, 2.5);
    const double brightEnd = span(t.brightness, 0.5, 1, 2.5);
    const double lng = span(t.length, 0.3, 1, 3); // `long` in the JavaScript
    const double chorusMix = 1.6 * t.chorus;
    const double tremDepth = 0.95 * (1 - std::pow(1 - t.tremolo, 2));
    const double tremBase = 1 - tremDepth / 2;
    ChordParams p;
    p.lpStart = 3600 * bright;
    p.lpEnd = 900 * brightEnd;
    p.lpTime = 0.25 * span(t.length, 0.5, 1, 2);
    p.holdScale = span(t.length, 0.5, 1, 3);
    p.release = 0.2 * lng;
    p.peak = 0.16 / (std::sqrt(1 + std::pow(chorusMix, 2)) * std::sqrt(std::pow(tremBase, 2) + std::pow(tremDepth, 2) / 8));
    p.attack = 0.003;
    p.chorusMix = chorusMix;
    p.chorusDetune = 12;
    p.tremRate = 6;
    p.tremDepth = tremDepth;
    p.tremBase = tremBase;
    return p;
}

PadParams padParams(const PadTimbre& t) {
    const double extraMix = std::max(0.0, 2 * t.thickness - 1);
    const double shimmerMix = 2 * t.shimmer;
    const double lp = span(t.cutoff, 350, 1100, 3500) * span(t.thickness, 1.2, 1, 0.75);
    PadParams p;
    p.attack = span(t.attack, 0.05, 0.45, 1.6);
    p.peak = 0.1 / (1 + 0.3 * extraMix) / (1 + 0.3 * shimmerMix);
    p.holdMin = 0.1;
    p.holdCut = 0.5;
    p.holdAttack = 0.45;
    p.release = 0.9;
    p.cutoff = lp;
    p.q = 0.8;
    p.lfoSpeed = span(t.lfoSpeed, 0.05, 0.18, 1.2);
    p.lfoDepth = std::min(span(t.lfoDepth, 100, 450, 1500), 0.8 * lp);
    p.spread = span(t.thickness, 3, 9, 25);
    p.extraMix = extraMix;
    p.shimmerMix = shimmerMix;
    return p;
}

MasterParams masterParams(const MasterTimbre& t) {
    const double shelfDb = lin(t.brightness, -15, 0, 9);
    MasterParams p;
    p.shelfDb = shelfDb;
    p.level = 1 / (1 + 0.05 * std::max(0.0, shelfDb));
    p.shelfFreq = 800;
    p.echoWet = lin(t.echo, 0, 0.3, 1);
    p.echoFeedback = lin(t.echo, 0.1, 0.38, 0.7);
    p.echoTone = 2400;
    p.reverbWet = lin(t.reverb, 0, 0.15, 0.6);
    p.roomSize = lin(t.roomSize, 0.15, 0.4, 1);
    p.roomWet = lin(t.roomWet, 0, 1, 2);
    p.width = 2 * t.width;
    return p;
}

const LayerFx& layerFx(Engine::Layer layer) {
    static const LayerFx BASS { 0.17, { 1.43, 1.4, 1.12 }, 0, 60, 800, 40, 3200, 90, 3 }, CHORDS { 0.35, { 1, 1, 1 }, 0.45, 150, 1500, 90, 5000, 2500, 4 },
        PAD { 0.68, { 0.7, 0.78, 0.86 }, 0.45, 150, 1500, 90, 5000, 2500, 4 }, LEAD { 0.29, { 0.5, 0.6, 0.9 }, 0.45, 150, 1500, 90, 5000, 2500, 4 };
    if (layer == Engine::bass) return BASS;
    if (layer == Engine::chords) return CHORDS;
    if (layer == Engine::pad) return PAD;
    if (layer == Engine::lead) return LEAD;
    throw std::invalid_argument("layerFx: no effect chain on this layer");
}

FxChainParams fxChainParams(double fuzz, double overdrive, double distortion, Engine::Layer layer) {
    const LayerFx& fx = layerFx(layer);
    const double f = num(fuzz), o = num(overdrive), d = num(distortion);
    FxChainParams p;
    p.active = f > 0 || o > 0 || d > 0;
    p.od = { mix(o), db(30 * o), OD_MAKEUP * fx.trim.od * std::pow(db(30 * o) / 3, -fx.odSlope) };
    p.dist = { mix(d), db(50 * d), DIST_MAKEUP * fx.trim.dist };
    p.fuzz = { mix(f), db(6 + 40 * f), FUZZ_MAKEUP * fx.trim.fuzz };
    p.cab = mix(std::max(std::max(f, o), d));
    return p;
}

ModParams modParams(double vibrato, double chorus, double bpm) {
    const double v = num(vibrato), wet = CHORUS_LEVEL * num(chorus);
    const double hz = std::min(5.5, std::max(4.0, 4 + ((std::isfinite(bpm) ? bpm : 100) - 60) / 40));
    ModParams p;
    p.active = v > 0 || wet > 0;
    p.vibrato = { v > 0, hz, (std::pow(2.0, (VIB_CENTS * v) / 1200) - 1) / (2 * PI * hz) };
    p.chorus = { wet, 1 / std::sqrt(1 + 2 * wet * wet) };
    return p;
}

double brightnessHz(double value01) {
    const double v = std::isfinite(value01) ? clamp(value01, 0, 1) : 0.5;
    return v >= 0.5 ? 20000.0 : 20000 * std::pow(400.0 / 20000, (0.5 - v) * 2);
}

} // namespace btg::detail
