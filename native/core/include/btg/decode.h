#pragma once

#include "btg/file_player.h"

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace btg {

// Reads a WAV, FLAC or MP3 file (told by its ending) into memory, all channels. Null: another kind of file, or
// unreadable, or without samples; `error` then says why. The app and btg_analyze both decode with this, so what is
// measured is what the app analyses and plays.
std::shared_ptr<AudioClip> decodeFile(const std::filesystem::path& file, std::string* error = nullptr);

std::vector<float> monoOf(const AudioClip& clip); // the mean of all channels per frame

} // namespace btg
