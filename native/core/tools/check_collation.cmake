# ctest collation_data: native/core/data/collation.json must be what this machine's Node (its ICU) writes (export-events.mjs --data-only).
execute_process(COMMAND ${CMAKE_COMMAND} -E compare_files --ignore-eol ${NEW} ${OLD} RESULT_VARIABLE same)
if(NOT same EQUAL 0)
    message(FATAL_ERROR "collation.json differs from what the Node on this machine writes: its ICU orders the names of profiles differently, or collation-data.mjs changed. "
        "Look at the difference (${NEW} against ${OLD}); if the web app's order really changed, regenerate the file with: node native/tools/export-events.mjs <dir> --data, and run the logic test.")
endif()
