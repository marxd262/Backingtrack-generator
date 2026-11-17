# What only the operating system can do, behind one interface (include/btg_platform). No JUCE.
if(WIN32)
    add_library(btg_platform STATIC win/system_audio_win.cpp)
    target_link_libraries(btg_platform PRIVATE ole32 mfplat mfreadwrite mfuuid)
else()
    add_library(btg_platform STATIC other/system_audio_other.cpp)
endif()
target_include_directories(btg_platform PUBLIC include)

add_executable(btg_platform_probe tools/probe.cpp)
target_link_libraries(btg_platform_probe PRIVATE btg_platform)
