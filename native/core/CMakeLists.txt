# The core: generator, sampler and engine, analysis. No JUCE, no platform code.
include(FetchContent)
set(JSON_BuildTests OFF CACHE INTERNAL "")
FetchContent_Declare(json
    URL https://github.com/nlohmann/json/releases/download/v3.12.0/json.tar.xz
    URL_HASH SHA256=42f6e95cad6ec532fd372391373363b62a14af6d771056dbfc86160e6dfff7aa
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(json)

# Time stretching for loaded tracks (another speed at the same pitch): header-only, MIT, pinned.
# Declared in this order: signalsmith-stretch looks for the target signalsmith-linear and fetches it itself otherwise.
FetchContent_Declare(signalsmith-linear
    URL https://github.com/Signalsmith-Audio/linear/archive/refs/tags/0.6.6.tar.gz
    URL_HASH SHA256=e6d6a914189894fd728111b2a3209445ecd065aa9a5c1958f41b64ac3cef8b32
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_Declare(signalsmith-stretch
    URL https://github.com/Signalsmith-Audio/signalsmith-stretch/archive/88061fd4eda56a2353c5d65c74aa3f4ccf76f9da.tar.gz
    URL_HASH SHA256=4dc468e46f208415ca66567cacfd8fb22b01d321fcdb4c2452278fee2426b09d
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
FetchContent_MakeAvailable(signalsmith-linear signalsmith-stretch)

# FLAC decoder for the sample packs: one header, pinned to a commit.
set(dr_libs_dir ${CMAKE_BINARY_DIR}/dr_libs)
set(dr_libs_url https://raw.githubusercontent.com/mackron/dr_libs/c2d31fed078120f67263fd36237c0dcaae6bc07b)
file(DOWNLOAD ${dr_libs_url}/dr_flac.h ${dr_libs_dir}/dr_flac.h EXPECTED_HASH SHA256=bd569c910a7c465e481fd50af84e2871e81e2154e30ac510d98f953cc0d5a546)
# MP3 and WAV for loaded tracks (src/decode.cpp): the app and the analysis tool decode the same way
file(DOWNLOAD ${dr_libs_url}/dr_mp3.h ${dr_libs_dir}/dr_mp3.h EXPECTED_HASH SHA256=0bf9ae11a1cae49283ad80143de77358aff4f74cdf42d49effc5ae115f5f11cf)
file(DOWNLOAD ${dr_libs_url}/dr_wav.h ${dr_libs_dir}/dr_wav.h EXPECTED_HASH SHA256=7c9660d75361ad6175e6217c63a1075c9512445c06bc951197fc479179f76b39)

# The data of the web app (native/tools/export-events.mjs --data) as bytes in the library.
# A byte array, not a string literal: MSVC caps string literals at 16 KB.
foreach(data grooves sound)
    set(data_file ${CMAKE_CURRENT_SOURCE_DIR}/data/${data}.json)
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${data_file})
    file(READ ${data_file} data_hex HEX)
    string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," data_bytes "${data_hex}")
    file(CONFIGURE OUTPUT ${data}_bytes.cpp CONTENT
"extern const unsigned char btg_${data}_json[] = {${data_bytes}};
extern const unsigned int btg_${data}_json_size = sizeof(btg_${data}_json);
" @ONLY)
endforeach()

add_library(btg_core STATIC
    src/generator.cpp
    src/articulation.cpp
    src/articulation_harmony.cpp
    src/organ.cpp
    src/lead.cpp
    src/percussion.cpp
    src/pack.cpp
    src/engine.cpp
    src/sampler.cpp
    src/sound_model.cpp
    src/convolver.cpp
    src/compressor.cpp
    src/guitar_fx.cpp
    src/mod_fx.cpp
    src/osc.cpp
    src/param.cpp
    src/patch.cpp
    src/voices/epiano.cpp
    src/analysis.cpp
    src/file_player.cpp
    src/decode.cpp
    src/dr_flac_impl.cpp
    src/sound_data.cpp
    ${CMAKE_CURRENT_BINARY_DIR}/grooves_bytes.cpp
    ${CMAKE_CURRENT_BINARY_DIR}/sound_bytes.cpp)
target_include_directories(btg_core PUBLIC include PRIVATE ${dr_libs_dir})
target_link_libraries(btg_core PRIVATE nlohmann_json::nlohmann_json signalsmith-stretch)
# For measuring only: the numbers of the analysis can then be set through the environment (native/tools/analysis-sweep.ps1).
option(BTG_TUNING "Let the environment set the numbers of the analysis (for measuring)" OFF)
if(BTG_TUNING)
    target_compile_definitions(btg_core PRIVATE BTG_TUNING)
endif()
if(MSVC)
    target_compile_options(btg_core PRIVATE /W4 /fp:precise)
    set_source_files_properties(src/dr_flac_impl.cpp PROPERTIES COMPILE_OPTIONS /W0)
    set_source_files_properties(src/file_player.cpp PROPERTIES COMPILE_OPTIONS "/bigobj;/W3") # the stretcher is template-heavy and not /W4 clean
else()
    # no fused multiply-add: the generator must round like the web app
    target_compile_options(btg_core PRIVATE -Wall -Wextra -ffp-contract=off)
    set_source_files_properties(src/dr_flac_impl.cpp PROPERTIES COMPILE_OPTIONS -w)
    set_source_files_properties(src/file_player.cpp PROPERTIES COMPILE_OPTIONS -w)
endif()

# Beat tracking with the Beat This! model through ONNX Runtime (both MIT): the prebuilt library of the release,
# pinned by checksum. The model itself is not in the repository: native/tools/get-models.mjs downloads it to
# native/models. Without the model the analysis falls back to its own beat tracker.
option(BTG_BEAT_MODEL "Beat tracking with the Beat This! model through ONNX Runtime" ON)
if(BTG_BEAT_MODEL)
    set(ort_version 1.30.1)
    if(WIN32)
        set(ort_file onnxruntime-win-x64-${ort_version}.zip)
        set(ort_hash 9e70d829a7c2014c6f6d2889cd3578733c2e5bbe919e186b5f2038d59176ab13)
    elseif(APPLE)
        set(ort_file onnxruntime-osx-arm64-${ort_version}.tgz)
        set(ort_hash b9b1f72babd1b121b2323ac3069939623ce1d75db693b282bf5c2e593d340c79)
    else()
        set(ort_file onnxruntime-linux-x64-${ort_version}.tgz)
        set(ort_hash 35a95c9c2b298bbd7dd2d63c73b333adb039b7a0faa04790fa69243dfddefdd3)
    endif()
    FetchContent_Declare(onnxruntime
        URL https://github.com/microsoft/onnxruntime/releases/download/v${ort_version}/${ort_file}
        URL_HASH SHA256=${ort_hash}
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE
        SOURCE_SUBDIR none) # a prebuilt package: nothing to configure
    FetchContent_MakeAvailable(onnxruntime)
    add_library(btg_onnxruntime SHARED IMPORTED GLOBAL)
    target_include_directories(btg_onnxruntime INTERFACE ${onnxruntime_SOURCE_DIR}/include)
    if(WIN32)
        set_target_properties(btg_onnxruntime PROPERTIES
            IMPORTED_LOCATION ${onnxruntime_SOURCE_DIR}/lib/onnxruntime.dll
            IMPORTED_IMPLIB ${onnxruntime_SOURCE_DIR}/lib/onnxruntime.lib)
    elseif(APPLE)
        set_target_properties(btg_onnxruntime PROPERTIES IMPORTED_LOCATION ${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.dylib)
    else()
        set_target_properties(btg_onnxruntime PROPERTIES IMPORTED_LOCATION ${onnxruntime_SOURCE_DIR}/lib/libonnxruntime.so)
    endif()

    add_library(btg_beats STATIC src/beat_model.cpp)
    target_include_directories(btg_beats PUBLIC include)
    target_link_libraries(btg_beats PRIVATE btg_onnxruntime)
    get_filename_component(btg_models "${PROJECT_SOURCE_DIR}/models" ABSOLUTE)
    target_compile_definitions(btg_beats PUBLIC BTG_BEAT_MODEL=1 BTG_MODELS_DIR="${btg_models}")
    if(MSVC)
        target_compile_options(btg_beats PRIVATE /W4)
    else()
        target_compile_options(btg_beats PRIVATE -Wall -Wextra)
    endif()
endif()
# Windows looks for a DLL next to the program first (and has an old onnxruntime.dll of its own in System32).
function(btg_uses_beats target)
    if(BTG_BEAT_MODEL)
        target_link_libraries(${target} PRIVATE btg_beats)
        if(WIN32)
            add_custom_command(TARGET ${target} POST_BUILD COMMAND ${CMAKE_COMMAND} -E copy_if_different
                $<TARGET_FILE:btg_onnxruntime> $<TARGET_FILE_DIR:${target}>)
        endif()
    endif()
endfunction()

# Sample packs of the web app; the engine tests and the offline render read them from the repository.
get_filename_component(btg_samples "${PROJECT_SOURCE_DIR}/../src/assets/samples" ABSOLUTE)

add_executable(btg_engine_tests tests/test_engine.cpp)
target_link_libraries(btg_engine_tests PRIVATE btg_core)
# On CI (GitHub sets CI) the engine test prints its load and does not assert it; told by an argument (std::getenv warns under MSVC).
if(DEFINED ENV{CI})
    set(btg_on_ci --ci)
endif()
add_test(NAME engine COMMAND btg_engine_tests ${CMAKE_CURRENT_SOURCE_DIR}/tests/track-funk.json ${btg_on_ci})

add_executable(btg_fx_tests tests/test_fx.cpp)
target_link_libraries(btg_fx_tests PRIVATE btg_core)
add_test(NAME fx COMMAND btg_fx_tests)

# The building blocks of the synth voices: wave tables and oscillator, AudioParam timeline, the synth tone.
add_executable(btg_synth_tests tests/test_synth.cpp)
target_link_libraries(btg_synth_tests PRIVATE btg_core)
add_test(NAME synth COMMAND btg_synth_tests)

add_executable(btg_analysis_tests tests/test_analysis.cpp)
target_link_libraries(btg_analysis_tests PRIVATE btg_core)
btg_uses_beats(btg_analysis_tests)
add_test(NAME analysis COMMAND btg_analysis_tests)

# Offline render to WAV. As a test: the real packs load and the song is not silent.
add_executable(btg_render tools/render.cpp)
target_link_libraries(btg_render PRIVATE btg_core)
add_test(NAME render COMMAND btg_render ${CMAKE_CURRENT_SOURCE_DIR}/tests/track-funk.json ${btg_samples} ${PROJECT_BINARY_DIR}/render-test.wav)

# The compressor alone on a raw file, for native/tools/compressor-compare.mjs (against Chromium's DynamicsCompressorNode).
add_executable(btg_compressor tools/compressor.cpp)
target_link_libraries(btg_compressor PRIVATE btg_core)

# The layer effects alone on a raw file, for native/tools/fx-compare.mjs (against the web app's chains in Chromium).
add_executable(btg_fx tools/fx.cpp)
target_link_libraries(btg_fx PRIVATE btg_core)

# Analysis of an audio file to JSON (tempo, beats, chords, key).
add_executable(btg_analyze tools/analyze.cpp)
target_link_libraries(btg_analyze PRIVATE btg_core)
btg_uses_beats(btg_analyze)

# Generator against the web app in the working tree (src/): Node writes the reference, the test compares.
add_executable(btg_parity_tests tests/test_parity.cpp)
target_link_libraries(btg_parity_tests PRIVATE btg_core nlohmann_json::nlohmann_json)

# The logic of the core (sound model, later more) function by function against the web app in the working tree.
add_executable(btg_logic_tests tests/test_logic.cpp)
target_link_libraries(btg_logic_tests PRIVATE btg_core nlohmann_json::nlohmann_json)
find_program(NODE node)
if(NODE)
    add_test(NAME parity_export COMMAND ${NODE} ${PROJECT_SOURCE_DIR}/tools/export-events.mjs ${PROJECT_BINARY_DIR}/parity)
    add_test(NAME parity COMMAND btg_parity_tests ${PROJECT_BINARY_DIR}/parity/cases.json)
    set_tests_properties(parity_export PROPERTIES FIXTURES_SETUP parity_reference)
    set_tests_properties(parity PROPERTIES FIXTURES_REQUIRED parity_reference)
    add_test(NAME logic_export COMMAND ${NODE} ${PROJECT_SOURCE_DIR}/tools/export-logic.mjs ${PROJECT_BINARY_DIR}/logic)
    add_test(NAME logic COMMAND btg_logic_tests ${PROJECT_BINARY_DIR}/logic/logic.json)
    set_tests_properties(logic_export PROPERTIES FIXTURES_SETUP logic_reference)
    set_tests_properties(logic PROPERTIES FIXTURES_REQUIRED logic_reference)
    # sound.json must be what the web app in the working tree exports (native/tools/export-events.mjs --data rewrites it)
    add_test(NAME sound_data_export COMMAND ${NODE} ${PROJECT_SOURCE_DIR}/tools/export-events.mjs --data-only ${PROJECT_BINARY_DIR}/data-check)
    add_test(NAME sound_data COMMAND ${CMAKE_COMMAND} -E compare_files --ignore-eol ${PROJECT_BINARY_DIR}/data-check/sound.json ${CMAKE_CURRENT_SOURCE_DIR}/data/sound.json)
    set_tests_properties(sound_data_export PROPERTIES FIXTURES_SETUP sound_reference)
    set_tests_properties(sound_data PROPERTIES FIXTURES_REQUIRED sound_reference)
else()
    message(WARNING "node not found: the parity test against the web app is not registered")
endif()
