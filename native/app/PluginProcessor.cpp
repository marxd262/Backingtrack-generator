#include "PluginProcessor.h"

#include <btg/analysis.h>
#ifdef BTG_BEAT_MODEL
#include <btg/beat_model.h>
#endif
#include <btg/decode.h>
#include <btg/generator.h>
#include <btg/pack.h>
#include <btg_platform/system_audio.h>

#include <cmath>
#include <filesystem>

juce::AudioProcessorEditor* createBackingtrackEditor (BackingtrackProcessor&); // PluginEditor.cpp

// Part of the name under which an analysis is kept: raise it whenever the analysis reads tracks differently.
static const char* const analysisVersion = "2026-11-17h";

static juce::AudioProcessorValueTreeState::ParameterLayout createParameters() {
    using Float = juce::AudioParameterFloat;
    return {
        // Fader position as in the web mixer: gain is the square, 1 = unchanged.
        std::make_unique<Float>(juce::ParameterID { "master", 1 }, "Master", juce::NormalisableRange<float> (0.0f, 1.0f), 1.0f),
    };
}

BackingtrackProcessor::BackingtrackProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      juce::Thread ("track loader"),
      parameters (*this, nullptr, "state", createParameters()) {
    engine.setPackSource ([this] (const std::string& id) { return pack (id); });
    // PROTOKOLL.md section 2 and 7: after the session is built, always `start` with a variant the shell draws (rollVariant: 1 to 9999); the engine follows
    const auto start = "{\"action\":\"start\",\"variant\":" + std::to_string (juce::Random::getSystemRandom().nextInt ({ 1, 10000 })) + "}";
    loader.addJob ([this, start] { act (start, [] (const Answer&) {}); }); // the page is not there yet: it asks with `sync`
}

BackingtrackProcessor::~BackingtrackProcessor() {
    loader.removeAllJobs (true, 10000);
    stopThread (10000);
    stopTransport(); // the app closes: the web's pagehide remembers the session that plays
}

// ---------- the session (PROTOKOLL.md section 7) ----------

namespace {

juce::var parsed (const std::string& text) { return juce::JSON::parse (juce::String::fromUTF8 (text.data(), static_cast<int> (text.size()))); }
const char* const layerIds[] = { "drums", "bass", "chords", "pad", "lead", "percussion" }; // order of btg::Engine::Layer

// what stop() remembers in the web (app.js 154): the session at the bar that plays, at the time of the app's clock
std::string remembered (int bar) {
    return "{\"action\":\"rememberSession\",\"bar\":" + std::to_string (bar) + ",\"at\":" + std::to_string (juce::Time::currentTimeMillis()) + "}";
}

} // namespace

// The session's texts the engine gets, read under the lock and used outside it.
struct BackingtrackProcessor::Texts { std::string track, sound, tuning, state; };

int BackingtrackProcessor::barPlaying() {
    // the web's state.current: null until the first bar of a start (the lead), but at once after a restart in place
    if (! sessionPlays || ! transport.playing() || (transport.standing() && ! barInLead)) return -1;
    return static_cast<int> (parsed (session.position (transport.beats()))["bar"]);
}

