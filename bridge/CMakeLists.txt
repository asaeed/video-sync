cmake_minimum_required(VERSION 3.24)
project(video_sync_bridge VERSION 0.1.0 LANGUAGES C CXX)

include(FetchContent)

# Some macOS Command Line Tools releases leave only forwarding headers in the
# toolchain directory while libc++ itself lives in the active SDK.  Add that
# SDK include directory when present; normal Xcode installations tolerate it.
if(APPLE)
  enable_language(OBJC)
  execute_process(
    COMMAND xcrun --show-sdk-path
    OUTPUT_VARIABLE VIDEO_SYNC_MACOS_SDK
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )
  if(EXISTS "${VIDEO_SYNC_MACOS_SDK}/usr/include/c++/v1")
    include_directories(SYSTEM BEFORE "${VIDEO_SYNC_MACOS_SDK}/usr/include/c++/v1")
  endif()
endif()

set(LINK_BUILD_TESTS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  ableton_link
  GIT_REPOSITORY https://github.com/Ableton/link.git
  GIT_TAG e9a2e414d63f55f1aad158370b007a6fbdc1eeb9 # Link-4.0
  GIT_SHALLOW TRUE
  SOURCE_SUBDIR cmake-do-not-add-link-root
)
FetchContent_MakeAvailable(ableton_link)
include("${ableton_link_SOURCE_DIR}/AbletonLinkConfig.cmake")

set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(RTMIDI_BUILD_TESTING OFF CACHE BOOL "" FORCE)
FetchContent_Declare(
  rtmidi
  GIT_REPOSITORY https://github.com/thestk/rtmidi.git
  GIT_TAG 1e5b49925aa60065db52de44c366d446a902547b # 6.0.0
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(rtmidi)

add_executable(video-sync-bridge src/main.cpp)
target_compile_features(video-sync-bridge PRIVATE cxx_std_20)
target_link_libraries(video-sync-bridge PRIVATE Ableton::Link rtmidi)

if(MSVC)
  target_compile_options(video-sync-bridge PRIVATE /W4 /permissive-)
else()
  target_compile_options(video-sync-bridge PRIVATE -Wall -Wextra -Wpedantic)
endif()

if(APPLE)
  add_executable(video-sync-rekordbox-adapter src/rekordbox_macos_adapter.m)
  target_link_libraries(video-sync-rekordbox-adapter PRIVATE
    "-framework AppKit"
    "-framework ApplicationServices"
    "-framework Foundation"
  )
  target_compile_options(video-sync-rekordbox-adapter PRIVATE -Wall -Wextra -Wpedantic -fblocks)
endif()
