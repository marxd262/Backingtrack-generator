// The app's own application class (JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP, app/CMakeLists.txt): JUCE's StandaloneFilterApp
// (juce_audio_plugin_client_Standalone.cpp) with one change, the place of its settings file (the audio device's setup, the processor's state, the
// window's place): the storage's folder (FileStorage::settingsFile), so that BTG_STORAGE_DIR moves it with everything else.
#include "Storage.h"

#include <juce_audio_utils/juce_audio_utils.h>
#include <juce_gui_extra/juce_gui_extra.h>

#if JucePlugin_Build_Standalone

#include <juce_audio_plugin_client/Standalone/juce_StandaloneFilterWindow.h>

namespace {

// shortcut: JUCE's branch for a system without a display (a holder without a window), its kiosk mode and its mobile branches are left out,
// upgrade: when the app is built for such a system or a plugin format needs them.
class App final : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override { return JucePlugin_Name; }
    const juce::String getApplicationVersion() override { return JucePlugin_VersionString; }
    bool moreThanOneInstanceAllowed() override { return true; }
    void anotherInstanceStarted (const juce::String&) override {}

    void initialise (const juce::String&) override {
        // shortcut: the old file's place is JUCE's on Windows only (macOS kept it under ~/Library/Application Support, Linux under ~/.config),
        // upgrade: when the app is built for macOS or Linux.
        const auto old = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory).getChildFile ("Backingtrack Generator/Backingtrack Generator.settings");
        const auto file = FileStorage::settingsFile (FileStorage::defaultFolder(), juce::SystemStats::getEnvironmentVariable ("BTG_STORAGE_DIR", {}).isNotEmpty(), old);
        // the holder owns the file and saves it when the window deletes it, after the window wrote its place
        auto holder = std::make_unique<juce::StandalonePluginHolder> (new juce::PropertiesFile (file, juce::PropertiesFile::Options {}), true);
        window = std::make_unique<juce::StandaloneFilterWindow> (getApplicationName(), juce::LookAndFeel::getDefaultLookAndFeel().findColour (juce::ResizableWindow::backgroundColourId),
                                                                 std::move (holder));
        window->setVisible (true);
    }

    void shutdown() override { window = nullptr; }

    void systemRequestedQuit() override {
        window->pluginHolder->savePluginState();
        if (juce::ModalComponentManager::getInstance()->cancelAllModalComponents())
            juce::Timer::callAfterDelay (100, [] { if (auto* app = juce::JUCEApplicationBase::getInstance()) app->systemRequestedQuit(); });
        else
            quit();
    }

private:
    std::unique_ptr<juce::StandaloneFilterWindow> window;
};

} // namespace

START_JUCE_APPLICATION (App)

#endif
