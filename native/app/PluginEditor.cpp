#include "PluginProcessor.h"

#include <juce_gui_extra/juce_gui_extra.h>

#include <atomic>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

#if JucePlugin_Build_Standalone
 #include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h> // the app's audio device, for the measurements
#endif

namespace {

// The app's pages (native/app/ui, which the build copies beside the program as ui/), served from disk under /app/: at the root they would lie at
// the paths the web's files had (/assets/fonts/...).
const juce::File& appRoot() {
    static const juce::File root = appFolder ("BTG_UI_DIR", "ui", BTG_APP_UI);
    return root;
}
const juce::String generatorPage = "app/index.html";
const juce::String trackPage = "app/track.html";

juce::String mimeType (const juce::File& file) {
    static const std::map<juce::String, juce::String> types {
        { ".html", "text/html" }, { ".js", "text/javascript" }, { ".css", "text/css" }, { ".woff2", "font/woff2" },
        { ".md", "text/plain; charset=utf-8" }, { ".txt", "text/plain; charset=utf-8" },
    };
    const auto found = types.find (file.getFileExtension().toLowerCase());
    return found != types.end() ? found->second : "application/octet-stream";
}

// /app/...: the pages' folder; /samples/LICENSE-...: a licence text of the packs' folder (credits.html links them). Nothing else.
std::optional<juce::WebBrowserComponent::Resource> resource (const juce::String& url) {
    const auto path = url.upToFirstOccurrenceOf ("?", false, false);
    const bool page = path.startsWith ("/app/");
    if (! page && ! path.startsWith ("/samples/LICENSE-")) return std::nullopt;
    const auto root = page ? appRoot() : BackingtrackProcessor::packsFolder();
    const auto file = root.getChildFile (path.fromFirstOccurrenceOf (page ? "/app/" : "/samples/", false, false));
    // stay inside the roots (getChildFile takes ".." and an absolute path as they are); of the packs' folder only its own files
    if (path.contains ("..") || ! file.isAChildOf (root) || (! page && file.getParentDirectory() != root)) return std::nullopt;
    juce::MemoryBlock bytes;
    if (! file.existsAsFile() || ! file.loadFileAsData (bytes)) return std::nullopt;
    const auto* begin = static_cast<const std::byte*> (bytes.getData());
    return juce::WebBrowserComponent::Resource { { begin, begin + bytes.getSize() }, mimeType (file) };
}

const juce::StringArray layerNames { "drums", "bass", "chords", "pad", "lead", "percussion" }; // order of btg::Engine::Layer

juce::String utf8 (const std::string& text) { return juce::String::fromUTF8 (text.data(), static_cast<int> (text.size())); }

// Messages that build the song (and read its packs) or start, stop or move the transport: they run on the processor's loader
// thread in the order the page sent them, so a start waits for its song's packs and a stop sent meanwhile comes after it.
// `action`, `playSession`, `sync` and `export` are the session's (native/PROTOKOLL.md section 7): `sync` and `export` answer after the actions before them.
const juce::StringArray queued { "stop", "seek", "loop", "playFile", "fileRate", "action", "playSession", "sync", "export" };

// status: btg::Engine::voiceStatus after the engine got a track or voices (and for `sync`); lanes: the session's new lanes (for `sync` the last); text: an export's file
struct Done { juce::String failed, status; std::optional<BackingtrackProcessor::Lanes> lanes; std::string text; };
using Answered = std::function<void (const BackingtrackProcessor::Answer&)>; // the session's answer, to the page at once

// Loader thread: what a queued message does.
Done control (BackingtrackProcessor& p, const juce::var& message, const Answered& answered) {
    Done done;
    const auto type = message["type"].toString();
    // An exception must not leave this job (the thread pool would end the process): every message's call is inside the try, and
    // what it says goes back as the failure (makeVoice and a convolver's constructor can throw).
    try {
        if (type == "stop") {
            if (const auto remembered = p.stopTransport()) answered (*remembered);
        } else if (type == "action" || type == "playSession") {
            const auto f = type == "action" ? p.act (message["json"].toString().toStdString(), answered) : p.playSession();
            done.failed = f.failed;
            done.status = f.status;
            done.lanes = f.lanes;
        } else if (type == "sync") { // a page that loaded or reloaded: everything it draws from, as it stands after the actions sent before
            answered (p.answerNow());
            done.lanes = p.lanesNow();
            done.status = p.engine.voiceStatus();
        } else if (type == "export") done.text = p.exportNow (message["key"].toString().toStdString(), message["name"].toString().toStdString());
        else if (type == "seek") p.transport.seek ((double) message["beats"]);
        else if (type == "loop") p.transport.setLoop ((double) message["start"], (double) message["end"]);
        else if (type == "playFile") {
            p.playsFile = true; // the page sets and clears the loop itself
            p.sessionPlays = false;
            if (message.hasProperty ("rate")) p.fileRate = juce::jlimit (0.25, 2.0, (double) message["rate"]);
            p.transport.play ((double) message["from"], 60.0 * p.fileRate); // one beat = one second of the track
        } else if (type == "fileRate") { // speed of the loaded track, 1 = as recorded
            p.fileRate = juce::jlimit (0.25, 2.0, (double) message["rate"]);
            if (p.playsFile) p.transport.setTempo (60.0 * p.fileRate);
        }
    } catch (const std::exception& e) {
        done.failed = e.what();
    }
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
            leave();
            shows (! ownTrack);
            browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot() + (ownTrack ? trackPage : generatorPage));
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
        browser.goToURL (juce::WebBrowserComponent::getResourceProviderRoot() + generatorPage);
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

