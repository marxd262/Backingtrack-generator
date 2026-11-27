#include "Storage.h"

#include <cstdio>
#include <functional>
#include <stdexcept>

#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
#else
 #include <cerrno>
 #include <sys/stat.h>
#endif

namespace {

// a name of the session (profiles.json, ...): no path, nothing JUCE calls illegal in a file name, none of this storage's own side files, and
// nothing Win32 rewrites: a trailing dot or space is dropped, a device name (CON, NUL, COM1, ... with or without an extension) names a device
bool plainName (const std::string& name) {
    const auto text = juce::String::fromUTF8 (name.data(), static_cast<int> (name.size()));
    if (text.isEmpty() || text.toStdString() != name || text == "." || text == ".." || juce::File::createLegalFileName (text) != text) return false;
    if (text.endsWithIgnoreCase (".tmp") || text.endsWithIgnoreCase (".bak") || text.endsWithChar ('.') || text.endsWithChar (' ')) return false; // NTFS ignores case
    const auto stem = text.upToFirstOccurrenceOf (".", false, false).trimEnd().toUpperCase();
    const juce::String digits (juce::CharPointer_UTF8 ("0123456789\xc2\xb9\xc2\xb2\xc2\xb3"));
    const bool device = juce::StringArray { "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$" }.contains (stem)
                     || ((stem.startsWith ("COM") || stem.startsWith ("LPT")) && stem.length() == 4 && digits.containsChar (stem[3]));
    return ! device;
}

// a scanner, an indexer or a backup holds a file for a moment: three tries over about 300 ms before giving up
bool tries (const std::function<bool()>& attempt) {
    for (int i = 0;; ++i) {
        if (attempt()) return true;
        if (i == 2) return false;
        juce::Thread::sleep (150);
    }
}

// The file's size; nothing when it is known not to exist (FileStorage::nothingStored); throws for every other failure of the look, and for a folder
// of the name. The system is asked directly: std::filesystem::status reports "not found" also for a network path that does not answer.
std::optional<juce::int64> sizeOf (const juce::File& file, const juce::File& folder, const std::string& name) {
#if JUCE_WINDOWS
    WIN32_FILE_ATTRIBUTE_DATA data {};
    if (! GetFileAttributesExW (file.getFullPathName().toWideCharPointer(), GetFileExInfoStandard, &data)) {
        const DWORD error = GetLastError();
        WIN32_FILE_ATTRIBUTE_DATA own {};
        const bool folderMissing = ! GetFileAttributesExW (folder.getFullPathName().toWideCharPointer(), GetFileExInfoStandard, &own) && GetLastError() == ERROR_FILE_NOT_FOUND;
        if (FileStorage::nothingStored (error, folderMissing)) return std::nullopt;
        throw std::runtime_error (name + ": the system cannot say whether it is there (error " + std::to_string (error) + ")");
    }
    if ((data.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0) throw std::runtime_error (name + " is not a file");
    return (static_cast<juce::int64> (data.nFileSizeHigh) << 32) | static_cast<juce::int64> (data.nFileSizeLow);
#else
    // macOS, Linux: stat(2) and its errno
    struct stat data {};
    if (stat (file.getFullPathName().toRawUTF8(), &data) != 0) {
        const int error = errno;
        struct stat own {};
        const bool folderMissing = stat (folder.getFullPathName().toRawUTF8(), &own) != 0 && errno == ENOENT;
        // ENOENT names a missing folder at any depth as it names a missing file (Windows tells them apart: ERROR_PATH_NOT_FOUND): a storage's
        // folder that is missing together with its parent is not a first start
        const bool parentThere = ! folderMissing || stat (folder.getParentDirectory().getFullPathName().toRawUTF8(), &own) == 0;
        if (parentThere && FileStorage::nothingStored (static_cast<unsigned long> (error), folderMissing)) return std::nullopt;
        throw std::runtime_error (name + ": the system cannot say whether it is there (errno " + std::to_string (error) + ")");
    }
    if (! S_ISREG (data.st_mode)) throw std::runtime_error (name + " is not a file");
    return static_cast<juce::int64> (data.st_size);
#endif
}

// Replaces `to` with `from` in one step: a rename within the folder, so that the name always points to the old file or to the new one. Not JUCE's:
// File::replaceFileIn is ReplaceFile on Windows, which documents outcomes in which the replaced file is gone (ERROR_UNABLE_TO_MOVE_REPLACEMENT), and
// File::moveFileTo deletes the target first. macOS and Linux: rename(2) replaces in one step.
// shortcut: no fsync of the folder after rename(2), so a power cut can lose the new name there, and JUCE's flush is fsync, which on macOS does not
// reach the disk (F_FULLFSYNC does); upgrade: when the app is built for macOS or Linux.
bool replace (const juce::File& from, const juce::File& to) {
#if JUCE_WINDOWS
    return MoveFileExW (from.getFullPathName().toWideCharPointer(), to.getFullPathName().toWideCharPointer(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) != 0;
#else
    return std::rename (from.getFullPathName().toRawUTF8(), to.getFullPathName().toRawUTF8()) == 0;
#endif
}

} // namespace

bool FileStorage::nothingStored (unsigned long error, bool folderMissing) {
#if JUCE_WINDOWS
    return error == ERROR_FILE_NOT_FOUND || (error == ERROR_PATH_NOT_FOUND && folderMissing);
#else
    // ENOENT is a missing file or a missing folder; sizeOf rules out the storage's folder missing together with its parent before it asks
    (void) folderMissing;
    return error == ENOENT;
#endif
}

juce::File FileStorage::defaultFolder() {
    const auto given = juce::SystemStats::getEnvironmentVariable ("BTG_STORAGE_DIR", {});
    if (given.isNotEmpty()) return juce::File::getCurrentWorkingDirectory().getChildFile (given);
    return juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("BackingtrackGenerator");
}

juce::File FileStorage::settingsFile (const juce::File& folder, bool named, const juce::File& old) {
    const auto file = folder.getChildFile ("Backingtrack Generator.settings");
    if (! named && ! file.exists() && old.existsAsFile() && folder.createDirectory().wasOk()) old.copyFileTo (file); // a failed copy: JUCE's defaults
    return file;
}

// The lock's name: the folder's path (NTFS ignores case) as a hash, since a name of the system's locks has no backslash and a limited length.
// Waited for up to lockWaitMs (Storage.h): an app that ended just before holds it until its process is gone.
FileStorage::FileStorage (juce::File f, std::function<void (int)> step)
    : folder (std::move (f)), afterStep (std::move (step)),
      lock ("BackingtrackGenerator-storage-" + juce::String::toHexString (folder.getFullPathName().toLowerCase().hashCode64())), owner (lock.enter (lockWaitMs)) {}

std::optional<std::string> FileStorage::read (const std::string& name) {
    if (! plainName (name)) throw std::invalid_argument ("not a plain file name: " + name);
    const auto file = folder.getChildFile (juce::String::fromUTF8 (name.c_str()));
    const auto size = sizeOf (file, folder, name);
    if (! size) return std::nullopt;
    if (*size > limit) throw std::runtime_error (name + " is larger than 20000000 bytes: not read");
    std::string text, reason;
    const bool read = tries ([&] {
        juce::FileInputStream in (file);
        if (in.failedToOpen()) { reason = in.getStatus().getErrorMessage().toStdString(); return false; }
        juce::MemoryBlock bytes;
        const auto got = in.readIntoMemoryBlock (bytes, limit + 1);
        if (in.getStatus().failed()) { reason = in.getStatus().getErrorMessage().toStdString(); return false; }
        if (static_cast<juce::int64> (got) > limit) throw std::runtime_error (name + " is larger than 20000000 bytes: not read"); // it grew since its size was read
        text.assign (static_cast<const char*> (bytes.getData()), bytes.getSize());
        return true;
    });
    if (! read) throw std::runtime_error (name + ": " + reason);
    return text;
}

// PROTOKOLL.md section 7: (1) the side file <name>.tmp, on the disk; (2) the previous version copied to <name>.bak.tmp, on the disk; (3) the side file
// replaces <name>; (4) <name>.bak.tmp replaces <name>.bak. The process may end after any step: <name> is always whole, the old text until (3), the new
// one after it. Each step gets three tries (a scanner holding a file for a moment).
bool FileStorage::write (const std::string& name, const std::string& text) {
    if (! owner || ! plainName (name)) return false;
    const auto child = [this] (const std::string& n) { return folder.getChildFile (juce::String::fromUTF8 (n.c_str())); };
    const auto target = child (name), side = child (name + ".tmp"), bak = child (name + ".bak"), bakSide = child (name + ".bak.tmp");
    const auto failed = [&] { side.deleteFile(); bakSide.deleteFile(); return false; };
    const auto step = [this] (int n) { if (afterStep) afterStep (n); };
    if (! folder.createDirectory().wasOk()) return false;
    // `bytes` (or the whole of `from`) into `to`, on the disk: FlushFileBuffers on Windows, fsync elsewhere, before it replaces anything
    const auto put = [] (const juce::File& to, const std::string* bytes, const juce::File* from) {
        if (! to.deleteFile()) return false; // true when there is nothing to delete
        juce::FileOutputStream out (to);
        if (out.failedToOpen()) return false;
        if (bytes != nullptr && ! out.write (bytes->data(), bytes->size())) return false;
        if (from != nullptr) {
            juce::FileInputStream in (*from);
            if (in.failedToOpen() || out.writeFromInputStream (in, -1) != in.getTotalLength() || in.getStatus().failed()) return false;
        }
        out.flush();
        return out.getStatus().wasOk();
    };
    if (! tries ([&] { return put (side, &text, nullptr); })) return failed();
    step (1);
    if (! tries ([&] { return target.existsAsFile() ? put (bakSide, nullptr, &target) : bakSide.deleteFile(); })) return failed();
    step (2);
    if (! tries ([&] { return replace (side, target); })) return failed();
    step (3);
    if (bakSide.existsAsFile() && ! tries ([&] { return replace (bakSide, bak); })) bakSide.deleteFile(); // the text holds; .bak stays the older version
    return true;
}
