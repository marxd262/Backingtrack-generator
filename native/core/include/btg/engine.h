#pragma once

#include "btg/transport.h"

#include <functional>
#include <memory>
#include <string>

namespace btg {

struct Pack;

// Plays the generator's events of all six layers with the voices chosen for them (sample voices; synth voices stay silent
// until they are ported), a drive effect on the bass, a mixer and a limiter on the sum. The position comes in from outside
// (Transport::Block), so the same engine runs under the app's own transport, in an offline render and later under a host's play head.
class Engine {
public:
    enum Layer { drums, bass, chords, pad, lead, percussion, layerCount };
    // Delivers the sample pack with this id ("bass-finger"); throws std::exception with the reason when it cannot. The shell
    // fills it (the app: files of the repository), so the core reads no files. Called on the control thread only.
    using PackSource = std::function<std::shared_ptr<const Pack>(const std::string& id)>;

    Engine();
    ~Engine();

    // Control thread, one thread at a time (the app: its loader thread).
    void setPackSource(PackSource source);         // before the first setTrack or setVoices
    // plays from the next block on. The track must be one that the web app's normalizeTrack wrote and validateTrack accepted (a later task
    // validates here). Throws like buildSong when the JSON is not a track at all (then nothing changes); an inconsistent track is not checked. Then setVoices with the track's "voices"
    void setTrack(const std::string& trackJson);
    void setVoices(const std::string& voicesJson); // {"bass":{"id":"sample","variant":"pick"},...}; a layer not named keeps its voice. Reads the packs it does not have yet, here; until then the old voice plays. Never throws
    void setTuning(const std::string& tuningJson); // overrides of the fine values as setTuning of the web app ({"bass/sample/finger":{"level":3}}); replaces the earlier ones. Never throws
    void setSound(const std::string& timbreJson);  // the timbre of the web app's resolveTrackTimbre(track); what is missing or invalid counts as DEFAULT_TIMBRE; replaces the earlier one. Never throws
    std::string voiceStatus() const;              // {"drums":"ready","bass":"error: bass-pick: <reason>","chords":"silent",...}, layers in enum order
    double lengthBeats() const;
    double bpm() const;      // of the track last set
    int beatsPerBar() const; // of its first bar

    // Any thread; they take effect in the next block.
    void setLevel(Layer layer, float fader); // fader position 0..1, gain is the square (as in the web mixer)
    void setMuted(Layer layer, bool muted);
    void setPan(Layer layer, float pan);     // -1 left .. 1 right; NaN: where the fine value mix/pan puts the layer (the default)
    void setMaster(float fader);
    void setBassDrive(float amount);         // 0 = off (signal unchanged) .. 1
    void setLimiter(bool on);                // default on; off (for measuring): no limiter, no delay, no make-up, no clamp, the sum only gets the master gain and the shelf
    float takePeak(int channel);             // a Layer, or layerCount for the output: peak since the last call

    // Audio thread: no locks held, no allocation.
    void prepare(double sampleRate);
    void render(float* left, float* right, int frames, const Transport::Block& block);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace btg