    // The page that shows is left: its sound stops, in order with the queued transport messages.
    void leave() {
        processor.loader.addJob ([&p = processor] { p.stopTransport(); });
        lastKey.clear(); // a job between two steps of one knob: neither is dropped
    }

    // Which page shows: the button leads to the other one.
    void shows (bool track) {
        ownTrack = track;
        page.setButtonText (track ? "Generator" : text ("Eigener Track", "Own track"));
    }

    // UI -> engine. Messages come from the pages' door native/app/ui/session.js (native/PROTOKOLL.md section 7).
    void handle (const juce::var& message) {
        const auto type = message["type"].toString();
        if (type == "sync" && (bool) message["track"] != ownTrack) { // another page than the one that showed loaded: the browser went there itself (back, forward)
            leave();
            shows (! ownTrack);
        }
        if (queued.contains (type)) {
            auto& p = processor;
            // An action whose next queued message is a newer action of the same Session::replaceKey (one knob's steps) is dropped when its job starts:
            // the newer one replaces its effect whole (PROTOKOLL.md section 7), it gets no answer of its own. Any other message between keeps it.
            // Only the actions named here can have a key: any other text (an import of megabytes) is not parsed on the message thread.
            const auto json = type == "action" ? message["json"].toString() : juce::String();
            const bool keyed = json.contains ("\"setTimbre\"") || json.contains ("\"setRhythmKnob\"") || json.contains ("\"editPart\"");
            const auto key = keyed ? btg::Session::replaceKey (json.toStdString()) : std::string();
            if (! key.empty() && key == lastKey) lastDropped->store (true);
            const auto dropped = key.empty() ? nullptr : std::make_shared<std::atomic<bool>> (false);
            lastKey = key;
            lastDropped = dropped;
            p.loader.addJob ([&p, message, dropped, editor = juce::Component::SafePointer<Editor> (this)] {
                const Answered answered = [editor, seq = message["seq"]] (const BackingtrackProcessor::Answer& a) {
                    juce::MessageManager::callAsync ([editor, a, seq] { if (editor != nullptr) editor->answer (a, seq); });
                };
                const Done result = dropped != nullptr && dropped->load() ? Done {} : control (p, message, answered);
                p.controlArrived();
                juce::MessageManager::callAsync ([editor, message, result] { if (editor != nullptr) editor->done (message, result); });
            });
            return;
        }
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
        if (type == "chordDisplays" || type == "trackView") { // the own songs' page (PROTOKOLL.md section 7): answered here at once, they read no session and change nothing
            const bool view = type == "trackView";
            const std::string request = message["json"].toString().toStdString();
            auto* reply = new juce::DynamicObject();
            reply->setProperty ("seq", message["seq"]);
            reply->setProperty ("json", utf8 (view ? btg::trackView (request) : btg::chordDisplays (request)));
            emit (view ? "trackView" : "chordDisplays", juce::var (reply));
            return;
        }
        if (type == "openFile") {
            chooser = std::make_unique<juce::FileChooser> (text ("Track laden", "Load track"), juce::File(), "*.wav;*.flac;*.mp3;*.m4a;*.aac;*.ogg;*.aiff;*.aif;*.wma;*.mp4;*.m4v;*.mov;*.mkv;*.webm");
            chooser->launchAsync (juce::FileBrowserComponent::openMode | juce::FileBrowserComponent::canSelectFiles, [this] (const juce::FileChooser& c) {
                if (! c.getResult().existsAsFile()) return;
                lastKey.clear(); // loadTrack queues a stop job
                processor.loadTrack (c.getResult());
            });
        } else if (type == "loadFile") { // the same without the dialog, for the automatic check
            lastKey.clear();
            processor.loadTrack (juce::File (message["path"].toString()));
        } else if (type == "language") { // a page says which language it shows (it remembers the choice)
            english = message["lang"].toString() == "en";
            language.setSelectedId (english ? 2 : 1, juce::dontSendNotification);
            shows (ownTrack);
        } else if (type == "hello") {
            sentTrack = -1; // a page that just opened gets the analysis of the loaded track again
        } else if (type == "buffer") { // measurement only: another buffer size of the audio device
            if (auto* devices = deviceManager()) {
                auto setup = devices->getAudioDeviceSetup();
                setup.bufferSize = (int) message["frames"];
                devices->setAudioDeviceSetup (setup, true);
            }
        }
        processor.controlArrived();
    }

