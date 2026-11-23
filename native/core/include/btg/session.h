#pragma once

#include <memory>
#include <optional>
#include <string>

namespace btg {

// The web app's state (src/ui/state.js) and the rules of the handlers that change it, as one session, with the profile window and the last session the
// web keeps in the browser's storage. The page sends actions as JSON text and shows state(); the actions, their fields, the fields of state() and what is
// stored when are listed in native/PROTOKOLL.md. Control thread only.

// What the shell provides: lasting storage by name (profiles.json, session.json, mix.json, profiles.damaged.json). The app writes files, a browser shell later its
// own store.
struct Storage {
    virtual ~Storage() = default;
    // nothing (nullopt) only when nothing is stored under the name; a storage that cannot read what is stored (locked, no permission, an error of the medium) throws.
    // The session tells the two apart: a name it could not read is never written over in silence (PROTOKOLL.md section 3a).
    virtual std::optional<std::string> read(const std::string& name) = 0;
    virtual bool write(const std::string& name, const std::string& text) = 0; // all or nothing; false or a throw: nothing was written
};

class Session {
public:
    // the web app's page load: reads the storage once (the profiles, the mixer, the last session as the offer of "Weitermachen"), the start state of variant 1;
    // restores nothing, writes nothing, never throws (a name it could not read is named in state().storage). The shell sends `start` next (PROTOKOLL.md section 2).
    explicit Session(Storage& storage);
    // a copy of `other` as it stands, on another storage (btg_logic_tests forks a session at a state to compare two ways on from it)
    Session(const Session& other, Storage& storage);
    ~Session();
    Session(const Session&) = delete;
    Session& operator=(const Session&) = delete;
    // inPlace: with restart, the web restarts at the bar that is playing (restartIfPlaying({ inPlace: true })), else from bar 1; never true without restart.
    // profiles: the action changed what profiles() gives (the page reads it again); the other seven are the web's calls of its player.
    struct Change { bool events = false, sound = false, voices = false, tempo = false, mix = false, restart = false, inPlace = false, profiles = false; };
    Change apply(const std::string& actionJson);   // never throws; an action that is not valid changes nothing
    // The key of an action whose effect a newer action with the same key replaces whole, empty for every other action (native/PROTOKOLL.md section 7,
    // "Was ein Schritt kostet": one knob's value; setTimbre of a group's field, setRhythmKnob of a knob, editPart of the selected part's level, density
    // or transition). On any state: an action with a key and directly after it a newer one with the same key give what the newer alone gives: state(),
    // track(), sound(), tuning(), profiles(), the newer's flags, every stored text (btg_logic_tests holds it on the states of its sequences). Not with
    // another action between (leaving out the first would change the order of the timbre's fields). The shell drops a queued action whose next one has
    // its key. Never throws.
    static std::string replaceKey(const std::string& actionJson);
    // The accessors never throw; each gives an empty text if something unexpected throws (none is known: an allocation that fails), and the caller keeps what it had.
    std::string track() const;                     // for Engine::setTrack: every layer on, as the web hands its player; the mutes are state().track.layers, for Engine::setMuted
    std::string sound() const;                     // for Engine::setSound
    std::string tuning() const;                    // for Engine::setTuning
    std::string state() const;                     // everything the page shows but the profile window and what depends on the playback's position
    std::string profiles() const;                  // the profile window (PROTOKOLL.md section 4); built when an action changes it, not per call
    // what the displays show at the playback's position `beats` (the transport's beats, counted from the start of the song; beyond the loop's end and below 0 they wrap
    // around the loop), as the shell's position message brings it 30 times a second (PROTOKOLL.md section 4)
    std::string position(double beats) const;
    // the text of the file that "Als Datei" gives for the row `key` of the profile window (PROTOKOLL.md section 3); `name` is the file's name for the session, a factory
    // profile and "mine"; empty for a key without a row and for an empty folder
    std::string exportFile(const std::string& key, const std::string& name) const;

private:
    struct Memory; // the state, the tree of profiles, what "undo" keeps, the last session (session.cpp)
    Storage& storage_;
    std::unique_ptr<Memory> memory_;
};

} // namespace btg
