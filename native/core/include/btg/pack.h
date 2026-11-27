#pragma once

#include <cstddef>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace btg {

// A sample pack as docs/PACK_FORMAT.md describes it: format 1 (JSON + raw 16-bit PCM, every sample in its
// own rate) and format 2 (JSON + one FLAC file). The audio is held as float, interleaved.
struct Pack {
    struct Sample {
        int offset = 0; // frames into `audio`
        int frames = 0;
        double rate = 44100.0;
        int loopStart = 0, loopEnd = 0;
    };
    struct Zone {
        int keyLo = 0, keyHi = 127, velLo = 0, velHi = 127, sample = 0, rootKey = 60;
        double tuneCents = 0.0;
        bool loop = false;
        double attenuationDb = 0.0, attack = 0.0, hold = 0.0, decay = 0.0, release = 0.0, sustainDb = 0.0;
        bool hasVelGain = false;
        double velGain[2] = { 1.0, 1.0 };
        bool releaseTrigger = false;
        std::string art;
        int room = -1;           // index of the room sample that sounds along, -1 = none
        std::vector<int> chokes; // numbers of the hits this one chokes
        int offBy = 0;           // number under which this hit is choked, 0 = never
        double offTime = 0.0;
    };

    int version = 1;
    int channels = 1;
    std::map<std::string, int> keys; // format 2, hit packs: hit name -> key
    std::vector<Sample> samples;
    std::vector<Zone> zones;
    std::vector<float> audio;
};

// Throws std::runtime_error when the pack is not valid.
Pack loadPack(const std::string& json, const unsigned char* audio, size_t size);

// Reads <folder>/<id>.json and the audio file next to it (<id>.pcm, or the name in the JSON). `folder` is UTF-8.
std::shared_ptr<const Pack> loadPackFiles(const std::string& folder, const std::string& id);

} // namespace btg
