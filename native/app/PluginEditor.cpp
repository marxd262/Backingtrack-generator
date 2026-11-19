#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

#include <limits>

#if JucePlugin_Build_Standalone
 #include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h> // the app's audio device, for the measurements
#endif

namespace {

// The web UI is served from disk: the repo's src/ plus replacements from native/app/web.
// shortcut: absolute build-machine paths, works only where it was built; a release embeds or installs these files.
const juce::File webRoot { BTG_WEB_ROOT };
const juce::File shimRoot { BTG_WEB_SHIMS };

// Files of the web app that the app replaces: the engine is the player, and it owns the samples.
const juce::StringArray shims { "/audio/play.js", "/audio/load-voices.js", "/audio/voices/sampler.js" };

juce::String mimeType (const juce::File& file) {
    static const std::map<juce::String, juce::String> types {
        { ".html", "text/html" }, { ".js", "text/javascript" }, { ".mjs", "text/javascript" }, { ".css", "text/css" },
        { ".json", "application/json" }, { ".svg", "image/svg+xml" }, { ".png", "image/png" }, { ".flac", "audio/flac" },
    };
    const auto found = types.find (file.getFileExtension().toLowerCase());
    return found != types.end() ? found->second : "application/octet-stream";
}

std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& url) {
    const auto path = url.upToFirstOccurrenceOf ("?", false, false);
    if (path.contains ("..")) return std::nullopt; // stay inside the two roots
    // /native/...: pages of the app itself (native/app/web)
    const auto file = shims.contains (path) ? shimRoot.getChildFile (path.fromLastOccurrenceOf ("/", false, false))
                    : path.startsWith ("/native/") ? shimRoot.getChildFile (path.fromFirstOccurrenceOf ("/native/", false, false))
                                                   : webRoot.getChildFile (path.trimCharactersAtStart ("/"));
    juce::MemoryBlock bytes;
    if (! file.existsAsFile() || ! file.loadFileAsData (bytes)) return std::nullopt;
    const auto* begin = static_cast<const std::byte*> (bytes.getData());
    return juce::WebBrowserComponent::Resource { { begin, begin + bytes.getSize() }, mimeType (file) };
}

const juce::StringArray layerNames { "drums", "bass", "chords", "pad", "lead", "percussion" }; // order of btg::Engine::Layer

// Messages that build the song (and read its packs) or start, stop or move the transport: they run on the processor's loader
// thread in the order the page sent them, so a play waits for its track's packs and a stop sent meanwhile comes after it.
const juce::StringArray queued { "track", "voices", "tuning", "timbre", "pack", "play", "stop", "tempo", "seek", "loop", "playFile", "fileRate" };

struct Done { juce::String failed, status; double ms = 0.0; }; // status: btg::Engine::voiceStatus after a track or voices

// Loader thread: what a queued message does.
Done control (BackingtrackProcessor& p, const juce::var& message) {
    Done done;
    const auto started = juce::Time::getMillisecondCounterHiRes();
    const auto type = message["type"].toString();
    // An exception must not leave this job (the thread pool would end the process): every message's call is inside the try, and
    // what it says goes back as the failure (makeVoice and a convolver's constructor can throw, in tuning and timbre as in track and pack).
    try {
        if (type == "track") p.engine.setTrack (message["json"].toString().toStdString());
        else if (type == "voices") p.engine.setVoices (message["json"].toString().toStdString());
        else if (type == "tuning") p.engine.setTuning (message["json"].toString().toStdString());
        else if (type == "timbre") p.engine.setSound (message["json"].toString().toStdString());
        else if (type == "pack") p.pack (message["id"].toString().toStdString());
        else if (type == "play") {
            p.playsFile = false;
            p.transport.setLoop (0.0, 0.0);
            // shortcut: every start of the generator is delayed by the web app's 0.15 s (play.js LEAD), during which the clock stands and the
            // sum's compressors settle on silence; starting at once would need the chain's state aged by that time instead (a loaded file has none).
            p.transport.play ((double) message["startBeats"], (double) message["bpm"], 0.15);
        } else if (type == "stop") p.transport.stop();
        else if (type == "tempo") p.transport.setTempo ((double) message["bpm"]);
        else if (type == "seek") p.transport.seek ((double) message["beats"]);
        else if (type == "loop") p.transport.setLoop ((double) message["start"], (double) message["end"]);
        else if (type == "playFile") {
            p.playsFile = true; // the page sets and clears the loop itself
            if (message.hasProperty ("rate")) p.fileRate = juce::jlimit (0.25, 2.0, (double) message["rate"]);
            p.transport.play ((double) message["from"], 60.0 * p.fileRate); // one beat = one second of the track
        } else if (type == "fileRate") { // speed of the loaded track, 1 = as recorded
            p.fileRate = juce::jlimit (0.25, 2.0, (double) message["rate"]);
            if (p.playsFile) p.transport.setTempo (60.0 * p.fileRate);
        }
    } catch (const std::exception& e) {
        done.failed = e.what();
    }
    if (type == "track" || type == "voices") done.status = p.engine.voiceStatus(); // also after a failure: which voices are there
    done.ms = juce::Time::getMillisecondCounterHiRes() - started;
    return done;
}

