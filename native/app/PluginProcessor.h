#pragma once

#include <juce_audio_utils/juce_audio_utils.h>

#include <btg/engine.h>
#include <btg/file_player.h>
#include <btg/transport.h>

#include <map>

class BackingtrackProcessor final : public juce::AudioProcessor, private juce::Thread {
public:
    BackingtrackProcessor();
    ~BackingtrackProcessor() override { loader.removeAllJobs (true, 10000); stopThread (10000); }

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

private:
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
