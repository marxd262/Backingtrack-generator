#pragma once

#include <juce_core/juce_core.h>

#include <btg/session.h>

#include <functional>
#include <optional>
#include <string>

// The session's lasting storage (native/PROTOKOLL.md, section 7): one file per name in one folder. A write goes to a side file that replaces the
// target in one step, the previous version kept as <name>.bak. Not thread-safe: the processor's session lock covers every call. One storage per
// folder writes, across processes (two apps on one folder): the first to be built holds the folder's lock for its life, and every write of a
// storage that did not get it returns false; it reads all the same. The constructor waits up to lockWaitMs for the lock (on the thread that builds
// it: the app's message thread), so that an app started right after the one before it ended gets it.
class FileStorage final : public btg::Storage {
public:
    static constexpr juce::int64 limit = 20000000; // bytes: a larger file is not read
    // An app that ended keeps the lock until its process is gone: measured 45 to 63 ms after a kill on a quiet machine (30 times, killed as the
    // page tests' restart kills it); under the load of four test workers it outlasted the next app's start
    // (a few hundred ms) in 5 of about 450 restarts. An app closed normally lets it go when its processor is deleted, after a running job of its
    // loader (a pack's load, up to about a second). 3 s holds all of these with a margin; a true second app starts that much later.
    static constexpr int lockWaitMs = 3000;
    // %APPDATA%\BackingtrackGenerator (JUCE's userApplicationDataDirectory), or the folder BTG_STORAGE_DIR names (checks: never the user's profiles)
    static juce::File defaultFolder();
    // afterStep: for the abort test only, called after the steps 1 (side file on the disk), 2 (previous version copied) and 3 (target replaced) of a write
    explicit FileStorage (juce::File folder, std::function<void (int step)> afterStep = {});

    // nothing only when the file is known not to exist (nothingStored); throws for every other answer of the system, a folder of the name, a file
    // above `limit`, and a file that stays unreadable over three tries (a scanner may hold it for a moment)
    std::optional<std::string> read (const std::string& name) override;
    bool write (const std::string& name, const std::string& text) override; // false: nothing changed, the target and its .bak are as they were (always, for a storage without the folder's lock)

    // The one decision of "nothing stored": the system's error for a look at the file (Windows: GetLastError of GetFileAttributesExW; elsewhere errno
    // of stat) means the file does not exist. Windows: ERROR_FILE_NOT_FOUND; ERROR_PATH_NOT_FOUND only when the storage's own folder is missing
    // and its parent answers (`folderMissing`: the first start). Every other error (a network path that does not answer, an invalid name, a path
    // component that is a file, no permission) is a file that cannot be read.
    static bool nothingStored (unsigned long error, bool folderMissing);

private:
    juce::File folder;
    std::function<void (int)> afterStep;
    juce::InterProcessLock lock; // named after the folder; the system frees it when the process ends, also when it is killed
    const bool owner;            // this storage got the lock
};
