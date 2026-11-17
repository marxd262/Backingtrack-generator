#pragma once

#include "btg/transport.h"

#include <memory>
#include <vector>

namespace btg {

// A loaded track in memory.
// shortcut: the whole file as float (200 MB for ten minutes of stereo); stream from disk when long files matter.
struct AudioClip {
    std::vector<float> samples; // interleaved
    int channels = 2;
    double rate = 44100.0;
    double seconds() const { return static_cast<double>(samples.size() / static_cast<size_t>(channels)) / rate; }
};

// Plays a clip along the transport. In this mode one beat of the transport is one second of the track,
// so jump and loop work as for the generator. The transport's tempo is the speed: 60 bpm plays the track as
// recorded, 45 bpm at 75 %. Any other speed than 100 % is time-stretched: slower or faster at the same pitch.
class FilePlayer {
public:
    FilePlayer();
    ~FilePlayer();

    void setClip(std::shared_ptr<const AudioClip> clip); // control thread
    void setGain(float gain);
    float takePeak();                                     // peak since the last call

    void prepare(double sampleRate);                      // before the audio runs; allocates
    // Audio thread: overwrites the buffers, never waits.
    void render(float* left, float* right, int frames, const Transport::Block& block);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace btg
