// What the shell needs of the song's timeline (native/PROTOKOLL.md section 7): the events of the lanes as text, laneKey, which says when they change,
// and the beat at which a bar begins.
#include "btg/generator.h"
#include "harmony.h"
#include "profiles.h"
#include "track_internal.h"

#include <nlohmann/json.hpp>

#include <stdexcept>

namespace btg {

double barStart(const std::string& trackJson, int bar) {
    const detail::Json track = detail::normalizedTrack(detail::parsedText(trackJson));
    if (!track.is_object() || detail::member(track, "bars") == nullptr || !track.at("bars").is_array()) throw std::invalid_argument("barStart: no track");
    const detail::Json& bars = track.at("bars");
    static const detail::Json none;
    const detail::ChordIndex chordIndex(bars, track.contains("form") ? track.at("form") : none);
    if (bar < 0 || bar >= detail::numberOf(track.at("length"))) throw std::invalid_argument("barStart: the bar lies outside the loop"); // play.js 39-41
    double beats = 0;
    for (int i = 0; i < bar; ++i) beats += detail::numberOf(bars.at(static_cast<size_t>(chordIndex(i))).at("beats"));
    return beats;
}

std::string eventsJson(const std::vector<Event>& events) {
    static const char* const TYPES[] = { "chord", "marker", "note", "hit" };
    using Type = Event::Type;
    nlohmann::json out = nlohmann::json::array();
    for (const Event& e : events) {
        nlohmann::json j = { { "t", e.t }, { "bar", e.bar }, { "type", TYPES[static_cast<int>(e.type)] } };
        if (e.beat) j["beat"] = *e.beat;
        if (e.type == Type::chord) j["chord"] = { { "root", e.chordRoot }, { "quality", e.chordQuality } };
        if (e.type == Type::marker) {
            j["name"] = e.name;
            if (e.name == "section") { j["kind"] = e.kind; j["index"] = e.index; }
        }
        if (e.type == Type::note) { j["layer"] = e.layer; j["midi"] = e.midi; j["vel"] = e.vel; j["dur"] = e.dur; }
        if (e.type == Type::hit) { j["layer"] = e.layer; j["name"] = e.name; j["vel"] = e.vel; }
        if (!e.art.empty()) j["art"] = e.art;
        if (e.artSemi) j["artSemi"] = *e.artSemi;
        if (e.artTime) j["artTime"] = *e.artTime;
        if (e.artRate) j["artRate"] = *e.artRate;
        if (e.strum) j["strum"] = nlohmann::json::array({ e.strum->first, e.strum->second });
        if (e.strumUp) j["strumUp"] = *e.strumUp;
        if (e.leslie) j["leslie"] = *e.leslie;
        if (e.swell) j["swell"] = *e.swell;
        if (e.ring) j["ring"] = true;
        out.push_back(std::move(j));
    }
    return out.dump(-1, ' ', false, nlohmann::json::error_handler_t::replace);
}

std::string laneKey(const std::string& trackJson) {
    const detail::Json track = detail::parsedText(trackJson);
    detail::Json key = detail::Json::array();
    for (const char* field : { "key", "bars", "tags", "seed", "length", "meter", "groove", "complexity", "loose", "ornaments", "form", "jobs", "voices", "variety" }) {
        const detail::Json* v = detail::member(track, field);
        key.push_back(v != nullptr ? *v : detail::Json()); // JSON.stringify writes undefined in a list as null
    }
    return detail::stringify(key);
}

} // namespace btg
