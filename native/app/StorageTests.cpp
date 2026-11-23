// Checks of the app's storage (Storage.h, native/PROTOKOLL.md section 7) on fresh folders in the temp directory, removed afterwards: the rules of
// read and write, and the abort test of Review Focus 3. There a child process (this program again: --abort <step> <folder in base64 of UTF-8> <n>)
// saves profile n through a session and ends itself after step <step> of the write; afterwards a fresh storage reads the old text whole (the new
// one after step 3), a fresh session has every profile, and the next write works. Its folder has characters outside ASCII and outside the ANSI
// code page (a user named Jürgen or Łucja): the child gets the path in base64, since Windows hands main() its arguments in the ANSI code page.
#include "Storage.h"

#include <btg/session.h>

#include <chrono>
#include <cstdio>
#include <functional>
#include <thread>

// The test calls the system itself to make the conditions it checks (a file held by another handle with a share mode JUCE does not offer, held for
// good or for a moment); that is ruled fine for a test, while the storage's own calls stay in Storage.cpp. macOS and Linux have no mandatory locks:
// there these checks are skipped, and a test of a transient failure would need another way to make one (a folder without write permission).
#if JUCE_WINDOWS
 #ifndef NOMINMAX
  #define NOMINMAX
 #endif
 #ifndef WIN32_LEAN_AND_MEAN
  #define WIN32_LEAN_AND_MEAN
 #endif
 #include <windows.h>
#endif

