#pragma once

#include <optional>
#include <string>

namespace btg {

// The web app's state (src/ui/state.js) and the rules of the handlers that change it, as one session. The page sends actions as JSON text and
// shows state(); the actions, their fields and the fields of state() are listed in native/PROTOKOLL.md. Control thread only.

// What the shell provides: lasting storage by name. The app writes files, a browser shell later its own store.
struct Storage {
    virtual ~Storage() = default;
    virtual std::optional<std::string> read(const std::string& name) = 0;
    virtual bool write(const std::string& name, const std::string& text) = 0; // all or nothing
};

class Session {
public:
    explicit Session(Storage& storage);            // the last session, else the start state of the web app
    // inPlace: with restart, the web restarts at the bar that is playing (restartIfPlaying({ inPlace: true })), else from bar 1; never true without restart
    struct Change { bool events = false, sound = false, voices = false, tempo = false, mix = false, restart = false, inPlace = false; };
    Change apply(const std::string& actionJson);   // never throws; an action that is not valid changes nothing
    std::string track() const;                     // for Engine::setTrack: every layer on, as the web hands its player; the mutes are state().track.layers, for Engine::setMuted
    std::string sound() const;                     // for Engine::setSound
    std::string tuning() const;                    // for Engine::setTuning
    std::string state() const;                     // everything the page shows

private:
    [[maybe_unused]] Storage& storage_; // shortcut: read and written by nothing yet, upgrade: Task 30 (the last session, profiles)
    std::string state_;                 // the state as JSON text, the fields of state() without `errors`
};

} // namespace btg
