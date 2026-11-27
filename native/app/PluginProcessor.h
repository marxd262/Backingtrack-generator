#pragma once

#include <juce_audio_utils/juce_audio_utils.h>

#include "Storage.h"

#include <btg/engine.h>
#include <btg/file_player.h>
#include <btg/session.h>
#include <btg/transport.h>

#include <map>
#include <optional>

// A folder of the files the app reads: the one the variable `variable` names (tests and checks; relative to the working folder), else `name` beside
// the program (where the build puts them), else `repository` (the build machine's: while developing).
juce::File appFolder (const char* variable, const char* name, const char* repository);

class BackingtrackProcessor final : public juce::AudioProcessor, private juce::Thread {
public:
    BackingtrackProcessor();
    ~BackingtrackProcessor() override;

    void prepareToPlay (double sampleRate, int) override { engine.prepare (sampleRate); filePlayer.prepare (sampleRate); }
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram (int) override {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    // For the editor (message thread).
    btg::Transport transport;
    btg::Engine engine;
    juce::AudioProcessorValueTreeState parameters;
    // Sample packs by id, read once and kept for the app's life (the engine's tones point into them). Loader thread only;
    // throws like btg::loadPackFiles.
    std::shared_ptr<const btg::Pack> pack (const std::string& id);
    static juce::File packsFolder(); // where pack() reads them, with the packs' licence texts (LICENSE-*.md); appFolder of BTG_PACKS_DIR, samples/
    // Speed of the loaded track (1 = as recorded). Here, not in the editor: the queued messages playFile and fileRate set and
    // read it, so it is touched on the loader thread only.
    double fileRate = 1.0;

    // A track of the user's: decoded and analysed on a background thread, then played by filePlayer.
    // While playsFile is set, one beat of the transport is one second of the track.
    void loadTrack (const juce::File& file);
    struct TrackState {
        juce::String name, error, analysis; // analysis: JSON of btg::toJson, empty until done
        juce::String video;                 // path of the file when it has a picture (a video file), else empty
        juce::String peaks;                 // overview for the waveform: loudest sample of every 10 ms as a byte, base64
        double seconds = 0.0, loadMs = 0.0, analysisMs = 0.0;
        int version = 0;                    // counts finished loads
    };
    TrackState trackState() const { const juce::ScopedLock lock (trackLock); return track; }
    std::atomic<float> trackProgress { 0.0f }; // 0..1 while loading, 1 when done
    std::atomic<bool> trackLoading { false }, playsFile { false };
    btg::FilePlayer filePlayer;

    // Measurement: call when a control arrives; reactionMs is the time until the audio thread next ran, i.e. used it.
    void controlArrived() { controlAt = juce::Time::getHighResolutionTicks(); }
    std::atomic<float> reactionMs { 0.0f }, load { 0.0f };

    // The core's session on the user's storage (private below), built once; what the shell does with it is native/PROTOKOLL.md, section 7.
    // for the page; profiles empty: unchanged; derived: the session's text (the editor sends it when it changed); tables: only for `sync`
    struct Answer { std::string state, profiles; std::optional<btg::Session::Change> change; int events = 0; std::string derived, tables; };
    struct Lanes { std::string json; double bpm = 0.0; int number = 0; double beats = 0.0; }; // the events of the lanes, built at the tempo bpm; beats: the loop's length
    struct Followed { juce::String failed, status; std::optional<Lanes> lanes; }; // after the engine followed: a failed call, voiceStatus (empty: no track or voices set), new lanes
    // Loader thread. An action (its JSON text) and what follows it; `answered` gets the session's answer at once, before the lanes and the engine.
    Followed act (std::string actionJson, const std::function<void (const Answer&)>& answered);
    Followed playSession();                // loader thread: the play key, the session's song from bar 1 with everything
    std::optional<Answer> stopTransport(); // the thread that runs the transport's messages: stops; the answer when it remembered the session first
    Answer answerNow() const;              // any thread: the state and the profile view as they stand
    std::optional<Lanes> lanesNow() const; // any thread: the last lanes built
    std::optional<std::string> positionNow (double beats); // any thread: position(beats), nothing when the session's lock is held (the caller never waits)
    std::string exportNow (const std::string& key, const std::string& name) const; // any thread: Session::exportFile
    std::atomic<bool> sessionPlays { false }; // the transport's last start was the session's song

private:
    // The session is not thread-safe: every call of it holds sessionLock. Actions and the playback of its song run on the loader thread, in order with
    // the transport's messages; apply is short, the lanes and the engine calls after it run outside the lock.
    FileStorage storage { FileStorage::defaultFolder() };
    juce::CriticalSection sessionLock;
    btg::Session session { storage };
    struct Texts;
    int barPlaying();                      // under sessionLock: the bar the session's song plays, -1 when it plays none
    void everything (const Texts& t);      // loader thread: the engine with the whole state
    void mix (const juce::var& state);
    void playFrom (const std::string& song, int bar, double bpm, bool inPlace); // song: the session's track()
    int lanesNumber = 0;                   // under sessionLock: the number of the newest lanes, as the state's answer carries it
    std::string lanesKey;                  // loader thread: laneKey of the track the newest lanes are built from
    std::optional<Lanes> lastLanes;        // under sessionLock
    bool barInLead = false;                // under sessionLock: the lead of a restart in place, where the web knows the bar at once (app.js 180)

    void run() override;

    std::atomic<float>* master = parameters.getRawParameterValue ("master");
    std::atomic<juce::int64> controlAt { 0 };
    // BTG_MUTE=1 in the environment: everything runs and is measured, nothing reaches the output (automatic checks)
    const bool muted = juce::SystemStats::getEnvironmentVariable ("BTG_MUTE", {}) == "1";
    juce::CriticalSection trackLock;
    TrackState track;
    juce::File trackFile;
    std::map<std::string, std::shared_ptr<const btg::Pack>> packs;

public:
    // Work that reads packs or builds the song, and the transport with it, in the order the page sent it (PluginEditor.cpp, `queued`).
    // The last member: destroyed first, so a job still running never touches a member that is gone.
    juce::ThreadPool loader { juce::ThreadPoolOptions{}.withThreadName ("loader").withNumberOfThreads (1) };
};
