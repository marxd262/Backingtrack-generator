// core/form-roll.js: rolling a song form. The code follows the JavaScript line by line on purpose: the count and the order of the random draws
// (and with them every roll at some seed) are the web app's, and so are the order of the floating-point operations. Names are kept.
#include "form_internal.h"
#include "generator_internal.h" // Rng (createRng), clamp
#include "harmony.h"            // seedBase

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace btg::detail {
namespace {

// ---------- the tables (music.json "form", written by native/tools/export-events.mjs --data) ----------

// A place of a template: { types, bars: [choices], p (1 = always), repeat?: [min, max] }
struct Slot {
    std::vector<std::string> types;
    std::vector<int> bars;
    double p = 1;
    bool repeats = false;
    int repeatMin = 0, repeatMax = 0;
};
// `unit`: all parts have this length (blues), the sum is a multiple of it (0 = none). `jam`: guard rails 4 and 5 do not hold. `bridge`: the probability at the default structure.
struct Template {
    bool jam = false;
    double bridge = 0;
    int unit = 0;
    std::vector<Slot> head, cycle, tail;
};
struct FormData {
    std::vector<std::string> templateIds;
    std::map<std::string, Template> templates;
    std::map<std::string, std::string> styleTemplate;
    std::vector<double> targetSizes;
    std::vector<std::pair<std::string, std::vector<std::pair<std::string, double>>>> devFactors; // in the table's order: it decides the order of a product
    std::vector<std::pair<std::string, double>> feelDefaults;                                      // in the table's order
    double dynamicsMax = 0;
};

std::vector<Slot> slotsOf(const Json& list) {
    std::vector<Slot> out;
    for (const Json& s : list) {
        Slot slot;
        slot.types = s.at("types").get<std::vector<std::string>>();
        slot.bars = s.at("bars").get<std::vector<int>>();
        slot.p = s.at("p").get<double>();
        if (const auto repeat = s.find("repeat"); repeat != s.end()) {
            slot.repeats = true;
            slot.repeatMin = repeat->at(0).get<int>();
            slot.repeatMax = repeat->at(1).get<int>();
        }
        out.push_back(std::move(slot));
    }
    return out;
}

const FormData& formData() {
    static const FormData table = [] {
        // a bad embedded file throws: that is a build error, not a user error
        const Json& form = musicTable().at("form");
        FormData d;
        d.templateIds = form.at("templateIds").get<std::vector<std::string>>();
        for (const auto& [id, t] : form.at("templates").items()) {
            Template tpl;
            tpl.jam = t.value("jam", false);
            tpl.bridge = t.value("bridge", 0.0);
            tpl.unit = t.value("unit", 0);
            tpl.head = slotsOf(t.at("head"));
            tpl.cycle = slotsOf(t.at("cycle"));
            tpl.tail = slotsOf(t.at("tail"));
            d.templates[id] = std::move(tpl);
        }
        d.styleTemplate = form.at("styleTemplate").get<std::map<std::string, std::string>>();
        d.targetSizes = form.at("targetSizes").get<std::vector<double>>();
        for (const auto& [tag, factors] : form.at("devFactors").items()) {
            auto& list = d.devFactors.emplace_back(tag, std::vector<std::pair<std::string, double>>()).second;
            for (const auto& [type, factor] : factors.items()) list.emplace_back(type, factor.get<double>());
        }
        for (const auto& [k, v] : form.at("feelDefaults").items()) d.feelDefaults.emplace_back(k, v.get<double>());
        d.dynamicsMax = form.at("dynamicsMax").get<double>();
        return d;
    }();
    return table;
}

// ---------- the rules of form-roll.js (numbers that are part of a rule stay here) ----------

constexpr double DEFAULT_TARGET = 96;
const char* const FALLBACK_TEMPLATE = "pop";
constexpr int MAX_BARS = 32;                // Höchstlänge eines Teils
constexpr int STEP = 2;                     // Anpassung an die Zielgröße in Schritten von 2 Takten
constexpr int TOLERANCE = 4;                // so weit darf die Summe vom Ziel abweichen
constexpr int PHRASE = 4;                   // Phrasenlänge: Teile sollen Vielfache davon sein
constexpr int FILLER_BARS = 8;              // Länge eines Platzhalters vor einem gesperrten Teil
constexpr double LEN_FRACTION = 0.25;       // Längenwahlen über diesem Anteil der Zielgröße werden nicht gezogen
constexpr int MIN_CHORUS_LENGTH = 24;       // Leitplanke 5: ab dieser Gesamtlänge (außer Jam) mindestens ein Refrain
constexpr size_t MAX_BODY_PARTS = 60;       // Schutz vor endlosem Anhängen
constexpr int ATTEMPTS = 24;                // Versuche, bis die Leitplanken halten; sonst der beste
constexpr int SEARCH_BUDGET = 3000;         // Knoten der Typ-Suche je Versuch
constexpr int BRIDGE_MIN_TARGET = 48;       // Bridge erst ab dieser Zielgröße
constexpr double CHORUS_STOP_P = 0.3;       // Refrain nach Strophe/Intro beginnt mit Stopp (bei Struktur-Standard)
const std::vector<std::string> TYPE_ORDER { "verse", "chorus", "outro", "intro", "break", "build" }; // Ersatzreihenfolge bei Reparatur (nie Bridge)
const std::vector<double> BRIDGE_BARS { 4, 8 };
const std::vector<std::string> AFTER_BRIDGE { "chorus", "verse", "build" };
const std::vector<std::string> STOP_AFTER { "verse", "intro" };

int minBars(const std::string& type) { // Leitplanke 6: Mindestlänge je Typ
    static const std::map<std::string, int> MIN_BARS { { "intro", 2 }, { "build", 2 }, { "break", 2 }, { "outro", 2 }, { "verse", 4 }, { "chorus", 4 }, { "bridge", 4 } };
    return MIN_BARS.at(type);
}

bool contains(const std::vector<std::string>& list, const std::string& s) { return std::find(list.begin(), list.end(), s) != list.end(); }

// `obj?.[key]`: what an object has under the key; anything that is no object has nothing (the web's read() counts a getter that throws as missing: JSON has none)
const Json* read(const Json& object, const char* key) {
    if (!object.is_object()) return nullptr;
    const auto found = object.find(key);
    return found == object.end() ? nullptr : &*found;
}
Json readValue(const Json& object, const char* key) { const Json* v = read(object, key); return v == nullptr ? Json() : *v; }

bool isFiniteNumber(const Json* v) { return v != nullptr && v->is_number() && std::isfinite(v->get<double>()); }

double sumBars(const std::vector<Json>& sections) {
    double sum = 0;
    for (const Json& s : sections) sum += s.at("bars").get<double>();
    return sum;
}

std::vector<std::string> devTags(const Json& tags) {
    std::vector<std::string> out;
    const Json* d = read(tags, "development");
    if (d == nullptr || !d->is_array()) return out;
    for (const Json& t : *d) if (t.is_string() && !contains(out, t.get<std::string>())) out.push_back(t.get<std::string>()); // [...new Set(filter)]: first occurrences, in order
    return out;
}

struct TemplateChoice { std::string name; bool automatic; };

TemplateChoice resolveTemplateOf(const Json& templateOrAuto, const Json& styleId, const Json& tags) {
    const FormData& d = formData();
    if (templateOrAuto.is_string() && contains(d.templateIds, templateOrAuto.get<std::string>())) return { templateOrAuto.get<std::string>(), false };
    if (!templateOrAuto.is_null() && !(templateOrAuto.is_string() && templateOrAuto.get<std::string>() == "auto")) return { FALLBACK_TEMPLATE, false };
    if (styleId.is_string()) {
        const auto found = d.styleTemplate.find(styleId.get<std::string>());
        if (found != d.styleTemplate.end()) return { found->second, true };
    }
    const std::vector<std::string> dev = devTags(tags); // nur für einen unbekannten Stil entscheidet das Schlagwort; sonst wirkt es über devFactors in der Vorlage
    return { contains(dev, "buildsSlowly") && !contains(dev, "fullFromStart") ? "buildDrop" : FALLBACK_TEMPLATE, true };
}

double nearestTarget(const Json& x) {
    if (!x.is_number() || !std::isfinite(x.get<double>())) return DEFAULT_TARGET;
    const double v = x.get<double>();
    const std::vector<double>& sizes = formData().targetSizes;
    double best = sizes.front(); // reduce without an initial value: the first, then each one that is nearer
    for (size_t i = 1; i < sizes.size(); ++i) if (std::fabs(sizes[i] - v) < std::fabs(best - v)) best = sizes[i];
    return best;
}

Json cleanFeel(const Json& feel) {
    Json out = Json::object();
    for (const auto& [k, fallback] : formData().feelDefaults) {
        const Json* v = read(feel, k.c_str());
        out[k] = isFiniteNumber(v) ? Json(clamp(v->get<double>(), 0, k == "dynamics" ? formData().dynamicsMax : 1)) : Json(fallback);
    }
    return out;
}

// Gesperrte, gültige Teile der vorigen Form: index -> Kopie (nur bekannte Felder). The web catches whatever an unreadable form throws; normalizeForm and checkForm
// throw on no JSON value, so there is nothing to catch.
std::map<int, Json> lockedParts(const Json& previous) {
    std::map<int, Json> out;
    const Json prev = normalizeForm(previous);
    if (prev.is_discarded() || !prev.is_object()) return out;
    const Json* sections = read(prev, "sections");
    if (sections == nullptr || !sections->is_array()) return out;
    const size_t n = std::min(sections->size(), static_cast<size_t>(formLimit("parts")));
    for (size_t i = 0; i < n; ++i) {
        const Json& s = (*sections)[i];
        const Json* locked = read(s, "locked");
        if (locked == nullptr || !locked->is_boolean() || !locked->get<bool>()) continue; // not an object, or not `locked === true`
        bool ok = true;
        checkForm(Json::object({ { "sections", Json::array({ s }) } }), [&](const char*, Json) { ok = false; });
        if (ok) out[static_cast<int>(i)] = s;
    }
    return out;
}

// ---------- Ziehen ----------

// a part on its way to the form: `opt` can be left out when fitting, `opts` are the lengths its place allows, `sec` is a locked part as it was given
struct Item {
    std::string type;
    int bars = 0;
    bool locked = false, opt = false;
    std::optional<std::vector<int>> opts;
    Json sec;
};
struct Ctx {
    int target = 0;
    std::map<std::string, double> mult; // development factors per type; a type without one counts 1
    double structure = 0, cap = 0;
    double multOf(const std::string& type) const { const auto found = mult.find(type); return found == mult.end() ? 1.0 : found->second; }
};

int sumBars(const std::vector<Item>& items) {
    int sum = 0;
    for (const Item& it : items) sum += it.bars;
    return sum;
}

// Längen, die ein Platz beim Anpassen annehmen darf: seine Wahlen plus die Vielfachen von PHRASE dazwischen (nie außerhalb von [lo, hi]).
std::vector<int> lengthOptions(const std::vector<int>& choices) {
    const int lo = *std::min_element(choices.begin(), choices.end()), hi = *std::max_element(choices.begin(), choices.end());
    std::set<int> out(choices.begin(), choices.end());
    for (int b = lo; b <= hi; ++b) if (b % PHRASE == 0) out.insert(b);
    return { out.begin(), out.end() }; // sorted
}

std::vector<Item> drawSlot(const Slot& sl, const Ctx& ctx, Rng& rng, bool extra) {
    std::vector<double> weights;
    for (const std::string& t : sl.types) weights.push_back(ctx.multOf(t));
    double total = 0;
    for (const double w : weights) total += w;
    double r = rng.next() * total;
    size_t pick = 0;
    while (pick < weights.size() - 1 && r >= weights[pick]) r -= weights[pick++];
    const std::string& type = sl.types[pick];
    const bool required = sl.p >= 1;
    if (!required && rng.next() >= std::min(1.0, sl.p * ctx.multOf(type) * ctx.structure)) return {};
    std::vector<int> pool;
    for (const int b : sl.bars) if (b <= ctx.cap) pool.push_back(b);
    if (pool.empty()) pool.push_back(*std::min_element(sl.bars.begin(), sl.bars.end()));
    const int count = sl.repeats ? rng.integer(sl.repeatMin, sl.repeatMax) : 1;
    const std::vector<int> opts = lengthOptions(sl.bars);
    // Wiederholungen und weitere Durchläufe sind entbehrlich (opt): beim Anpassen an kleine Ziele fallen sie zuerst weg
    std::vector<Item> items;
    for (int k = 0; k < count; ++k) {
        Item it;
        it.type = type;
        it.bars = rng.pick(pool);
        it.opt = !required || extra || k > 0;
        it.opts = opts;
        items.push_back(std::move(it));
    }
    return items;
}

std::vector<Item> drawItems(const Template& tpl, const Ctx& ctx, Rng& rng) {
    const auto run = [&](const std::vector<Slot>& slots, bool extra) {
        std::vector<Item> out;
        for (const Slot& sl : slots) for (Item& it : drawSlot(sl, ctx, rng, extra)) out.push_back(std::move(it));
        return out;
    };
    const std::vector<Item> head = run(tpl.head, false), tail = run(tpl.tail, false); // the head is drawn before the tail, both before the cycles
    std::vector<Item> body;
    size_t cycles = 0;
    do {
        for (Item& it : run(tpl.cycle, cycles > 0)) body.push_back(std::move(it));
        ++cycles;
    } while (sumBars(head) + sumBars(body) + sumBars(tail) < ctx.target && head.size() + body.size() + tail.size() < MAX_BODY_PARTS && cycles < MAX_BODY_PARTS);
    std::vector<Item> all = head;
    all.insert(all.end(), body.begin(), body.end());
    all.insert(all.end(), tail.begin(), tail.end());
    return all;
}

struct Merged { std::vector<Item> items; int last; };

// Gesperrte Teile an ihren Index setzen, die Ziehung füllt die Lücken davor, der Rest kommt dahinter.
Merged mergeLocked(std::vector<Item> items, const std::map<int, Json>& locks, int unit) {
    const int last = locks.empty() ? -1 : locks.rbegin()->first;
    if (last < 0) return { std::move(items), last };
    std::vector<Item> queue = std::move(items), merged;
    const auto shift = [&] { Item front = std::move(queue.front()); queue.erase(queue.begin()); return front; };
    for (int i = 0; i <= last; ++i) {
        if (const auto lock = locks.find(i); lock != locks.end()) {
            Item it;
            it.type = lock->second.at("type").get<std::string>();
            it.bars = static_cast<int>(lock->second.at("bars").get<double>());
            it.locked = true;
            it.sec = lock->second;
            merged.push_back(std::move(it));
            continue;
        }
        // vor einem gesperrten Teil sind Intro (außer vorn) und Outro fehl am Platz
        while (!queue.empty() && (queue.front().type == "outro" || (queue.front().type == "intro" && i > 0))) shift();
        if (!queue.empty()) { merged.push_back(shift()); continue; }
        Item filler;
        filler.type = "verse";
        filler.bars = unit ? unit : FILLER_BARS;
        filler.opts = unit ? std::vector<int> { unit } : lengthOptions({ PHRASE, 2 * FILLER_BARS });
        merged.push_back(std::move(filler));
    }
    // hinter dem letzten gesperrten Teil gibt es kein Intro mehr, ein Outro nur ganz am Ende, und hinter einem gesperrten Outro nichts
    if (merged[static_cast<size_t>(last)].type != "outro")
        for (size_t k = 0; k < queue.size(); ++k)
            if (queue[k].type != "intro" && (queue[k].type != "outro" || k == queue.size() - 1)) merged.push_back(queue[k]);
    return { std::move(merged), last };
}

// ---------- Anpassen der Summe ----------

bool dropOne(std::vector<Item>& items, int last, Rng& rng) {
    if (items.size() <= 2) return false;
    std::vector<size_t> idx;
    for (size_t i = 0; i < items.size(); ++i) if (static_cast<int>(i) > last && !items[i].locked) idx.push_back(i);
    if (idx.empty()) return false;
    std::vector<size_t> opt, notLast;
    for (const size_t i : idx) {
        if (items[i].opt) opt.push_back(i);
        if (i != items.size() - 1) notLast.push_back(i);
    }
    const std::vector<size_t>& pool = !opt.empty() ? opt : !notLast.empty() ? notLast : idx;
    items.erase(items.begin() + static_cast<std::ptrdiff_t>(rng.pick(pool)));
    return true;
}
bool isMain(const Item& it) { return it.type == "verse" || it.type == "chorus"; }

struct Move { size_t item = 0; int delta = 0, b = 0; };

// Bester Zug (kleinste Restabweichung, bei Gleichstand zufällig), der die Abweichung `diff` verkleinert, sonst keiner.
std::optional<Move> bestMove(const std::vector<Move>& moves, int diff, Rng& rng) {
    std::vector<Move> better;
    for (const Move& m : moves) if (std::abs(diff - m.delta) < std::abs(diff)) better.push_back(m);
    if (better.empty()) return std::nullopt;
    int least = std::abs(diff - better.front().delta);
    for (const Move& m : better) least = std::min(least, std::abs(diff - m.delta));
    std::vector<Move> ties;
    for (const Move& m : better) if (std::abs(diff - m.delta) == least) ties.push_back(m);
    return rng.pick(ties);
}

// Erst nur Längen aus dem Bereich des Platzes [lo, hi] (Wahlen und Vielfache von PHRASE), dann optionale Teile weglassen oder eine
// Strophe anhängen; so bleiben die Teile Vielfache von PHRASE. Hört auf, wenn kein Zug die Abweichung mehr verkleinert.
void fitInRange(std::vector<Item>& items, int target, int last, Rng& rng) {
    for (int guard = 0; guard < 600; ++guard) {
        const int diff = target - sumBars(items);
        std::vector<Move> lengths;
        for (size_t i = 0; i < items.size(); ++i)
            if (!items[i].locked && items[i].opts)
                for (const int b : *items[i].opts) if (b != items[i].bars) lengths.push_back({ i, b - items[i].bars, 0 });
        std::optional<Move> move = bestMove(lengths, diff, rng);
        if (!move && diff < 0 && items.size() > 2) {
            std::vector<Move> drops;
            for (size_t i = 0; i < items.size(); ++i) if (static_cast<int>(i) > last && !items[i].locked && items[i].opt) drops.push_back({ i, -items[i].bars, 0 });
            move = bestMove(drops, diff, rng);
            if (move) { items.erase(items.begin() + static_cast<std::ptrdiff_t>(move->item)); continue; }
        }
        if (!move && diff > 0 && static_cast<double>(items.size()) < formLimit("parts")) {
            const auto verse = std::find_if(items.begin(), items.end(), [](const Item& it) { return !it.locked && it.type == "verse" && it.opts; });
            if (verse != items.end()) {
                const std::vector<int> opts = *verse->opts; // the new part shares them
                std::vector<Move> appends;
                for (const int b : opts) appends.push_back({ 0, b, b });
                move = bestMove(appends, diff, rng);
                if (move) {
                    Item added;
                    added.type = "verse";
                    added.bars = move->b;
                    added.opt = true;
                    added.opts = opts;
                    const size_t at = static_cast<size_t>(std::max(last + 1, static_cast<int>(items.size()) - 1));
                    items.insert(items.begin() + static_cast<std::ptrdiff_t>(at), std::move(added));
                    continue;
                }
            }
        }
        if (!move) return;
        items[move->item].bars += move->delta;
    }
}

// Notlösung: 2-Takt-Schritte zwischen Mindest- und Höchstlänge, ganze Teile weglassen, bei `unit` ganze Teile anhängen.
void fitAnyLength(std::vector<Item>& items, int target, int unit, int last, Rng& rng) {
    const int tol = unit ? unit / 2 : TOLERANCE;
    const auto movable = [&](const std::function<bool(const Item&)>& pred) {
        std::vector<size_t> out;
        for (size_t i = 0; i < items.size(); ++i) if (!items[i].locked && pred(items[i])) out.push_back(i);
        return out;
    };
    for (int guard = 0; guard < 600; ++guard) {
        const int diff = target - sumBars(items);
        if (std::abs(diff) <= tol) return;
        if (diff < 0) {
            const std::vector<size_t> c = unit ? std::vector<size_t>() : movable([](const Item& it) { return it.bars - STEP >= minBars(it.type); });
            if (!c.empty()) {
                int max = items[c.front()].bars;
                for (const size_t i : c) max = std::max(max, items[i].bars);
                std::vector<size_t> ties;
                for (const size_t i : c) if (items[i].bars == max) ties.push_back(i);
                items[rng.pick(ties)].bars -= STEP;
                continue;
            }
            if (!dropOne(items, last, rng)) return;
        } else {
            const std::vector<size_t> room = unit ? std::vector<size_t>() : movable([](const Item& it) { return it.bars + STEP <= MAX_BARS; }); // wachsen sollen Strophe und Refrain, nicht Aufbau und Break
            std::vector<size_t> c;
            for (const size_t i : room) if (isMain(items[i])) c.push_back(i);
            if (c.empty()) c = room;
            if (!c.empty()) {
                int min = items[c.front()].bars;
                for (const size_t i : c) min = std::min(min, items[i].bars);
                std::vector<size_t> ties;
                for (const size_t i : c) if (items[i].bars == min) ties.push_back(i);
                items[rng.pick(ties)].bars += STEP;
                continue;
            }
            if (!unit || static_cast<double>(items.size()) >= formLimit("parts")) return;
            Item added;
            added.type = "verse";
            added.bars = unit;
            const size_t at = static_cast<size_t>(std::max(last + 1, static_cast<int>(items.size()) - 1));
            items.insert(items.begin() + static_cast<std::ptrdiff_t>(at), std::move(added));
        }
    }
}
void fit(std::vector<Item>& items, int target, int unit, int last, Rng& rng) {
    if (!unit) fitInRange(items, target, last, rng);
    fitAnyLength(items, target, unit, last, rng); // tut nichts, wenn die Summe schon höchstens TOLERANCE neben dem Ziel liegt
}

// ---------- Leitplanken (lokale Fenster, damit die Suche nur prüft, was sie gerade ändert) ----------
// A type list with places that are not set yet: "" is the web's `undefined`, as is every index outside the list.

const std::string& typeAt(const std::vector<std::string>& s, long i) {
    static const std::string undefined;
    return i < 0 || i >= static_cast<long>(s.size()) ? undefined : s[static_cast<size_t>(i)];
}
bool singleBad(const std::vector<std::string>& s, long i) {
    const std::string& first = typeAt(s, 0);
    const std::string& here = typeAt(s, i);
    return (i == 0 && !first.empty() && first != "intro" && first != "verse") || (i == static_cast<long>(s.size()) - 1 && !here.empty() && here != "outro" && here != "chorus");
}
bool pairBad(const std::vector<std::string>& s, long i) {
    const std::string& a = typeAt(s, i);
    const std::string& b = typeAt(s, i + 1);
    return !a.empty() && !b.empty() && ((a == "build" && b != "chorus") || (a == "break" && b == "break") || (b == "bridge" && a != "chorus") || (a == "bridge" && !contains(AFTER_BRIDGE, b)));
}
bool tripleBad(const std::vector<std::string>& s, long i, bool jam) {
    const std::string& a = typeAt(s, i);
    return !jam && !a.empty() && a == typeAt(s, i + 1) && a == typeAt(s, i + 2);
}
bool windowBad(const std::vector<std::string>& s, long i, bool jam) {
    return singleBad(s, i) || pairBad(s, i - 1) || pairBad(s, i) || tripleBad(s, i - 2, jam) || tripleBad(s, i - 1, jam) || tripleBad(s, i, jam);
}
int countViolations(const std::vector<std::string>& s, bool jam, double total) {
    int n = 0;
    for (long i = 0; i < static_cast<long>(s.size()); ++i) n += singleBad(s, i) + pairBad(s, i) + tripleBad(s, i, jam);
    if (!jam && total >= MIN_CHORUS_LENGTH && !contains(s, "chorus")) n++;
    if (std::count(s.begin(), s.end(), "bridge") > 1) n++;
    return n;
}

// Typen der nicht gesperrten Teile so wählen, dass die Leitplanken halten (zuerst der gezogene Typ); false, wenn die Suche scheitert.
bool assignTypes(std::vector<Item>& items, bool jam, double total) {
    std::vector<std::string> seq(items.size());
    std::vector<size_t> free;
    for (size_t i = 0; i < items.size(); ++i) {
        if (items[i].locked) seq[i] = items[i].type;
        else free.push_back(i);
    }
    const bool needChorus = !jam && total >= MIN_CHORUS_LENGTH;
    int nodes = 0;
    const std::function<bool(size_t)> rec = [&](size_t k) {
        if (k == free.size()) return !needChorus || contains(seq, "chorus");
        if (++nodes > SEARCH_BUDGET) return false;
        const size_t i = free[k];
        const std::string drawn = items[i].type;
        std::vector<std::string> order { drawn };
        for (const std::string& x : TYPE_ORDER) if (x != drawn) order.push_back(x);
        for (const std::string& t : order) {
            if (items[i].bars < minBars(t) || items[i].bars > MAX_BARS || (t == "intro" && i > 0) || (t == "outro" && i + 1 < items.size())) continue;
            seq[i] = t;
            if (!windowBad(seq, static_cast<long>(i), jam) && rec(k + 1)) return true;
        }
        seq[i].clear();
        return false;
    };
    if (!rec(0)) return false;
    for (const size_t i : free) items[i].type = seq[i];
    return true;
}

struct Attempt { std::vector<Json> sections; double score = 0; };

Attempt attempt(const Template& tpl, const Ctx& ctx, const std::map<int, Json>& locks, Rng& rng) {
    const int unit = tpl.unit;
    Merged merged = mergeLocked(drawItems(tpl, ctx, rng), locks, unit);
    std::vector<Item>& items = merged.items;
    // ein offener Aufbau/Break am Ende hinter dem letzten gesperrten Teil entfällt, damit die Form auf Outro/Refrain endet
    while (items.size() > 1 && static_cast<int>(items.size()) - 1 > merged.last && items.back().opt && items.back().type != "outro" && items.back().type != "chorus") items.pop_back();
    fit(items, ctx.target, unit, merged.last, rng);
    const bool ok = assignTypes(items, tpl.jam, sumBars(items));
    std::vector<Json> out;
    for (const Item& it : items) out.push_back(it.locked ? it.sec : Json::object({ { "type", it.type }, { "bars", it.bars } }));
    for (size_t i = 0; i < items.size(); ++i) { // Refrain nach Strophe/Intro beginnt manchmal mit einem Stopp
        if (items[i].locked) continue;
        const double roll = rng.next();
        if (out[i].at("type") == "chorus" && i > 0 && contains(STOP_AFTER, out[i - 1].at("type").get<std::string>()) && roll < CHORUS_STOP_P * ctx.structure) out[i]["transition"] = "stop";
    }
    const int total = sumBars(items);
    std::vector<std::string> types;
    for (const Json& s : out) types.push_back(s.at("type").get<std::string>());
    const double lengthMiss = std::max(0.0, std::abs(ctx.target - total) - (unit ? unit / 2.0 : TOLERANCE));
    return { std::move(out), countViolations(types, tpl.jam, total) * 1000 + lengthMiss + (ok ? 0 : 1) };
}

/**
 * Bridge in die fertig gewürfelte Form einfügen: hinter dem vorletzten Refrain, wenn danach Strophe, Aufbau oder Refrain kommt und dahinter
 * kein gesperrter Teil seinen Platz verlöre. Die Summe bleibt gleich: der längste freie Hauptteil (Strophe oder Refrain) gibt die Takte ab,
 * wenn ihm mindestens 8 bleiben. Die Entscheidung zieht ein eigener Zweig des Zufalls und sie fällt erst nach dem Würfeln.
 */
void insertBridge(std::vector<Json>& sections, const Template& tpl, const Ctx& ctx, const Rng& rng, int lastLocked) {
    const double p = tpl.bridge * ctx.structure;
    if (!(p > 0) || ctx.target < BRIDGE_MIN_TARGET || static_cast<double>(sections.size()) >= formLimit("parts")
        || std::any_of(sections.begin(), sections.end(), [](const Json& s) { return s.at("type") == "bridge"; })) return;
    Rng own = rng.fork("bridge");
    if (own.next() >= p) return;
    std::vector<std::string> types;
    for (const Json& s : sections) types.push_back(s.at("type").get<std::string>());
    long last = -1;
    for (long i = static_cast<long>(types.size()) - 1; i >= 0 && last < 0; --i) if (types[static_cast<size_t>(i)] == "chorus") last = i;
    if (last < 1) return;
    long prev = -1;
    for (long i = last - 1; i >= 0 && prev < 0; --i) if (types[static_cast<size_t>(i)] == "chorus") prev = i;
    if (prev < 0 || prev < lastLocked || !contains(AFTER_BRIDGE, types[static_cast<size_t>(prev) + 1])) return;
    const int bars = static_cast<int>(own.pick(BRIDGE_BARS));
    // the longest free main part (the first of them at a tie: the web's sort is stable)
    Json* donor = nullptr;
    for (Json& s : sections) {
        const Json* locked = read(s, "locked");
        const bool free = locked == nullptr || *locked != true;
        if (!free || !(s.at("type") == "verse" || s.at("type") == "chorus") || s.at("bars").get<double>() - bars < 2 * PHRASE) continue;
        if (donor == nullptr || s.at("bars").get<double>() > donor->at("bars").get<double>()) donor = &s;
    }
    if (donor == nullptr) return;
    (*donor)["bars"] = donor->at("bars").get<double>() - bars;
    sections.insert(sections.begin() + prev + 1, Json::object({ { "type", "bridge" }, { "bars", bars } }));
}

} // namespace

double formLimit(const char* name) { return musicTable().at("form").at("limits").at(name).get<double>(); }

Json resolveTemplate(const Json& templateOrAuto, const Json& styleId, const Json& tags) {
    const TemplateChoice r = resolveTemplateOf(templateOrAuto, styleId, tags);
    return Json::object({ { "template", r.name }, { "auto", r.automatic } });
}

Json rollForm(const Json& args) {
    const FormData& d = formData();
    const TemplateChoice resolved = resolveTemplateOf(readValue(args, "template"), readValue(args, "style"), readValue(args, "tags"));
    const Json feel = cleanFeel(readValue(args, "feel"));
    const Json seed = readValue(args, "seed");
    const std::vector<std::string> dev = devTags(readValue(args, "tags"));
    Ctx ctx;
    for (const std::string& tag : dev)
        for (const auto& [name, factors] : d.devFactors)
            if (name == tag)
                for (const auto& [type, factor] : factors) ctx.mult[type] = ctx.multOf(type) * factor;
    ctx.target = static_cast<int>(nearestTarget(readValue(args, "targetBars")));
    double defaultStructure = 0;
    for (const auto& [k, v] : d.feelDefaults) if (k == "structure") defaultStructure = v;
    ctx.structure = clamp(feel.at("structure").get<double>() / defaultStructure, 0, 1 / defaultStructure);
    ctx.cap = ctx.target * LEN_FRACTION;
    const Template& tpl = d.templates.at(resolved.name);
    const auto finish = [&](const std::map<int, Json>& locks) {
        // a seed that is no number is 0: the web says so itself
        Rng rng = Rng(seedBase(seed.is_number() ? seed : Json(0))).fork("formgen");
        std::optional<Attempt> best;
        for (int n = 0; n < ATTEMPTS && (!best || best->score > 0); ++n) {
            Attempt a = attempt(tpl, ctx, locks, rng);
            if (!best || a.score < best->score) best = std::move(a);
        }
        std::vector<Json> sections = std::move(best->sections);
        if (best->score == 0) insertBridge(sections, tpl, ctx, rng, locks.empty() ? -1 : locks.rbegin()->first);
        while (static_cast<double>(sections.size()) > formLimit("parts") || (sumBars(sections) > formLimit("length") && sections.size() > 1)) sections.pop_back(); // nur bei absurden Sperren
        return Json::object({ { "template", resolved.name }, { "auto", resolved.automatic }, { "feel", feel }, { "sections", Json(sections) } });
    };
    const Json form = finish(lockedParts(readValue(args, "previous")));
    bool bad = false;
    checkForm(form, [&](const char*, Json) { bad = true; });
    return bad ? finish({}) : form;
}

} // namespace btg::detail