juce::AudioDeviceManager* deviceManager() {
   #if JucePlugin_Build_Standalone
    if (auto* holder = juce::StandalonePluginHolder::getInstance()) return &holder->deviceManager;
   #endif
    return nullptr;
}

class Editor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
    explicit Editor (BackingtrackProcessor& p) : AudioProcessorEditor (p), processor (p) {
        // The strip: what holds for every page (which page, the language) and the measurements.
        addAndMakeVisible (page);
        page.onClick = [this] {
            processor.loader.addJob ([&p = processor] { p.transport.stop(); }); // in order with the queued transport messages
            shows (! ownTrack);
            browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot() + (ownTrack ? "native/track.html" : "ui/index.html"));
        };
        addAndMakeVisible (language);
        language.addItem ("Deutsch", 1);
        language.addItem ("English", 2);
        language.setSelectedId (1, juce::dontSendNotification);
        language.setTitle ("Sprache / Language");
        language.onChange = [this] { // the page that shows switches and remembers the choice for the other one
            english = language.getSelectedId() == 2;
            shows (ownTrack);
            browser.emitEventIfBrowserIsVisible ("language", juce::var (english ? "en" : "de"));
        };
        addAndMakeVisible (status);
        status.setFont (juce::FontOptions (13.0f));

        addAndMakeVisible (browser);
        setResizable (true, true);
        setSize (1440, 930);
        browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot() + "ui/index.html");
        startTimerHz (30);
    }

    void resized() override {
        auto area = getLocalBounds();
        auto strip = area.removeFromTop (30).reduced (4, 3);
        page.setBounds (strip.removeFromLeft (110));
        language.setBounds (strip.removeFromLeft (104).withTrimmedLeft (4));
        status.setBounds (strip.withTrimmedLeft (10));
        browser.setBounds (area);
    }