BackingtrackProcessor::Followed BackingtrackProcessor::act (std::string action, const std::function<void (const Answer&)>& answered) {
    const juce::var given = parsed (action);
    const bool resume = given["action"].toString() == "resume";
    btg::Session::Change c;
    Texts t;
    Answer answer;
    bool newLanes = false, hadLast = false;
    int bar = -1, number = 0;
    {
        const juce::ScopedLock lock (sessionLock);
        bar = barPlaying();
        if (resume && given.isObject()) { // "Weitermachen": the shell says whether a bar plays (PROTOKOLL.md section 7)
            hadLast = ! parsed (session.state())["last"].isVoid();
            juce::var playing;
            if (bar >= 0) {
                playing = new juce::DynamicObject();
                playing.getDynamicObject()->setProperty ("bar", bar);
                playing.getDynamicObject()->setProperty ("at", juce::Time::currentTimeMillis());
            }
            given.getDynamicObject()->setProperty ("playing", playing);
            action = juce::JSON::toString (given, true).toStdString();
        }
        c = session.apply (action);
        if (c.restart && ! resume && bar >= 0) session.apply (remembered (bar)); // restartIfPlaying stops first, and stop() remembers
        t = { session.track(), session.sound(), session.tuning(), session.state() };
        if (const auto key = btg::laneKey (t.track); key != lanesKey) {
            lanesKey = key;
            newLanes = true;
            ++lanesNumber;
        }
        number = lanesNumber;
        answer = { t.state, c.profiles ? session.profiles() : std::string(), c, number, session.derived(), {} };
    }
    answered (answer);

    Followed f;
    const juce::var state = parsed (t.state), sessionTrack = parsed (t.track);
    const auto bpm = static_cast<double> (sessionTrack["bpm"]);
    if (newLanes) { // the number the answer named always comes with its lanes: an empty list when the song cannot be built (the web draws an empty lane, tuning.js 93)
        Lanes lanes { "[]", bpm, number };
        try {
            const auto song = btg::buildSong (t.track);
            lanes.json = btg::eventsJson (song.events);
            for (const int beats : song.barBeats) lanes.beats += beats;
        } catch (const std::exception& e) { f.failed = e.what(); }
        f.lanes = lanes;
        const juce::ScopedLock lock (sessionLock);
        lastLanes = std::move (lanes);
    }
    try {
        const bool playing = sessionPlays && transport.playing();
        if (c.restart) {
            everything (t);
            f.status = engine.voiceStatus();
            if (resume) playFrom (t.track, static_cast<int> (state["resumed"]["bar"]), bpm, false); // in any case, at the bar it restored
            else if (playing) {
                const int loop = juce::jmax (1, static_cast<int> (state["loopBars"]));
                const bool inPlace = c.inPlace && bar >= 0; // with no bar yet the web's state.current is null: from bar 1
                playFrom (t.track, inPlace ? bar % loop : 0, bpm, inPlace);
            }
            return f;
        }
        if (resume && hadLast && playing) { // it did not restore: the web stopped before applyParts (app.js 229)
            transport.stop();
            sessionPlays = false;
        }
        if (c.sound) {
            engine.setSound (t.sound);
            engine.setTuning (t.tuning);
        }
        if (c.events) engine.setTrack (t.track); // with the track's voices
        else if (c.voices) engine.setVoices (juce::JSON::toString (sessionTrack["voices"], true).toStdString());
        if (c.events || c.voices) f.status = engine.voiceStatus();
        if (c.tempo) transport.setTempo (bpm);
        if (c.mix) mix (state);
    } catch (const std::exception& e) {
        f.failed = e.what();
        f.status = engine.voiceStatus();
    }
    return f;
}

// start() of the web (app.js 121-151): the fine values first (the voices the track builds read them), the track, its sound, the mixer
void BackingtrackProcessor::everything (const Texts& t) {
    engine.setTuning (t.tuning);
    engine.setTrack (t.track);
    engine.setSound (t.sound);
    mix (parsed (t.state));
}

void BackingtrackProcessor::mix (const juce::var& state) {
    const auto& levels = state["mix"];
    if (auto* parameter = parameters.getParameter ("master")) parameter->setValueNotifyingHost (juce::jlimit (0.0f, 1.0f, static_cast<float> (levels["master"])));
    for (int l = 0; l < btg::Engine::layerCount; ++l) {
        const auto layer = static_cast<btg::Engine::Layer> (l);
        const juce::Identifier id (layerIds[l]);
        engine.setLevel (layer, static_cast<float> (levels[id]));
        engine.setPan (layer, static_cast<float> (state["pan"][id]));
        engine.setMuted (layer, ! static_cast<bool> (state["track"]["layers"][id]));
    }
}

// the transport plays the session's song from the start of `bar` (the core's barStart), after the web's lead of 0.15 s; throws as barStart
// shortcut: every start of the generator is delayed by the web app's 0.15 s (play.js LEAD), during which the clock stands and the sum's
// compressors settle on silence, upgrade: when a start must sound at once, age the chain's state by that time instead (a loaded file has none).
void BackingtrackProcessor::playFrom (const std::string& song, int bar, double bpm, bool inPlace) {
    const double beats = btg::barStart (song, bar);
    playsFile = false;
    transport.setLoop (0.0, 0.0);
    {
        const juce::ScopedLock lock (sessionLock);
        barInLead = inPlace;
    }
    sessionPlays = true;
    transport.play (beats, bpm, 0.15);
}

