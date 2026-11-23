// Plays a list of actions on a session, as the app's shell check (native/tools/shell-check.mjs) sends them to the app, and writes what the shell
// gives the page after each (native/PROTOKOLL.md section 7), on a storage in memory that starts empty:
//   btg_session <steps.json> <out.json>
// steps.json: a list; a step is an action's text, or { "export": [key, name] } (Session::exportFile only). out.json: a list with one record per
// step, { change, state, track, profiles (at the first step and when change.profiles), events (eventsJson of track() when laneKey(track()) differs from
// the key of the last events, at the first step always) } or { export }, then { stored: { name: text } }, what the storage holds at the end.
#include "btg/generator.h"
#include "btg/session.h"

#include <nlohmann/json.hpp>

#include <cstdio>
#include <fstream>
#include <map>

using json = nlohmann::json;

namespace {

struct MemoryStorage : btg::Storage {
    std::map<std::string, std::string> files;
    std::optional<std::string> read(const std::string& name) override {
        const auto it = files.find(name);
        return it == files.end() ? std::nullopt : std::optional<std::string>(it->second);
    }
    bool write(const std::string& name, const std::string& text) override { files[name] = text; return true; }
};

} // namespace

int main(int argc, char** argv) {
    if (argc < 3) { std::printf("usage: btg_session <steps.json> <out.json>\n"); return 2; }
    std::ifstream in(argv[1], std::ios::binary);
    const json steps = json::parse(in, nullptr, false);
    if (!steps.is_array()) { std::printf("%s is no list of steps\n", argv[1]); return 2; }
    MemoryStorage storage;
    btg::Session session(storage);
    json out = json::array();
    std::string lastKey;
    for (size_t k = 0; k < steps.size(); ++k) {
        const json& step = steps[k];
        if (step.is_object() && step.contains("export")) {
            out.push_back({ { "export", session.exportFile(step.at("export").at(0).get<std::string>(), step.at("export").at(1).get<std::string>()) } });
            continue;
        }
        const btg::Session::Change c = session.apply(step.get<std::string>());
        const std::string track = session.track();
        json record = { { "change", { { "events", c.events }, { "sound", c.sound }, { "voices", c.voices }, { "tempo", c.tempo }, { "mix", c.mix },
                                      { "restart", c.restart }, { "inPlace", c.inPlace }, { "profiles", c.profiles } } },
                        { "state", session.state() }, { "track", track } };
        if (k == 0 || c.profiles) record["profiles"] = session.profiles();
        if (const std::string key = btg::laneKey(track); key != lastKey) {
            lastKey = key;
            record["events"] = btg::eventsJson(btg::buildSong(track).events);
        }
        out.push_back(std::move(record));
    }
    out.push_back({ { "stored", storage.files } });
    std::ofstream file(argv[2], std::ios::binary);
    file << out.dump(-1, ' ', false, json::error_handler_t::replace);
    return file ? 0 : 1;
}