namespace {

int failures = 0, checks = 0;
void check (bool ok, const juce::String& what) {
    ++checks;
    if (! ok) { ++failures; std::printf ("FAIL: %s\n", what.toRawUTF8()); }
}
bool throws (const std::function<void()>& f, const char* containing = "") {
    try { f(); } catch (const std::exception& e) { return juce::String (e.what()).contains (containing); }
    return false;
}
std::string contentOf (const juce::File& f) { return f.existsAsFile() ? f.loadFileAsString().toStdString() : std::string ("(none)"); }
// what read gives as a text, a throw included, for the checks that expect a text (a throw fails the check instead of ending the test)
std::string readText (FileStorage storage, const char* name) {
    try { return storage.read (name).value_or ("(nothing)"); } catch (const std::exception& e) { return std::string ("(threw: ") + e.what() + ")"; }
}
juce::File freshFolder (const char* utf8Name) {
    return juce::File::getSpecialLocation (juce::File::tempDirectory).getNonexistentChildFile ("btg-storage-" + juce::String::fromUTF8 (utf8Name), {}, false);
}
void putFile (const juce::File& f, const std::string& text) { f.getParentDirectory().createDirectory(); f.replaceWithData (text.data(), text.size()); }

// a save selects the new profile; the next one needs the session's row selected again
void saveProfile (btg::Session& session, int n) {
    session.apply ("{\"action\":\"profileSelect\",\"key\":\"session\"}");
    session.apply ("{\"action\":\"saveProfile\",\"name\":\"Profil " + std::to_string (n) + "\",\"folder\":null,\"parts\":[\"harmony\",\"tempo\",\"style\"],\"id\":\"id-"
                   + std::to_string (n) + "\"}");
}
// the profiles of a profiles.json text, -1 when it is no whole tree
int profilesIn (const std::string& text) {
    const auto tree = juce::JSON::parse (juce::String::fromUTF8 (text.data(), static_cast<int> (text.size())));
    return tree.isObject() && tree["items"].isArray() ? tree["items"].size() : -1;
}
int profilesOf (const btg::Session& session) { return juce::JSON::parse (juce::String::fromUTF8 (session.profiles().c_str()))["items"].size(); }
bool storageFine (const btg::Session& session) { // state().storage names no problem: every value null
    const auto storage = juce::JSON::parse (juce::String::fromUTF8 (session.state().c_str()))["storage"];
    return storage.isObject() && storage["profiles"].isVoid() && storage["session"].isVoid() && storage["mix"].isVoid();
}

void rules() {
    const auto folder = freshFolder ("rules");
    FileStorage storage (folder);
    const auto at = [&] (const char* n) { return folder.getChildFile (n); };
    check (readText (storage, "mix.json") == "(nothing)", "a name without a file (in a folder that does not exist) reads as nothing");
    check (storage.write ("mix.json", "A") && readText (storage, "mix.json") == "A", "the first write is read back");
    check (! at ("mix.json.bak").exists() && ! at ("mix.json.tmp").exists() && ! at ("mix.json.bak.tmp").exists(), "the first write leaves no .bak and no side file");
    check (storage.write ("mix.json", "B") && readText (storage, "mix.json") == "B" && contentOf (at ("mix.json.bak")) == "A", "a second write keeps the first as .bak");
    check (storage.write ("mix.json", "C") && contentOf (at ("mix.json.bak")) == "B", "a third write keeps the second as .bak");
    check (storage.write ("session.json", "") && readText (storage, "session.json") == "", "an empty text is stored and read as empty, not as nothing");

    // paths, the storage's own endings, what Win32 rewrites (a trailing dot or space), and device names with and without an extension
    for (const char* name : { "", ".", "..", "../x.json", "a/x.json", "a\\x.json", "C:x.json", "x.json.tmp", "x.json.bak", "/x.json", "mix.json.", "mix.json ",
                              "x.tmp ", "x.bak.", "CON", "con.json", "NUL", "nul.txt", "Aux.json", "PRN", "AUX .json", "COM1", "com9.json", "LPT1", "lpt3.log",
                              "COM\xc2\xb9", "lpt\xc2\xb2.json", "CONIN$", "conout$.json", "mix.json.TMP", "mix.json.Bak", "x.json.BAK" }) {
        check (! storage.write (name, "X"), juce::String ("write refuses the name \"") + juce::String::fromUTF8 (name) + "\"");
        check (throws ([&] { storage.read (name); }), juce::String ("read refuses the name \"") + juce::String::fromUTF8 (name) + "\"");
    }
    check (! folder.getParentDirectory().getChildFile ("x.json").exists() && ! folder.getChildFile ("a").exists(), "a refused name writes nothing anywhere");
    for (const char* name : { "console.json", "com10.json", "nul-mix.json", "profiles.damaged.json" })
        check (storage.write (name, "Y") && readText (storage, name) == "Y" && folder.getChildFile (name).deleteFile(), juce::String ("the name \"") + name + "\" is a plain name");

    putFile (at ("mix.json.tmp"), "garbage");
    putFile (at ("mix.json.bak.tmp"), "garbage too");
    check (readText (storage, "mix.json") == "C", "a leftover side file is not taken for the target");
    check (storage.write ("mix.json", "D") && readText (storage, "mix.json") == "D" && contentOf (at ("mix.json.bak")) == "C"
           && ! at ("mix.json.tmp").exists() && ! at ("mix.json.bak.tmp").exists(), "a write after leftover side files works and clears them");
    putFile (at ("profiles.json.tmp"), "{\"version\":2,\"items\":[]}");
    check (readText (storage, "profiles.json") == "(nothing)", "a side file alone is not taken for the target: nothing is stored");

    putFile (at ("profiles.json"), std::string (static_cast<size_t> (FileStorage::limit), 'x'));
    check (readText (storage, "profiles.json").size() == static_cast<size_t> (FileStorage::limit), "a file of 20000000 bytes is read");
    putFile (at ("profiles.json"), std::string (static_cast<size_t> (FileStorage::limit) + 1, 'x'));
    check (throws ([&] { storage.read ("profiles.json"); }, "larger than 20000000 bytes"), "a file of 20000001 bytes throws with its own reason");
    at ("profiles.json").deleteFile();
    at ("profiles.json.tmp").deleteFile();

    at ("folder.json").createDirectory();
    check (throws ([&] { storage.read ("folder.json"); }), "a folder of the name throws, it is not nothing");

#if JUCE_WINDOWS
    // another handle on mix.json, as a scanner, a backup or a second instance holds one: `share` 0 locks it, FILE_SHARE_READ lets it be read and copied but not replaced
    const auto hold = [&] (DWORD share) { return CreateFileW (at ("mix.json").getFullPathName().toWideCharPointer(), GENERIC_READ, share, nullptr, OPEN_EXISTING, 0, nullptr); };
    const auto unchanged = [&] { return readText (storage, "mix.json") == "D" && contentOf (at ("mix.json.bak")) == "C" && ! at ("mix.json.tmp").exists() && ! at ("mix.json.bak.tmp").exists(); };
    HANDLE lock = hold (0);
    check (lock != INVALID_HANDLE_VALUE, "the test locks mix.json");
    check (throws ([&] { storage.read ("mix.json"); }), "a locked file throws on read");
    check (! storage.write ("mix.json", "E"), "a write over a locked file fails (its previous version cannot be copied)");
    CloseHandle (lock);
    check (unchanged(), "a failed write (locked) leaves target and .bak as they were, and no side file");
    lock = hold (FILE_SHARE_READ);
    check (lock != INVALID_HANDLE_VALUE, "the test holds mix.json open without FILE_SHARE_DELETE");
    check (readText (storage, "mix.json") == "D", "a file held open for reading is read");
    check (! storage.write ("mix.json", "F") && ! at ("mix.json.bak.tmp").exists(), "a write over a file that cannot be replaced fails at the replace and clears its copy");
    CloseHandle (lock);
    check (unchanged(), "a failed write (replace) leaves target and .bak as they were, and no side file");
    // held for a moment (a scanner): locked before the call, let go after 30 ms; the first try meets the lock, the second (after 150 ms) and the
    // third (after 300 ms) leave 120 and 270 ms for a thread that a loaded machine wakes late
    const auto heldFor = [&] (int ms) {
        HANDLE moment = hold (0);
        check (moment != INVALID_HANDLE_VALUE, "the test locks mix.json for a moment");
        return std::thread ([moment, ms] { std::this_thread::sleep_for (std::chrono::milliseconds (ms)); CloseHandle (moment); });
    };
    auto releaser = heldFor (30);
    check (readText (storage, "mix.json") == "D", "a file locked for 30 ms is read (it tries again)");
    releaser.join();
    releaser = heldFor (30);
    check (storage.write ("mix.json", "G") && readText (storage, "mix.json") == "G" && contentOf (at ("mix.json.bak")) == "D", "a write over a file locked for 30 ms goes through");
    releaser.join();
#else
    std::printf ("skipped: the checks of locked files (Windows only)\n");
#endif
    folder.deleteRecursively();
}

// "Nothing stored" only for a file known not to exist (FileStorage::nothingStored); every other answer of the system is a file that cannot be read.
void lookups() {
#if JUCE_WINDOWS
    check (FileStorage::nothingStored (ERROR_FILE_NOT_FOUND, false) && FileStorage::nothingStored (ERROR_FILE_NOT_FOUND, true), "ERROR_FILE_NOT_FOUND: nothing stored");
    check (FileStorage::nothingStored (ERROR_PATH_NOT_FOUND, true), "ERROR_PATH_NOT_FOUND with the storage's folder missing (a first start): nothing stored");
    check (! FileStorage::nothingStored (ERROR_PATH_NOT_FOUND, false), "ERROR_PATH_NOT_FOUND while the storage's folder is there: unreadable");
    for (const DWORD error : { ERROR_BAD_NETPATH, ERROR_NETNAME_DELETED, ERROR_INVALID_NAME, ERROR_BAD_PATHNAME, ERROR_DIRECTORY, ERROR_ACCESS_DENIED,
                               ERROR_SHARING_VIOLATION, ERROR_NOT_READY, ERROR_BAD_NET_NAME, ERROR_UNEXP_NET_ERR })
        for (const bool folderMissing : { false, true })
            check (! FileStorage::nothingStored (error, folderMissing), "error " + juce::String (static_cast<int> (error)) + ": unreadable, not nothing stored");
#endif
    const auto base = freshFolder ("lookups");
    base.createDirectory();
    check (readText (FileStorage (base.getChildFile ("missing")), "profiles.json") == "(nothing)", "the storage's folder missing (a first start): nothing stored");
    check (readText (FileStorage (base), "profiles.json") == "(nothing)", "the folder there, the file missing: nothing stored");
    putFile (base.getChildFile ("plain"), "a file");
    check (throws ([&] { FileStorage (base.getChildFile ("plain")).read ("profiles.json"); }), "a component of the folder's path that is a file: unreadable");
    check (throws ([&] { FileStorage (base.getChildFile ("missing").getChildFile ("deeper")).read ("profiles.json"); }),
           "the storage's folder and its parent missing: unreadable (only a missing folder of its own is a first start)");
#if JUCE_WINDOWS
    check (throws ([&] { FileStorage (base.getChildFile ("in<valid")).read ("profiles.json"); }), "a folder whose name the system calls invalid: unreadable");
#endif
    base.deleteRecursively();
}

// The abort test: five profiles saved, then the child saves the sixth and ends itself after `step` of the write.
void abortAfter (int step, const juce::File& exe) {
    const auto folder = freshFolder ("abort-J\xc3\xbcrgen-\xc5\x81ucja"); // Jürgen-Łucja: Ł is outside the ANSI code page of a German Windows
    const auto at = [&] (const char* n) { return folder.getChildFile (n); };
    {
        FileStorage storage (folder);
        btg::Session session (storage);
        session.apply ("{\"action\":\"start\",\"variant\":1}");
        for (int n = 1; n <= 5; ++n) saveProfile (session, n);
        check (profilesOf (session) == 5 && profilesIn (contentOf (at ("profiles.json"))) == 5, "five profiles stored before the abort");
    }
    juce::ChildProcess child;
    const auto path = folder.getFullPathName();
    const auto encoded = juce::Base64::toBase64 (path.toRawUTF8(), path.getNumBytesAsUTF8());
    const bool started = child.start (juce::StringArray { exe.getFullPathName(), "--abort", juce::String (step), encoded, "6" });
    check (started && child.waitForProcessToFinish (60000), "the child of the abort test ran");
    const auto code = child.getExitCode();
    check (code == 1, "the child ended its own process after step " + juce::String (step) + " (exit code " + juce::String (code) + "; 7: it did not, 8 or 9: it did not find its folder)");

    const int kept = step < 3 ? 5 : 6;
    FileStorage storage (folder);
    const auto stored = readText (storage, "profiles.json");
    check (profilesIn (stored) == kept, "after an abort at step " + juce::String (step) + " profiles.json is whole with " + juce::String (kept) + " profiles");
    check (profilesIn (contentOf (at ("profiles.json.bak"))) == 4, "after an abort at step " + juce::String (step) + " .bak is the version before the last write");
    if (step == 3) check (profilesIn (contentOf (at ("profiles.json.bak.tmp"))) == 5, "after an abort at step 3 the previous version waits in .bak.tmp");
    btg::Session session (storage);
    check (profilesOf (session) == kept && storageFine (session),
           "after an abort at step " + juce::String (step) + " a fresh session has every profile (" + juce::String (profilesOf (session)) + ") and no problem with the storage");
    session.apply ("{\"action\":\"start\",\"variant\":1}");
    saveProfile (session, 7);
    check (profilesOf (session) == kept + 1 && profilesIn (contentOf (at ("profiles.json"))) == kept + 1 && profilesIn (contentOf (at ("profiles.json.bak"))) == kept
           && ! at ("profiles.json.tmp").exists() && ! at ("profiles.json.bak.tmp").exists(), "after an abort at step " + juce::String (step) + " the next write works and clears the side files");
    folder.deleteRecursively();
}

} // namespace

int main (int argc, char** argv) {
    if (argc == 5 && juce::String (argv[1]) == "--abort") { // the child of the abort test
        const int step = juce::String (argv[2]).getIntValue();
        juce::MemoryOutputStream path;
        if (! juce::Base64::convertFromBase64 (path, argv[3])) return 8;
        const auto folder = juce::File (juce::String::fromUTF8 (static_cast<const char*> (path.getData()), static_cast<int> (path.getDataSize())));
        if (! folder.isDirectory()) return 9; // the folder of the parent: it must be found, not made anew elsewhere
        FileStorage storage (folder, [step] (int s) { if (s == step) juce::Process::terminate(); });
        btg::Session session (storage);
        session.apply ("{\"action\":\"start\",\"variant\":1}");
        saveProfile (session, juce::String (argv[4]).getIntValue());
        return 7; // the write went through: the abort did not happen
    }
    rules();
    lookups();
    const auto exe = juce::File::getSpecialLocation (juce::File::currentExecutableFile);
    for (int step = 1; step <= 3; ++step) abortAfter (step, exe);
    std::printf ("storage: %d of %d checks wrong (the rules of read and write; the abort after each step of a write: the stored text whole, every profile there)\n", failures, checks);
    return failures ? 1 : 0;
}
