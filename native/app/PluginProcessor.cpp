#include "PluginProcessor.h"

#include <btg/analysis.h>
#ifdef BTG_BEAT_MODEL
#include <btg/beat_model.h>
#endif
#include <btg/decode.h>
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
        std::make_unique<Float>(juce::ParameterID { "bassDrive", 1 }, "Bass drive", juce::NormalisableRange<float> (0.0f, 1.0f), 0.0f),
    };
}

BackingtrackProcessor::BackingtrackProcessor()
    : AudioProcessor (BusesProperties().withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      juce::Thread ("track loader"),
      parameters (*this, nullptr, "state", createParameters()) {
    engine.setPackSource ([this] (const std::string& id) { return pack (id); });
}

std::shared_ptr<const btg::Pack> BackingtrackProcessor::pack (const std::string& id) {
    auto& held = packs[id];
    // shortcut: packs read from the repository of the build machine (BTG_WEB_ROOT); a release installs them next to the program (Task 34).
    if (held == nullptr) held = btg::loadPackFiles (BTG_WEB_ROOT "/assets/samples", id);
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
    engine.setBassDrive (bassDrive->load());
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
    loader.addJob ([this] { transport.stop(); }); // in order with the queued transport messages (PluginEditor.cpp, `queued`)
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