    // An event as emitEventIfBrowserIsVisible sends it (emitByBackend with the payload's JSON in a quoted literal), escaped in one pass: JUCE's
    // escapes with String::replace, which copies the whole text once per backslash, and the session's texts travel as strings, a quote escaped in
    // each key and value (the lanes' 1 MB has about 200 000: minutes on the message thread; a profile view of 1,000 nodes, 170 KB: seconds).
    void emit (const char* event, const juce::var& object) {
        if (! browser.isVisible()) return;
        const std::string json = juce::JSON::toString (object, true).toStdString();
        std::string script = std::string ("window.__JUCE__.backend.emitByBackend(\"") + event + "\", '";
        script.reserve (script.size() + json.size() + json.size() / 4 + 3);
        for (const char ch : json) {
            if (ch == '\\') script += "\\\\";
            else if (ch == '\'') script += "\\'";
            else script += ch;
        }
        script += "');";
        browser.evaluateJavascript (utf8 (script));
    }

    void emitText (const char* event, const std::string& text) {
        auto* object = new juce::DynamicObject();
        object->setProperty ("json", utf8 (text));
        emit (event, juce::var (object));
    }

    // Message thread: the session's answer (PROTOKOLL.md section 7): `tables` with the answer to `sync`, `derived` when its text changed, `state`
    // (with the `seq` of the action it answers), then `profiles` when its text came with it.
    void answer (const BackingtrackProcessor::Answer& a, const juce::var& seq) {
        if (! a.tables.empty()) {
            emitText ("tables", a.tables);
            sentDerived.clear(); // a page that synced has no derived yet
        }
        if (! a.derived.empty() && a.derived != sentDerived) {
            sentDerived = a.derived;
            emitText ("derived", a.derived);
        }
        auto* state = new juce::DynamicObject();
        state->setProperty ("json", utf8 (a.state));
        if (a.change) {
            auto* change = new juce::DynamicObject();
            const auto& c = *a.change;
            for (const auto& [name, on] : { std::pair { "events", c.events }, { "sound", c.sound }, { "voices", c.voices }, { "tempo", c.tempo }, { "mix", c.mix },
                                            { "restart", c.restart }, { "inPlace", c.inPlace }, { "profiles", c.profiles } })
                change->setProperty (name, on);
            state->setProperty ("change", juce::var (change));
        }
        state->setProperty ("events", a.events);
        if (! seq.isVoid()) state->setProperty ("seq", seq);
        emit ("state", juce::var (state));
        if (! a.profiles.empty()) emitText ("profiles", a.profiles);
    }
    void emitLanes (const BackingtrackProcessor::Lanes& lanes) {
        auto* events = new juce::DynamicObject();
        events->setProperty ("number", lanes.number);
        events->setProperty ("bpm", lanes.bpm);
        events->setProperty ("beats", lanes.beats);
        events->setProperty ("json", utf8 (lanes.json));
        emit ("events", juce::var (events));
    }