BackingtrackProcessor::Followed BackingtrackProcessor::playSession() {
    Texts t;
    {
        const juce::ScopedLock lock (sessionLock);
        t = { session.track(), session.sound(), session.tuning(), session.state() };
    }
    Followed f;
    try {
        everything (t);
        playFrom (t.track, 0, static_cast<double> (parsed (t.track)["bpm"]), false);
    } catch (const std::exception& e) {
        f.failed = e.what();
    }
    f.status = engine.voiceStatus();
    return f;
}

std::optional<BackingtrackProcessor::Answer> BackingtrackProcessor::stopTransport() {
    std::optional<Answer> answer;
    {
        const juce::ScopedLock lock (sessionLock);
        if (const int bar = barPlaying(); bar >= 0) {
            session.apply (remembered (bar));
            answer = Answer { session.state(), {}, std::nullopt, lanesNumber, session.derived(), {} };
        }
    }
    transport.stop();
    sessionPlays = false;
    return answer;
}

BackingtrackProcessor::Answer BackingtrackProcessor::answerNow() const {
    const juce::ScopedLock lock (sessionLock);
    return { session.state(), session.profiles(), std::nullopt, lanesNumber, session.derived(), btg::Session::tables() };
}

std::optional<BackingtrackProcessor::Lanes> BackingtrackProcessor::lanesNow() const {
    const juce::ScopedLock lock (sessionLock);
    return lastLanes;
}

std::optional<std::string> BackingtrackProcessor::positionNow (double beats) {
    const juce::ScopedTryLock lock (sessionLock);
    if (! lock.isLocked()) return std::nullopt;
    return session.position (beats);
}

std::string BackingtrackProcessor::exportNow (const std::string& key, const std::string& name) const {
    const juce::ScopedLock lock (sessionLock);
    return session.exportFile (key, name);
}

// shortcut: packs read from the repository of the build machine (BTG_WEB_ROOT); a release installs them next to the program (Task 34).
static const char* const packsPath = BTG_WEB_ROOT "/assets/samples";

juce::File BackingtrackProcessor::packsFolder() { return juce::File (packsPath); }

std::shared_ptr<const btg::Pack> BackingtrackProcessor::pack (const std::string& id) {
    auto& held = packs[id];
    if (held == nullptr) held = btg::loadPackFiles (packsPath, id);
    return held;
}

bool BackingtrackProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const {
    return layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}

void BackingtrackProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) {
    juce::ScopedNoDenormals noDenormals;
    const auto started = juce::Time::getHighResolutionTicks();
    if (const auto arrived = controlAt.exchange (0))
        reactionMs = static_cast<float> (juce::Time::highResolutionTicksToSeconds (started - arrived) * 1000.0);
    const int frames = buffer.getNumSamples();
    if (buffer.getNumChannels() < 2) {
        buffer.clear();
        return;
    }
    const bool file = playsFile;
    engine.setMaster (master->load());
    filePlayer.setGain (master->load() * master->load());
    // a loop end inside the block cuts it: the transport hands out the block in pieces
    for (int done = 0; done < frames;) {
        const auto block = transport.advance (frames - done, getSampleRate());
        auto* left = buffer.getWritePointer (0) + done;
        auto* right = buffer.getWritePointer (1) + done;
        if (file) filePlayer.render (left, right, block.frames, block);
        else engine.render (left, right, block.frames, block);
        done += block.frames;
    }
    // the device clips there anyway; this keeps a fault in the chain from the speakers: a finite sample is limited to +-1, a non-finite one becomes 0
    for (int c = 0; c < 2; ++c) {
        auto* x = buffer.getWritePointer (c);
        for (int i = 0; i < frames; ++i) x[i] = std::isfinite (x[i]) ? juce::jlimit (-1.0f, 1.0f, x[i]) : 0.0f;
    }
    if (muted) buffer.clear();
    const double used = juce::Time::highResolutionTicksToSeconds (juce::Time::getHighResolutionTicks() - started);
    load = std::max (load.load() * 0.999f, static_cast<float> (used * getSampleRate() / frames)); // share of the block's time, slowly falling peak
}

