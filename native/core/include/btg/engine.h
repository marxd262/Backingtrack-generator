#pragma once

#include "btg/transport.h"

#include <memory>
#include <string>

namespace btg {

struct Pack;

// Plays the generator's events with sample packs: drums and bass, a drive effect on the bass, a mixer and a
// limiter on the sum. The position comes in from outside (Transport::Block), so the same engine runs under
// the app's own transport, in an offline render and later under a host's play head.
class Engine {
public:
    enum Layer { drums, bass, layerCount };

    Engine();
    ~Engine();

    // Control thread.
    void setPack(Layer layer, std::shared_ptr<const Pack> pack); // before the audio runs and before setTrack
    void setTrack(const std::string& trackJson);                 // any time; plays from the next block on. Throws like buildSong
    double lengthBeats() const;
    double bpm() const;      // of the track last set
    int beatsPerBar() const; // of its first bar

    // Any thread; they take effect in the next block.
    void setLevel(Layer layer, float fader); // fader position 0..1, gain is the square (as in the web mixer)
    void setMuted(Layer layer, bool muted);
    void setPan(Layer layer, float pan);     // -1 left .. 1 right
    void setMaster(float fader);
    void setBassDrive(float amount);         // 0 = off (signal unchanged) .. 1
    void setLimiter(bool on);                // default on; off (for measuring): no limiter, no delay, no make-up, no clamp, the sum only gets the master gain
    float takePeak(int channel);             // a Layer, or layerCount for the output: peak since the last call

    // Audio thread: no locks held, no allocation.
    void prepare(double sampleRate);
    void render(float* left, float* right, int frames, const Transport::Block& block);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace btg
