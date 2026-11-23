#pragma once

#include <juce_core/juce_core.h>

#include <btg/session.h>

#include <functional>
#include <optional>
#include <string>

// The session's lasting storage (native/PROTOKOLL.md, section 7): one file per name in one folder. A write goes to a side file that replaces the
// target in one step, the previous version kept as <name>.bak. Not thread-safe: the processor's session lock covers every call.
class FileStorage final : public btg::Storage {
public:
    static constexpr juce::int64 limit = 20000000; // bytes: a larger file is not read
    // %APPDATA%\BackingtrackGenerator (JUCE's userApplicationDataDirectory), or the folder BTG_STORAGE_DIR names (checks: never the user's profiles)
    static juce::File defaultFolder();
    // afterStep: for the abort test only, called after the steps 1 (side file on the disk), 2 (previous version copied) and 3 (target replaced) of a write
    explicit FileStorage (juce::File folder, std::function<void (int step)> afterStep = {});

    // nothing only when the file is known not to exist (nothingStored); throws for every other answer of the system, a folder of the name, a file
    // above `limit`, and a file that stays unreadable over three tries (a scanner may hold it for a moment)
    std::optional<std::string> read (const std::string& name) override;
    bool write (const std::string& name, const std::string& text) override; // false: nothing changed, the target and its .bak are as they were

    // The one decision of "nothing stored": the system's error for a look at the file (Windows: GetLastError of GetFileAttributesExW; elsewhere errno
    // of stat) means the file does not exist. Windows: ERROR_FILE_NOT_FOUND; ERROR_PATH_NOT_FOUND only when the storage's own folder is missing
    // and its parent answers (`folderMissing`: the first start). Every other error (a network path that does not answer, an invalid name, a path
    // component that is a file, no permission) is a file that cannot be read.
    static bool nothingStored (unsigned long error, bool folderMissing);

private:
    juce::File folder;
    std::function<void (int)> afterStep;
};