// Overview for the waveform: the loudest sample of every 10 ms as one byte, base64.
static juce::String peaksOf (const std::vector<float>& mono, double rate) {
    const size_t bucket = static_cast<size_t> (rate / 100.0);
    juce::MemoryBlock bytes;
    for (size_t at = 0; at < mono.size(); at += bucket) {
        float peak = 0.0f;
        for (size_t i = at; i < juce::jmin (mono.size(), at + bucket); ++i) peak = juce::jmax (peak, std::abs (mono[i]));
        const auto value = static_cast<juce::uint8> (juce::jlimit (0.0f, 255.0f, peak * 255.0f));
        bytes.append (&value, 1);
    }
    return juce::Base64::toBase64 (bytes.getData(), bytes.getSize());
}

void BackingtrackProcessor::loadTrack (const juce::File& file) {
    stopThread (10000); // a load still running is given up
    loader.addJob ([this] { stopTransport(); }); // in order with the queued transport messages (PluginEditor.cpp, `queued`)
    trackFile = file;
    trackProgress = 0.0f;
    trackLoading = true;
    startThread();
}

// Background thread: decode the whole file (JUCE's readers: WAV, AIFF, FLAC, Ogg, MP3, and what the system
// decodes, on Windows M4A/AAC and WMA through Media Foundation), then analyse it in the core.
void BackingtrackProcessor::run() {
    TrackState next;
    next.name = trackFile.getFileName();
    if (trackFile.hasFileExtension ("mp4;m4v;mov;mkv;webm;avi;wmv")) next.video = trackFile.getFullPathName();
    const auto started = juce::Time::getMillisecondCounterHiRes();
    // Beats and bars from the beat model when it is there (next to the program, or in the repository while
    // developing), then tempo, chords and key in the core. Without the model the core tracks the beats itself.
    // The result is kept per file (path, size, date) and version of the analysis, so a track opened again is there
    // at once. BTG_NO_CACHE=1 (the automatic checks) analyses every time.
    const auto kept = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("BackingtrackGenerator/analysis")
        .getChildFile (juce::String::toHexString ((trackFile.getFullPathName() + "|" + juce::String (trackFile.getSize()) + "|"
                                                   + juce::String (trackFile.getLastModificationTime().toMilliseconds()) + "|" + analysisVersion).hashCode64()) + ".json");
    const bool useKept = juce::SystemStats::getEnvironmentVariable ("BTG_NO_CACHE", {}).isEmpty();
    const auto analyse = [this, kept, useKept] (const std::vector<float>& mono, double rate) -> juce::String { // JSON; empty: too short or cancelled
        if (useKept && kept.existsAsFile()) return kept.loadFileAsString();
        btg::Grid grid;
#ifdef BTG_BEAT_MODEL
        auto model = juce::File::getSpecialLocation (juce::File::currentExecutableFile).getSiblingFile ("models/beat_this.onnx");
        if (! model.existsAsFile()) model = juce::File (BTG_MODELS_DIR).getChildFile ("beat_this.onnx");
        grid = btg::findBeats (mono.data(), mono.size(), rate, model.getFullPathName().toStdString(), [this] (double done) {
            trackProgress = 0.3f + 0.5f * static_cast<float> (done);
            return ! threadShouldExit();
        });
#endif
        const float from = grid.beats.empty() ? 0.3f : 0.8f;
        const auto analysis = btg::analyze (mono.data(), mono.size(), rate, [this, from] (double done) {
            trackProgress = from + (1.0f - from) * static_cast<float> (done);
            return ! threadShouldExit();
        }, {}, grid);
        if (analysis.beats.empty() || threadShouldExit()) return {};
        const juce::String json = btg::toJson (analysis);
        if (useKept && kept.getParentDirectory().createDirectory().wasOk()) {
            kept.replaceWithText (json);
            for (const auto& old : kept.getParentDirectory().findChildFiles (juce::File::findFiles, false, "*.json")) // results nobody asked for in half a year
                if (old.getLastAccessTime() < juce::Time::getCurrentTime() - juce::RelativeTime::days (180)) old.deleteFile();
        }
        return json;
    };
    // WAV, FLAC and MP3 go through the core's decoder, the one btg_analyze measures with. Other formats: JUCE, and
    // what JUCE cannot read, the system may (M4A/AAC on Windows).
    std::shared_ptr<btg::AudioClip> systemClip = btg::decodeFile (std::filesystem::path (trackFile.getFullPathName().toWideCharPointer()));
    juce::AudioFormatManager formats;
    formats.registerBasicFormats();
    const std::unique_ptr<juce::AudioFormatReader> reader (systemClip ? nullptr : formats.createReaderFor (trackFile));
    if (systemClip == nullptr && (reader == nullptr || reader->lengthInSamples <= 0)) {
        auto decoded = btg::platform::decodeWithSystem (trackFile.getFullPathName().toStdString());
        if (decoded.error.empty()) {
            systemClip = std::make_shared<btg::AudioClip>();
            systemClip->channels = decoded.channels;
            systemClip->rate = decoded.rate;
            systemClip->samples = std::move (decoded.samples);
        }
    }
    if (systemClip != nullptr) {
        const std::vector<float> mono = btg::monoOf (*systemClip);
        trackProgress = 0.3f;
        next.loadMs = juce::Time::getMillisecondCounterHiRes() - started;
        const auto analysis = analyse (mono, systemClip->rate);
        next.analysisMs = juce::Time::getMillisecondCounterHiRes() - started - next.loadMs;
        if (threadShouldExit()) return;
        if (analysis.isEmpty()) next.error = "Der Track ist zu kurz fuer die Analyse.";
        else {
            next.analysis = analysis;
            next.peaks = peaksOf (mono, systemClip->rate);
            next.seconds = systemClip->seconds();
            filePlayer.setClip (std::move (systemClip));
        }
    } else if (reader == nullptr || reader->lengthInSamples <= 0) {
        next.error = "Diese Datei kann nicht gelesen werden.";
    } else {
        const auto frames = static_cast<size_t> (reader->lengthInSamples);
        const int channels = juce::jmin (2, static_cast<int> (reader->numChannels));
        auto clip = std::make_shared<btg::AudioClip>();
        clip->channels = 2;
        clip->rate = reader->sampleRate;
        clip->samples.resize (frames * 2);
        std::vector<float> mono (frames);
        juce::AudioBuffer<float> chunk (channels, 1 << 16);
        for (size_t at = 0; at < frames && ! threadShouldExit(); at += static_cast<size_t> (chunk.getNumSamples())) {
            const int count = static_cast<int> (juce::jmin (frames - at, static_cast<size_t> (chunk.getNumSamples())));
            reader->read (&chunk, 0, count, static_cast<juce::int64> (at), true, true);
            const float* left = chunk.getReadPointer (0);
            const float* right = chunk.getReadPointer (channels - 1);
            for (int i = 0; i < count; ++i) {
                clip->samples[2 * (at + static_cast<size_t> (i))] = left[i];
                clip->samples[2 * (at + static_cast<size_t> (i)) + 1] = right[i];
                mono[at + static_cast<size_t> (i)] = 0.5f * (left[i] + right[i]);
            }
            trackProgress = 0.3f * static_cast<float> (at) / static_cast<float> (frames);
        }
        next.loadMs = juce::Time::getMillisecondCounterHiRes() - started;
        const auto analysis = analyse (mono, clip->rate);
        next.analysisMs = juce::Time::getMillisecondCounterHiRes() - started - next.loadMs;
        if (threadShouldExit()) return;
        if (analysis.isEmpty()) next.error = "Der Track ist zu kurz fuer die Analyse.";
        else {
            next.analysis = analysis;
            next.peaks = peaksOf (mono, clip->rate);
            next.seconds = clip->seconds();
            filePlayer.setClip (std::move (clip));
        }
    }
    {
        const juce::ScopedLock lock (trackLock);
        next.version = track.version + 1;
        track = next;
    }
    trackProgress = 1.0f;
    trackLoading = false;
}

juce::AudioProcessorEditor* BackingtrackProcessor::createEditor() { return createBackingtrackEditor (*this); }

void BackingtrackProcessor::getStateInformation (juce::MemoryBlock& destData) {
    if (auto xml = parameters.copyState().createXml())
        copyXmlToBinary (*xml, destData);
}

void BackingtrackProcessor::setStateInformation (const void* data, int sizeInBytes) {
    if (auto xml = getXmlFromBinary (data, sizeInBytes))
        parameters.replaceState (juce::ValueTree::fromXml (*xml));
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new BackingtrackProcessor(); }
