cmake_minimum_required(VERSION 3.26) # cmake -E copy_directory_if_different (app/CMakeLists.txt)
project(BackingtrackNative VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# OFF builds and tests the core alone: no JUCE download, no JUCE licence involved.
option(BTG_BUILD_APP "Build the JUCE app (JUCE licence: see LICENSES.md)" ON)

enable_testing()
add_subdirectory(core)
add_subdirectory(platform)

if(BTG_BUILD_APP)
    include(FetchContent)
    FetchContent_Declare(JUCE
        URL https://github.com/juce-framework/JUCE/archive/refs/tags/9.0.5.tar.gz
        URL_HASH SHA256=d92207f51ba728d3d195b6d5e93ecd049717a915fc250ff6844c32ea7272315a
        DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
    FetchContent_MakeAvailable(JUCE)

    if(WIN32)
        # WebView2 SDK (headers and static loader). JUCE searches this folder for *Microsoft.Web.WebView2*.
        FetchContent_Declare(webview2
            URL https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2/1.0.3485.44
            URL_HASH SHA256=bc09150b179246ac90189649b13be8e6b11b3ac200e817e18df106e1f3cf489e
            DOWNLOAD_NAME webview2.zip
            DOWNLOAD_EXTRACT_TIMESTAMP TRUE
            SOURCE_DIR ${CMAKE_BINARY_DIR}/nuget/Microsoft.Web.WebView2)
        FetchContent_MakeAvailable(webview2)
        set(JUCE_WEBVIEW2_PACKAGE_LOCATION ${CMAKE_BINARY_DIR}/nuget)
    endif()

    add_subdirectory(app)
endif()
