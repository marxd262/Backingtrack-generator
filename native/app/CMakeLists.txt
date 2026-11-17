# The JUCE shell: one AudioProcessor, built as a standalone app.
# Plugin formats later: add them to FORMATS (VST3; CLAP needs an extension).
juce_add_plugin(BackingtrackApp
    COMPANY_NAME "Backingtrack Generator"
    BUNDLE_ID com.backingtrackgenerator.app
    PLUGIN_MANUFACTURER_CODE Btgn
    PLUGIN_CODE Btg1
    FORMATS Standalone
    PRODUCT_NAME "Backingtrack Generator"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_WEB_BROWSER TRUE
    NEEDS_WEBVIEW2 TRUE
    NEEDS_CURL FALSE)

target_sources(BackingtrackApp PRIVATE PluginProcessor.cpp PluginEditor.cpp)

get_filename_component(BTG_REPO_ROOT "${CMAKE_SOURCE_DIR}/.." ABSOLUTE)

target_compile_definitions(BackingtrackApp
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
    PRIVATE
        BTG_WEB_ROOT="${BTG_REPO_ROOT}/src"
        BTG_WEB_SHIMS="${CMAKE_CURRENT_SOURCE_DIR}/web")
if(BTG_BEAT_MODEL)
    target_link_libraries(BackingtrackApp PRIVATE btg_beats)
    if(WIN32) # next to the program itself, which is the target JUCE derives from the plugin
        add_custom_command(TARGET BackingtrackApp_Standalone POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_if_different
            $<TARGET_FILE:btg_onnxruntime> $<TARGET_FILE_DIR:BackingtrackApp_Standalone>)
    endif()
endif()

target_link_libraries(BackingtrackApp
    PRIVATE
        btg_core
        btg_platform
        juce::juce_audio_utils
        juce::juce_gui_extra
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
