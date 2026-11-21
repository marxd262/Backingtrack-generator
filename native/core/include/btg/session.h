#pragma once

#include <memory>
#include <optional>
#include <string>

namespace btg {

// The web app's state (src/ui/state.js) and the rules of the handlers that change it, as one session, with the profile window and the last session the
// web keeps in the browser's storage. The page sends actions as JSON text and shows state(); the actions, their fields, the fields of state() and what is
// stored when are listed in native/PROTOKOLL.md. Control thread only.

// What the shell provides: lasting storage by name (profiles.json, session.json, mix.json). The app writes files, a browser shell later its own store. A call
// that throws counts as one that fails: nothing read, nothing written.
struct Storage {
    virtual ~Storage() = default;
    virtual std::optional<std::string> read(const std::string& name) = 0;
    virtual bool write(const std::string& name, const std::string& text) = 0; // all or nothing
};

class Session {
public:
    // the web app's page load: reads the storage once (the profiles, the mixer, the last session as the offer of "Weitermachen"), the start state of variant 1;
    // restores nothing, writes nothing, never throws. The shell sends `start` next (PROTOKOLL.md section 2).
    explicit Session(Storage& storage);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;
    // inPlace: with restart, the web restarts at the bar that is playing (restartIfPlaying({ inPlace: true })), else from bar 1; never true without restart
    struct Change { bool events = false, sound = false, voices = false, tempo = false, mix = false, restart = false, inPlace = false; };
    Change apply(const std::string& actionJson);   // never throws; an action that is not valid changes nothing
    std::string track() const;                     // for Engine::setTrack: every layer on, as the web hands its player; the mutes are state().track.layers, for Engine::setMuted
    std::string sound() const;                     // for Engine::setSound
    std::string tuning() const;                    // for Engine::setTuning
    std::string state() const;                     // everything the page shows
    // the text of the file that "Als Datei" gives for the row `key` of the profile window (PROTOKOLL.md section 3); `name` is the file's name for the session, a factory
    // profile and "mine"; empty for a key without a row and for an empty folder
    std::string exportFile(const std::string& key, const std::string& name) const;

private:
    struct Memory; // the state, the tree of profiles, what "undo" keeps, the last session (session.cpp)
    Storage& storage_;
    std::unique_ptr<Memory> memory_;
};

} // namespace btg