    // Message thread: a queued message has run on the loader thread.
    void done (const juce::var& message, const Done& r) {
        const auto type = message["type"].toString();
        if (type == "sync") { // after its `state` and `profiles` (answered): the last lanes, the voices' state, and the position at the next tick
            if (r.lanes) emitLanes (*r.lanes);
            browser.emitEventIfBrowserIsVisible ("voices", juce::JSON::parse (r.status));
            sentPosition.clear();
            return;
        }
        if (type == "export") {
            auto* file = new juce::DynamicObject();
            file->setProperty ("key", message["key"]);
            file->setProperty ("name", message["name"]);
            file->setProperty ("json", utf8 (r.text));
            emit ("export", juce::var (file));
            return;
        }
        if (r.failed.isNotEmpty()) error = r.failed; // a failed message of any type shows in the strip (the engine's next track or voices sets it anew)
        if (type == "playSession" && message.hasProperty ("seq")) run = (int) message["seq"]; // the first report of this run tells the page whether its start plays
        if (r.lanes) emitLanes (*r.lanes);
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
        // what the displays show at the session song's place (PROTOKOLL.md section 7), when its text changed; never waiting for the session's lock
        const double at = processor.sessionPlays && processor.transport.playing() ? processor.transport.beats() : 0.0;
        if (const auto place = processor.positionNow (at); place && ! place->empty() && *place != sentPosition) {
            sentPosition = *place;
            auto* position = new juce::DynamicObject();
            position->setProperty ("json", utf8 (sentPosition));
            emit ("position", juce::var (position));
        }
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
    int run = 0; // the seq of the page's last playSession: which start the engine's reports belong to
    int ticks = 0;
    juce::String error;
    bool hasWindowButtons = false;
    // Diagnosis: BTG_POSITION_LOG=<file> in the environment makes the track page compare the position it shows
    // with the engine's twice a second and write the result there.
    const juce::String positionLog = juce::SystemStats::getEnvironmentVariable ("BTG_POSITION_LOG", {});
    int sentTrack = 0;     // version of the track analysis the page has
    std::string sentPosition; // the session's position text the page has
    std::string sentDerived;  // the session's derived text the page has
    // the replaceKey of the last queued message (empty: no action of a key) and the flag that drops its job
    std::string lastKey;
    std::shared_ptr<std::atomic<bool>> lastDropped;
    bool ownTrack = false; // which page shows: the generator's UI or the page for a loaded track
    bool english = false;  // the language of the app, as the page that shows last said or the strip chose
    std::unique_ptr<juce::FileChooser> chooser;
    juce::TextButton page { "Eigener Track" };
    juce::ComboBox language;
    juce::Label status;
    juce::WebBrowserComponent browser { juce::WebBrowserComponent::Options()
        .withBackend (juce::WebBrowserComponent::Options::Backend::webview2)
        // the browser's profile (the pages' localStorage) beside the session's files: a check's BTG_STORAGE_DIR moves it too
        .withWinWebView2Options (juce::WebBrowserComponent::Options::WinWebView2().withUserDataFolder (FileStorage::defaultFolder().getChildFile ("WebView2")))
        .withNativeIntegrationEnabled()
        // a minimised window keeps its page: JUCE's default blanks it (about:blank) and goes back on restore, a new load that lost what the page
        // showed (its page, an open window) while the engine played on
        .withKeepPageLoadedWhenBrowserIsHidden()
        .withResourceProvider ([this] (const juce::String& url) { return url.startsWith ("/media/video") ? video() : resource (url); })
        .withEventListener ("btg", [this] (const juce::var& message) { handle (message); }) };
};

} // namespace

juce::AudioProcessorEditor* createBackingtrackEditor (BackingtrackProcessor& p) { return new Editor (p); }
