// ui/form-ui.js: the edits of a song form (form in, form out), as the strip of the page does them. The code follows the JavaScript line by line; names are kept.
#include "form_internal.h"
#include "generator_internal.h" // jsRound (Math.round), clamp

#include <algorithm>
#include <cmath>
#include <stdexcept>
#include <string>
#include <vector>

namespace btg::detail {
namespace {

[[noreturn]] void thrown(const char* what) { throw std::invalid_argument(what); } // where the web app throws a TypeError, or goes on with a coerced value

const std::vector<std::string>& listOf(const char* name) { // PART_TYPES, TRANSITIONS (music.json)
    static const Json& form = musicTable().at("form");
    static const std::vector<std::string> partTypes = form.at("partTypes").get<std::vector<std::string>>(), transitions = form.at("transitions").get<std::vector<std::string>>();
    return std::string(name) == "partTypes" ? partTypes : transitions;
}
bool contains(const std::vector<std::string>& list, const std::string& s) { return std::find(list.begin(), list.end(), s) != list.end(); }

const Json* own(const Json& object, const char* key) { // an own property of what was parsed from JSON; only an object has them
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
const Json* own(const Json* object, const char* key) { return object == nullptr ? nullptr : own(*object, key); }

// `form.sections`: the web throws for no form and no list of parts (undefined or null has no index).
// shortcut: a `sections` that is no list (a text, a number, an object) the web indexes like one and goes on, the core throws; no caller hands one over,
// upgrade: when a form that is not a list of parts is ever edited.
const Json& sectionsOf(const Json& form) {
    const Json* sections = own(form, "sections");
    if (sections == nullptr || !sections->is_array()) throw std::invalid_argument("the form has no list of parts");
    return *sections;
}

// `form.sections[index]`: the part, or none for an index that is no integer in the list (a fraction, below 0, beyond the end).
// shortcut: an `index` that is no number (the web reads the property of that name: '1' is the second part, null none) throws, the strip hands the number of the selected part,
// upgrade: when an index that is a text is ever handed over.
const Json* atIndex(const Json& sections, const Json& index) {
    if (!index.is_number()) thrown("the index is no number");
    const double i = index.get<double>();
    if (!(i >= 0 && i < static_cast<double>(sections.size()) && std::floor(i) == i)) return nullptr;
    return &sections[static_cast<size_t>(i)];
}

bool truthy(const Json* v) { // JavaScript's truthiness of what `form.sections[i]` is: undefined, null, false, 0 and "" are not
    if (v == nullptr || v->is_null()) return false;
    if (v->is_boolean()) return v->get<bool>();
    if (v->is_number()) return v->get<double>() != 0;
    if (v->is_string()) return !v->get_ref<const std::string&>().empty();
    return true;
}

// the number `x - s.bars` takes for a part's `bars`: undefined (missing) is NaN, null is 0.
// shortcut: a text, a boolean, a list or an object as `bars` is coerced by the web (a text in `total + bars` even concatenates), the core throws; a form that passed checkForm has none,
// upgrade: when a form that did not is ever edited.
double barsOf(const Json* s) {
    const Json* bars = own(s, "bars");
    if (bars == nullptr) return NAN;
    if (bars->is_null()) return 0;
    if (!bars->is_number()) thrown("bars is no number");
    return bars->get<double>();
}

// replace(form, sections): {...form, sections}
Json replace(const Json& form, Json sections) {
    Json out = spreadValue(form);
    out["sections"] = std::move(sections);
    return out;
}
Json result(Json form, double index) { return Json::object({ { "form", std::move(form) }, { "index", index } }); }

// {...section, locked: value}; an `undefined` is no field
Json lockedCopy(const Json& section, const Json& locked) {
    Json out = spreadValue(section);
    if (locked.is_discarded()) out.erase("locked");
    else out["locked"] = locked;
    return out;
}

// Feld setzen oder (undefined) entfernen; ein bearbeiteter Teil wird gesperrt
Json patched(const Json& section, const Json& patch) {
    Json next = spreadValue(section);
    for (auto it = patch.begin(); it != patch.end(); ++it) {
        if (it.value().is_discarded()) next.erase(it.key());
        else next[it.key()] = it.value();
    }
    next["locked"] = true;
    return next;
}

} // namespace

Json limits(const Json& form, const Json& index) {
    const Json& sections = sectionsOf(form);
    const double parts = static_cast<double>(sections.size());
    const double total = formLengthOf(form);
    const Json* s = atIndex(sections, index); // throws for an index that is no number
    const Json* given = own(s, "bars");
    const double bars = given == nullptr || given->is_null() ? 0 : barsOf(s); // `?.bars ?? 0`
    const double maxParts = formLimit("parts"), maxBars = formLimit("bars"), maxLength = formLimit("length");
    const bool roomParts = parts < maxParts;
    const bool canAdd = roomParts && total + 8 <= maxLength;
    const bool canCopy = roomParts && total + bars <= maxLength;
    const bool canLonger = bars < maxBars && total < maxLength;
    Json reasons = Json::array();
    if (!roomParts) reasons.push_back("form.limit.parts");
    else if (!canAdd || !canCopy || total >= maxLength) reasons.push_back("form.limit.length");
    if (bars >= maxBars) reasons.push_back("form.limit.part");
    if (parts == 1) reasons.push_back("form.limit.last");
    const double at = index.get<double>();
    return Json::object({ { "canAdd", canAdd }, { "canCopy", canCopy }, { "canLonger", canLonger }, { "canShorter", bars > 1 }, { "canDelete", parts > 1 },
                          { "canLeft", at > 0 }, { "canRight", at < parts - 1 }, { "reasons", reasons } });
}

Json editPart(const Json& form, const Json& index, const Json& patch) {
    const Json& sections = sectionsOf(form);
    const Json* s = atIndex(sections, index);
    if (!truthy(s)) return Json();
    // shortcut: a patch that is no object (the web takes the keys of a text, a list or a number, and throws for null) throws, the strip builds an object,
    // upgrade: when a patch of another kind is ever handed over.
    if (!patch.is_object()) thrown("the patch is no object");
    static const std::vector<std::string> EDITABLE { "type", "bars", "level", "density", "transition", "crash" };
    for (auto it = patch.begin(); it != patch.end(); ++it) if (!contains(EDITABLE, it.key())) return Json();
    Json next = patch;
    const auto num = [&](const char* k, double lo, double hi) { // a field that is set must be a finite number, clamped; `undefined` (a reset) and missing pass
        if (!next.contains(k) || next[k].is_discarded()) return true;
        if (!next[k].is_number() || !std::isfinite(next[k].get<double>())) return false;
        next[k] = clamp(next[k].get<double>(), lo, hi);
        return true;
    };
    if (next.contains("type") && !(next["type"].is_string() && contains(listOf("partTypes"), next["type"].get<std::string>()))) return Json();
    if (next.contains("transition") && !next["transition"].is_discarded() && !(next["transition"].is_string() && contains(listOf("transitions"), next["transition"].get<std::string>()))) return Json();
    if (next.contains("crash") && !next["crash"].is_discarded() && !next["crash"].is_boolean()) return Json();
    if (!num("level", formLimit("levelMin"), formLimit("levelMax")) || !num("density", formLimit("densityMin"), formLimit("densityMax"))) return Json();
    if (next.contains("bars")) {
        const Json& given = next["bars"];
        // shortcut: Math.round makes a number of a text, a list or a boolean; the core throws for them (undefined is NaN and null 0 there: no bars), the strip hands numbers,
        // upgrade: when such a patch is ever handed over.
        if (given.is_discarded() || given.is_null()) return Json();
        if (!given.is_number()) thrown("bars is no number");
        const double bars = jsRound(given.get<double>());
        if (!(bars >= 1 && bars <= formLimit("bars")) || formLengthOf(form) - barsOf(s) + bars > formLimit("length")) return Json();
        next["bars"] = bars;
    }
    const double at = index.get<double>();
    Json list = Json::array();
    for (size_t i = 0; i < sections.size(); ++i) list.push_back(static_cast<double>(i) == at ? patched(sections[i], next) : sections[i]);
    Json edited = replace(form, std::move(list));
    if (!isValidFormValue(edited)) return Json();
    return result(std::move(edited), at);
}

Json setLocked(const Json& form, const Json& index, const Json& locked) {
    const Json& sections = sectionsOf(form);
    if (!truthy(atIndex(sections, index))) return Json();
    const double at = index.get<double>();
    Json list = Json::array();
    for (size_t i = 0; i < sections.size(); ++i) list.push_back(static_cast<double>(i) == at ? lockedCopy(sections[i], locked) : sections[i]);
    return result(replace(form, std::move(list)), at);
}

Json addPart(const Json& form) {
    if (!limits(form, Json(0)).at("canAdd").get<bool>()) return Json();
    const Json& sections = sectionsOf(form);
    Json list = sections;
    list.push_back(Json::object({ { "type", "verse" }, { "bars", 8 }, { "locked", true } }));
    return result(replace(form, std::move(list)), static_cast<double>(sections.size()));
}

Json copyPart(const Json& form, const Json& index) {
    const Json& sections = sectionsOf(form);
    const Json* s = atIndex(sections, index);
    if (!truthy(s) || !limits(form, index).at("canCopy").get<bool>()) return Json();
    const double at = index.get<double>();
    Json list = sections;
    list.insert(list.begin() + static_cast<std::ptrdiff_t>(at) + 1, lockedCopy(*s, Json(true)));
    return result(replace(form, std::move(list)), at + 1);
}

Json deletePart(const Json& form, const Json& index) {
    const Json& sections = sectionsOf(form);
    if (!truthy(atIndex(sections, index)) || sections.size() < 2) return Json();
    const double at = index.get<double>();
    Json list = Json::array();
    for (size_t i = 0; i < sections.size(); ++i) if (static_cast<double>(i) != at) list.push_back(sections[i]);
    return result(replace(form, std::move(list)), std::min(at, static_cast<double>(sections.size()) - 2));
}

Json movePart(const Json& form, const Json& index, const Json& dir) {
    const Json& sections = sectionsOf(form);
    if (!dir.is_number()) thrown("dir is no number"); // shortcut: a text as `dir` is concatenated to the index by the web, the core throws, upgrade: when a text is ever handed over
    if (!index.is_number()) thrown("the index is no number");
    const double at = index.get<double>(), to = at + dir.get<double>();
    if (!truthy(atIndex(sections, index)) || !truthy(atIndex(sections, Json(to)))) return Json();
    Json list = sections;
    // [sections[index], sections[to]] = [sections[to], { ...sections[index], locked: true }]: the right side is made first, the assignments follow in order (index === to locks the part)
    const Json other = sections[static_cast<size_t>(to)], moved = lockedCopy(sections[static_cast<size_t>(at)], Json(true));
    list[static_cast<size_t>(at)] = other;
    list[static_cast<size_t>(to)] = moved;
    return result(replace(form, std::move(list)), to);
}

} // namespace btg::detail
