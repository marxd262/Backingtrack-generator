#pragma once

#include <string>
#include <vector>

// What only the operating system can do. One interface, one implementation per system:
// win/ (WASAPI loopback, Media Foundation), other/ (placeholder that reports "not available").
// Linux later: PipeWire or PulseAudio monitor source for the capture, FFmpeg or GStreamer for the decoder.
namespace btg::platform {

struct Audio {
    std::vector<float> samples; // interleaved
    int channels = 0;
    double rate = 0.0;
    std::string error;          // empty = worked
};

// Records what the system is playing on its default output for `seconds` ("listen instead of a file").
Audio captureSystemAudio(double seconds);

// Decodes a file with the system's own decoders, for formats the app has no decoder for (M4A/AAC).
Audio decodeWithSystem(const std::string& pathUtf8);

} // namespace btg::platform
