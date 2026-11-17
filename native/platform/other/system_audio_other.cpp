// Placeholder for systems without an implementation yet (Linux, macOS): both functions say so.
#include "btg_platform/system_audio.h"

namespace btg::platform {

Audio captureSystemAudio(double) {
    Audio out;
    out.error = "Recording the system sound is not built for this system yet.";
    return out;
}

Audio decodeWithSystem(const std::string&) {
    Audio out;
    out.error = "No system decoder is built for this system yet.";
    return out;
}

} // namespace btg::platform