private:
    // The strip's own texts in the language chosen.
    juce::String text (const char* german, const char* inEnglish) const { return juce::String::fromUTF8 (english ? inEnglish : german); }

    // Which page shows: the button leads to the other one.
    void shows (bool track) {
        ownTrack = track;
        page.setButtonText (track ? "Generator" : text ("Eigener Track", "Own track"));
    }

    // UI -> engine. Messages come from native/app/web/play.js.
    void handle (const juce::var& message) {
        const auto type = message["type"].toString();
        if (queued.contains (type)) {
            auto& p = processor;
            p.loader.addJob ([&p, message, editor = juce::Component::SafePointer<Editor> (this)] {
                const Done result = control (p, message);
                p.controlArrived();
                juce::MessageManager::callAsync ([editor, message, result] { if (editor != nullptr) editor->done (message, result); });
            });
            return;
        }
        const int layer = layerNames.indexOf (message["layer"].toString());
        const auto value = juce::jlimit (-1.0f, 1.0f, (float) message["value"]);
        const auto setParameter = [this] (const char* id, float v) {
            if (auto* parameter = processor.parameters.getParameter (id)) parameter->setValueNotifyingHost (juce::jlimit (0.0f, 1.0f, v));
        };
        if (type == "ping") { // measures the way UI -> app and back
            if (positionLog.isNotEmpty()) { // diagnosis: the reply carries the engine's position
                auto* reply = new juce::DynamicObject();
                reply->setProperty ("id", message["id"]);
                reply->setProperty ("beats", processor.transport.beats());
                browser.emitEventIfBrowserIsVisible ("pong", juce::var (reply));
                return;
            }
            browser.emitEventIfBrowserIsVisible ("pong", message);
            return;
        }
        if (type == "positionLog") {
            if (positionLog.isNotEmpty()) juce::File (positionLog).appendText (message["line"].toString() + "\n");
            return;
        }
        if (type == "openFile") {
            chooser = std::make_unique<juce::FileChooser> (text ("Track laden", "Load track"), juce::File(), "*.wav;*.flac;*.mp3;*.m4a;*.aac;*.ogg;*.aiff;*.aif;*.wma;*.mp4;*.m4v;*.mov;*.mkv;*.webm");
            chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& c) {
                if (c.getResult().existsAsFile()) processor.loadTrack (c.getResult());
            });
        } else if (type == "loadFile") { // the same without the dialog, for the automatic check
            processor.loadTrack (juce::File (message["path"].toString()));
        } else if (type == "language") { // a page says which language it shows (it remembers the choice)
            english = message["lang"].toString() == "en";
            language.setSelectedId (english ? 2 : 1, juce::dontSendNotification);
            shows (ownTrack);
        } else if (type == "page") { // a page says it is leaving for the other one
            shows ((bool) message["track"]);
        } else if (type == "hello") {
            shows (true);
            sentTrack = -1; // a page that just opened gets the analysis of the loaded track again
        } else if (type == "master") setParameter ("master", value);
        else if (type == "drive") setParameter ("bassDrive", value);
        else if (type == "level" && layer >= 0) processor.engine.setLevel (static_cast<btg::Engine::Layer> (layer), value);
        else if (type == "mute" && layer >= 0) processor.engine.setMuted (static_cast<btg::Engine::Layer> (layer), (bool) message["on"]);
        else if (type == "pan" && layer >= 0) // null: the place mix/pan gives the layer
            processor.engine.setPan (static_cast<btg::Engine::Layer> (layer), message["value"].isVoid() || message["value"].isUndefined() ? std::numeric_limits<float>::quiet_NaN() : value);
        else if (type == "buffer") { // measurement only: another buffer size of the audio device
            if (auto* devices = deviceManager()) {
                auto setup = devices->getAudioDeviceSetup();
                setup.bufferSize = (int) message["frames"];
                devices->setAudioDeviceSetup (setup, true);
            }
        }
        processor.controlArrived();
    }

    // Message thread: a queued message has run on the loader thread.
    void done (const juce::var& message, const Done& r) {
        const auto type = message["type"].toString();
        if (type == "pack") { // for native/app/web/sampler.js: error "" = ready
            auto* reply = new juce::DynamicObject();
            reply->setProperty ("id", message["id"]);
            reply->setProperty ("error", r.failed);
            browser.emitEventIfBrowserIsVisible ("pack", juce::var (reply));
            return;
        }
        if (type == "play") run = (int) message["run"];
        if (type == "track") buildMs = r.ms;
        if (r.status.isEmpty()) return;
        const auto voices = juce::JSON::parse (r.status);
        browser.emitEventIfBrowserIsVisible ("voices", voices);
        error = r.failed;
        for (const auto& layer : layerNames) {
            const auto state = voices[juce::Identifier (layer)].toString();
            if (error.isEmpty() && state.startsWith ("error: ")) error = layer + ": " + state.fromFirstOccurrenceOf ("error: ", false, false);
        }
    }

    // Engine -> UI: position, levels and measurements, 30 times a second; the UI interpolates the position in between.
    void timerCallback() override {
        // The window of JUCE's standalone shell comes without a maximise button; ask for all three. Only once the
        // window is up: asked for earlier (when the editor is put in), the window takes its size before the editor
        // has one and opens tiny.
        if (! hasWindowButtons) {
            if (auto* window = dynamic_cast<juce::DocumentWindow*> (getTopLevelComponent()); window != nullptr && window->isShowing()) {
                window->setTitleBarButtonsRequired (juce::DocumentWindow::allButtons, false);
                hasWindowButtons = true;
            }
        }
        auto* state = new juce::DynamicObject();
        state->setProperty ("run", run);
        state->setProperty ("playing", processor.transport.playing());
        state->setProperty ("standing", processor.transport.standing()); // the lead: playing, but the clock stands (the page must not run on)
        state->setProperty ("beats", processor.transport.beats());
        state->setProperty ("bpm", processor.transport.bpm());
        auto* peaks = new juce::DynamicObject();
        for (int l = 0; l < layerNames.size(); ++l) peaks->setProperty (juce::Identifier (layerNames[l]), processor.engine.takePeak (l));
        peaks->setProperty ("master", processor.engine.takePeak (btg::Engine::layerCount));
        state->setProperty ("peaks", juce::var (peaks));
        state->setProperty ("error", error);
        state->setProperty ("reactionMs", processor.reactionMs.load());
        state->setProperty ("buildMs", buildMs);
        state->setProperty ("load", processor.load.load());
        if (positionLog.isNotEmpty()) state->setProperty ("positionLog", true);
        juce::String device = text ("kein Audiogerät", "no audio device");
        if (auto* devices = deviceManager()) {
            if (auto* d = devices->getCurrentAudioDevice()) {
                const double rate = d->getCurrentSampleRate(), latency = 1000.0 * d->getOutputLatencyInSamples() / rate;
                state->setProperty ("device", d->getName());
                state->setProperty ("deviceType", d->getTypeName());
                state->setProperty ("bufferFrames", d->getCurrentBufferSizeSamples());
                state->setProperty ("sampleRate", rate);
                state->setProperty ("outputLatencyMs", latency);
                state->setProperty ("xruns", devices->getXRunCount());
                juce::Array<juce::var> sizes;
                for (const int size : d->getAvailableBufferSizes()) sizes.add (size);
                state->setProperty ("bufferSizes", sizes);
                device = juce::String (d->getCurrentBufferSizeSamples()) + text (" Frames bei ", " frames at ") + juce::String (rate / 1000.0, 1) + " kHz  |  "
                       + text ("Ausgabelatenz ", "Output latency ") + juce::String (latency, 1) + " ms  |  " + text ("Aussetzer ", "Dropouts ") + juce::String (devices->getXRunCount());
            }
        }
        const auto track = processor.trackState();
        auto* file = new juce::DynamicObject();
        file->setProperty ("loading", processor.trackLoading.load());
        file->setProperty ("progress", processor.trackProgress.load());
        file->setProperty ("name", track.name);
        file->setProperty ("error", track.error);
        state->setProperty ("file", juce::var (file));
        browser.emitEventIfBrowserIsVisible ("engine", juce::var (state));
        if (track.version != sentTrack && track.analysis.isNotEmpty()) {
            auto* result = new juce::DynamicObject();
            result->setProperty ("name", track.name);
            result->setProperty ("seconds", track.seconds);
            result->setProperty ("json", track.analysis);
            result->setProperty ("peaks", track.peaks);
            result->setProperty ("peakRate", 100);
            result->setProperty ("loadMs", track.loadMs);
            result->setProperty ("analysisMs", track.analysisMs);
            result->setProperty ("video", track.video.isNotEmpty());
            result->setProperty ("version", track.version);
            browser.emitEventIfBrowserIsVisible ("analysis", juce::var (result));
        }
        sentTrack = track.version;

        if (++ticks % 8 == 0) {
            const double beats = processor.transport.beats();
            const auto place = processor.playsFile ? text ("Sekunde ", "Second ") + juce::String (beats, 1)
                                                   : text ("Takt ", "Bar ") + juce::String (1 + (int) std::floor (beats / processor.engine.beatsPerBar()));
            status.setText (error.isNotEmpty() ? text ("Fehler: ", "Error: ") + error
                                               : place + "  |  " + device + "  |  " + text ("Reaktion ", "Response ") + juce::String (processor.reactionMs.load(), 1)
                                                     + " ms  |  " + text ("Last ", "Load ") + juce::String (100.0f * processor.load.load(), 1) + " %",
                            juce::dontSendNotification);
        }
    }

    // The loaded video file itself, for the page's <video>: it shows the picture, muted; the sound stays with the engine.
    // shortcut: the whole file goes through memory in one answer; serve ranges when files over 1 GB matter.
    std::optional<juce::WebBrowserComponent::Resource> video() const {
        static const std::map<juce::String, juce::String> types {
            { ".mp4", "video/mp4" }, { ".m4v", "video/mp4" }, { ".mov", "video/quicktime" }, { ".webm", "video/webm" },
            { ".mkv", "video/x-matroska" }, { ".avi", "video/x-msvideo" }, { ".wmv", "video/x-ms-wmv" },
        };
        const juce::File file (processor.trackState().video);
        const auto type = types.find (file.getFileExtension().toLowerCase());
        juce::MemoryBlock bytes;
        if (type == types.end() || ! file.existsAsFile() || file.getSize() > (juce::int64) 1 << 30 || ! file.loadFileAsData (bytes)) return std::nullopt;
        const auto* begin = static_cast<const std::byte*> (bytes.getData());
        return juce::WebBrowserComponent::Resource { { begin, begin + bytes.getSize() }, type->second };
    }

    BackingtrackProcessor& processor;
    int run = 0; // which play() the position belongs to
    int ticks = 0;
    double buildMs = 0.0; // time the last track took to become events
    juce::String error;
    bool hasWindowButtons = false;
    // Diagnosis: BTG_POSITION_LOG=<file> in the environment makes the track page compare the position it shows
    // with the engine's twice a second and write the result there.
    const juce::String positionLog = juce::SystemStats::getEnvironmentVariable ("BTG_POSITION_LOG", {});
    int sentTrack = 0;     // version of the track analysis the page has
    bool ownTrack = false; // which page shows: the generator's UI or the page for a loaded track
    bool english = false;  // the language of the app, as the page that shows last said or the strip chose
    std::unique_ptr<juce::FileChooser> chooser;
    juce::TextButton page { "Eigener Track" };
    juce::ComboBox language;
    juce::Label status;
    juce::WebBrowserComponent browser { juce::WebBrowserComponent::Options()
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2().withUserDataFolder (
            juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("BackingtrackGenerator/WebView2")))
        .withNativeIntegrationEnabled()
        .withResourceProvider ([this] (const juce::String& url) { return url.startsWith ("/media/video") ? video() : resource (url); })
        .withEventListener ("btg", [this] (const juce::var& message) { handle (message); }) };
};

} // namespace

juce::AudioProcessorEditor* createBackingtrackEditor (BackingtrackProcessor& p) { return new Editor (p); }
