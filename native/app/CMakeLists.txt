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

target_sources(BackingtrackApp PRIVATE PluginProcessor.cpp PluginEditor.cpp Storage.cpp StandaloneApp.cpp)

get_filename_component(BTG_REPO_ROOT "${CMAKE_SOURCE_DIR}/.." ABSOLUTE)

target_compile_definitions(BackingtrackApp
    PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1
        JUCE_USE_CURL=0
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_USE_CUSTOM_PLUGIN_STANDALONE_APP=1 # StandaloneApp.cpp: its settings file in the storage's folder
    PRIVATE
        # the repository's packs (under src/assets/samples) and pages: where appFolder (PluginProcessor.cpp) looks last, while developing
        BTG_WEB_ROOT="${BTG_REPO_ROOT}/src"
        BTG_APP_UI="${CMAKE_CURRENT_SOURCE_DIR}/ui")

# What the app reads at run time, beside the program at every build (a custom target is never up to date): the pages anew, so that a file removed
# from native/app/ui goes; the packs (66 MB) and the beat model only where they differ.
set(btg_app_dir $<TARGET_FILE_DIR:BackingtrackApp_Standalone>)
set(btg_model ${CMAKE_SOURCE_DIR}/models/beat_this.onnx) # native/tools/get-models.mjs, which native/build.ps1 runs before it configures
if(BTG_BEAT_MODEL AND EXISTS ${btg_model})
    set(btg_copy_model COMMAND ${CMAKE_COMMAND} -E copy_if_different ${btg_model} ${btg_app_dir}/models/beat_this.onnx)
endif()
add_custom_target(btg_app_files ALL
    COMMAND ${CMAKE_COMMAND} -E rm -rf ${btg_app_dir}/ui
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${CMAKE_CURRENT_SOURCE_DIR}/ui ${btg_app_dir}/ui
    COMMAND ${CMAKE_COMMAND} -E copy_directory_if_different ${BTG_REPO_ROOT}/src/assets/samples ${btg_app_dir}/samples
    ${btg_copy_model}
    VERBATIM)
add_dependencies(btg_app_files BackingtrackApp_Standalone)
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

# The app's storage on its own (Storage.h): the rules of read and write and the abort test of Review Focus 3, which starts this program again.
juce_add_console_app(btg_storage_tests PRODUCT_NAME "btg_storage_tests")
target_sources(btg_storage_tests PRIVATE StorageTests.cpp Storage.cpp)
target_compile_definitions(btg_storage_tests PRIVATE JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(btg_storage_tests
    PRIVATE
        btg_core
        juce::juce_core
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
add_test(NAME storage COMMAND btg_storage_tests)

# The app's pages (native/app/ui) load nothing from outside their folder (native/tools/ui-imports.mjs).
if(NODE)
    add_test(NAME ui_imports COMMAND ${NODE} ${CMAKE_SOURCE_DIR}/tools/ui-imports.mjs)
endif()
