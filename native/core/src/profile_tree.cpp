// The tree of profiles and folders (core/profile-tree.js) and its store (ui/profile-store.js), line by line, on JSON values; the order and the case of names
// (compareNames, lowerCase) from native/core/data/collation.json. native/core/tests/test_logic.cpp compares them with the web app one by one (Task 30a).
#include "profiles.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <set>
#include <stdexcept>
#include <unordered_set>

extern const unsigned char btg_collation_json[]; // native/core/data/collation.json, embedded by CMake (native/tools/collation-data.mjs writes it)
extern const unsigned int btg_collation_json_size;

namespace btg::detail {
namespace {

// ---------- the order and the case of names ----------

struct Collation {
    std::unordered_map<char32_t, std::vector<int>> weights; // the primary weights of a covered character: none (ignored) or several (an expansion)
    std::unordered_map<char32_t, std::string> lower;        // toLowerCase of a covered character
    std::set<std::pair<char32_t, char32_t>> absorbed;       // y directly after x has no weight of its own
    int number = 0;                                         // the weight of a run of digits
};
const Collation& collation() {
    static const Collation table = [] {
        const Json j = Json::parse(btg_collation_json, btg_collation_json + btg_collation_json_size);
        Collation c;
        for (const auto& [cp, w] : j.at("chars").items()) c.weights[static_cast<char32_t>(std::stoul(cp))] = w.get<std::vector<int>>();
        for (const auto& [cp, l] : j.at("lower").items()) c.lower[static_cast<char32_t>(std::stoul(cp))] = l.get<std::string>();
        for (const Json& pair : j.at("absorbed")) c.absorbed.insert({ pair.at(0).get<char32_t>(), pair.at(1).get<char32_t>() });
        c.number = j.at("number").get<int>();
        return c;
    }();
    return table;
}

struct Element { long long weight; bool isNumber; std::string digits; }; // a number is compared by its digits (no leading zeros): the shorter is smaller
constexpr long long OUTSIDE = 1LL << 32;
constexpr size_t MAX_DIGITS = 254;

std::vector<Element> keyOf(const std::string& text) {
    const Collation& c = collation();
    const std::vector<char32_t> cps = codePoints(text);
    std::vector<Element> key;
    for (size_t i = 0; i < cps.size();) {
        const char32_t cp = cps[i];
        if (cp >= '0' && cp <= '9') { // a run of ASCII digits: a number, its value by its digits
            size_t j = i;
            while (j < cps.size() && cps[j] >= '0' && cps[j] <= '9') ++j;
            // shortcut: ICU reads at most 254 digits as one number, the core throws beyond (names are cut to 60 characters before they are sorted), upgrade: if longer names are sorted
            if (j - i > MAX_DIGITS) throw std::invalid_argument("compareNames: a run of more than 254 digits");
            std::string digits;
            for (size_t k = i; k < j; ++k) if (!digits.empty() || cps[k] != '0') digits += static_cast<char>(cps[k]);
            key.push_back({ c.number, true, std::move(digits) });
            i = j;
            continue;
        }
        if (i > 0 && c.absorbed.count({ cps[i - 1], cp })) { ++i; continue; }
        const auto found = c.weights.find(cp);
        // shortcut: a character that is not in collation.json (other scripts, other symbols, controls) sorts after every covered character, and such characters among themselves by
        // code point; the web's order is ICU's for them (Greek before Cyrillic, but also accents, ignored marks, digits of other scripts), upgrade: when names in other scripts must sort
        // as in the web app (a full collation from the shell or a library)
        if (found == c.weights.end()) key.push_back({ OUTSIDE + static_cast<long long>(cp), false, {} });
        else for (const int w : found->second) key.push_back({ w, false, {} });
        ++i;
    }
    return key;
}

} // namespace

int compareNames(const std::string& a, const std::string& b) {
    const std::vector<Element> x = keyOf(a), y = keyOf(b);
    for (size_t i = 0; i < x.size() && i < y.size(); ++i) {
        if (x[i].weight != y[i].weight) return x[i].weight < y[i].weight ? -1 : 1;
        if (x[i].isNumber && y[i].digits != x[i].digits) {
            if (x[i].digits.size() != y[i].digits.size()) return x[i].digits.size() < y[i].digits.size() ? -1 : 1;
            return x[i].digits < y[i].digits ? -1 : 1;
        }
    }
    return x.size() == y.size() ? 0 : x.size() < y.size() ? -1 : 1;
}

std::string lowerCase(const std::string& text) {
    // shortcut: the case of a character that is not in collation.json is not changed (Greek, Cyrillic ...) where the web lower-cases it (and treats a final sigma by its place),
    // upgrade: when names in other scripts must be told apart as in the web app
    if (std::all_of(text.begin(), text.end(), [](char ch) { return static_cast<unsigned char>(ch) < 0x80; })) { // ASCII: the table says A to Z, nothing else
        std::string ascii = text;
        for (char& ch : ascii) if (ch >= 'A' && ch <= 'Z') ch = static_cast<char>(ch + ('a' - 'A'));
        return ascii;
    }
    const Collation& c = collation();
    std::string out;
    for (const char32_t cp : codePoints(text)) {
        const auto found = c.lower.find(cp);
        if (found != c.lower.end()) out += found->second; else appendCodePoint(out, cp);
    }
    return out;
}

namespace {

// ---------- reading the tree ----------

bool isFolder(const Json& n) { const Json* type = member(n, "type"); return type != nullptr && *type == "folder"; }
const Json& itemsOfNode(const Json& n) { // the list of a folder or of a tree
    const Json* items = member(n, "items");
    if (items == nullptr || !items->is_array()) throw std::invalid_argument("a tree and its folders hold their items in a list");
    return *items;
}
const std::string& nameOf(const Json& n) { // shortcut: a name is a text (the tree makes it so); the web throws a TypeError where it compares another kind, upgrade: if a tree comes from elsewhere
    const Json* name = member(n, "name");
    if (name == nullptr || !name->is_string()) throw std::invalid_argument("a node has a name that is a text");
    return name->get_ref<const std::string&>();
}
bool hasId(const Json& n, const Json& id) { const Json* v = member(n, "id"); return v != nullptr && *v == id; } // n.id === id
// folders first, then by name; the sort is stable, as the JavaScript's. In place: a list of a thousand nodes with their parts is not copied for it.
void sortInPlace(Json& items) {
    std::vector<Json>& list = items.get_ref<Json::array_t&>();
    std::stable_sort(list.begin(), list.end(), [](const Json& a, const Json& b) {
        const bool folderA = isFolder(a), folderB = isFolder(b);
        if (folderA != folderB) return folderA;
        return compareNames(nameOf(a), nameOf(b)) < 0;
    });
}
Json arrayOf(std::vector<Json>&& list) { Json out = Json::array(); out.get_ref<Json::array_t&>() = std::move(list); return out; }
Json fail(const char* code) { return Json::object({ { "ok", false }, { "code", code } }); }
std::string callId(const MakeId& makeId) {
    if (!makeId) throw std::invalid_argument("no makeId");
    return makeId();
}

// the chain of nodes from the top level to the node with the id (empty: not found)
bool walkTo(const Json& items, const Json& id, std::vector<const Json*>& path) {
    for (const Json& n : items) {
        path.push_back(&n);
        if (hasId(n, id)) return true;
        if (isFolder(n) && walkTo(itemsOfNode(n), id, path)) return true;
        path.pop_back();
    }
    return false;
}
std::vector<const Json*> pathTo(const Json& tree, const Json& id) {
    std::vector<const Json*> path;
    walkTo(itemsOfNode(tree), id, path);
    return path;
}
double height(const Json& n) {
    if (!isFolder(n)) return 1;
    double most = 0;
    for (const Json& c : itemsOfNode(n)) most = std::max(most, height(c));
    return 1 + most;
}

struct Parent { const Json* items = nullptr; size_t depth = 0; const char* code = nullptr; };
// the list of the parent: null = top level; a folder -> its items; unknown or a profile -> an error code
Parent itemsOf(const Json& tree, const Json& parentId) {
    Parent p;
    if (parentId.is_null()) { p.items = &itemsOfNode(tree); return p; }
    const std::vector<const Json*> path = pathTo(tree, parentId);
    if (path.empty()) { p.code = "notFound"; return p; }
    if (!isFolder(*path.back())) { p.code = "invalidTarget"; return p; }
    p.items = &itemsOfNode(*path.back());
    p.depth = path.size();
    return p;
}

// ---------- changing it ----------

using Edit = std::function<Json(const Json&)>;
// replaces the list under parentId (null = top level) by fn(list); a new tree { items }
Json editWalk(const Json& items, const Json& parentId, const Edit& fn) {
    Json out = Json::array();
    for (const Json& n : items) {
        if (!isFolder(n)) { out.push_back(n); continue; }
        Json copy = n;
        copy["items"] = hasId(n, parentId) ? fn(itemsOfNode(n)) : editWalk(itemsOfNode(n), parentId, fn);
        out.push_back(std::move(copy));
    }
    return out;
}
Json editItems(const Json& tree, const Json& parentId, const Edit& fn) {
    if (parentId.is_null()) return Json::object({ { "items", fn(itemsOfNode(tree)) } });
    return Json::object({ { "items", editWalk(itemsOfNode(tree), parentId, fn) } });
}
Json editNodeWalk(const Json& items, const Json& id, const Edit& fn) {
    Json out = Json::array();
    for (const Json& n : items) {
        if (hasId(n, id)) { out.push_back(fn(n)); continue; }
        if (!isFolder(n)) { out.push_back(n); continue; }
        Json copy = n;
        copy["items"] = editNodeWalk(itemsOfNode(n), id, fn);
        out.push_back(std::move(copy));
    }
    return out;
}
Json editNode(const Json& tree, const Json& id, const Edit& fn) { return Json::object({ { "items", editNodeWalk(itemsOfNode(tree), id, fn) } }); }

Json appended(const Json& items, const Json& more) { // [...items, ...more]
    Json out = items;
    for (const Json& n : more) out.push_back(n);
    return out;
}

// the name the JavaScript's String(name ?? '').trim().slice(0, 60).trim() makes. shortcut: a name is a text or null; the web would print any other value, upgrade: if a caller hands other values
std::string cleanText(const Json& name) {
    if (!name.is_null() && !name.is_string()) throw std::invalid_argument("a name is a text");
    return name.is_null() ? std::string() : jsTrim(jsSlice(jsTrim(name.get_ref<const std::string&>()), NAME_LIMIT));
}

Json add(const Json& tree, const Json& parentId, const Json& name, const std::function<Json(const Json&, const std::string&)>& make, const MakeId& makeId) {
    const Json v = validName(tree, parentId, name, Json());
    if (!v.at("ok").get<bool>()) return v;
    if (itemsOf(tree, parentId).depth + 1 > DEPTH_LIMIT) return fail("tooDeep");
    if (countNodes(tree) >= NODE_LIMIT) return fail("tooMany");
    const std::string id = callId(makeId);
    const std::string clean = v.at("name").get<std::string>();
    return Json::object({ { "ok", true }, { "tree", editItems(tree, parentId, [&](const Json& items) { return sortItems(appended(items, Json::array({ make(id, clean) }))); }) }, { "id", id }, { "name", clean } });
}

// null = may; else the error code
const char* moveCheck(const Json& tree, const Json& id, const Json& targetId) {
    const std::vector<const Json*> path = pathTo(tree, id);
    if (path.empty()) return "notFound";
    const Parent t = itemsOf(tree, targetId);
    if (t.code != nullptr) return t.code;
    if (!targetId.is_null()) for (const Json* n : pathTo(tree, targetId)) if (hasId(*n, id)) return "invalidTarget"; // into itself or a descendant
    return static_cast<double>(t.depth) + height(*path.back()) > DEPTH_LIMIT ? "tooDeep" : nullptr;
}

// ---------- the store ----------

struct Loaded { int nodes = 0; std::unordered_set<std::string> ids; };

Json readItems(const Json& raw, size_t level, Loaded& st, const MakeId& makeId) {
    std::vector<Json> out;
    std::vector<std::string> names;
    for (const Json& r : raw) {
        if (!r.is_object() || level > DEPTH_LIMIT || st.nodes >= static_cast<int>(NODE_LIMIT)) continue;
        const Json* type = member(r, "type");
        Json parts;
        bool profile = false;
        if (type != nullptr && *type == "profile") {
            parts = sanitizeParts(orNull(member(r, "parts"))).at("parts");
            if (parts.empty()) continue;
            profile = true;
        } else if (!(type != nullptr && *type == "folder" && member(r, "items") != nullptr && member(r, "items")->is_array())) continue;
        ++st.nodes;
        const Json* given = member(r, "id");
        const bool keep = given != nullptr && given->is_string() && !given->get_ref<const std::string&>().empty() && !isReservedId(given->get_ref<const std::string&>())
                          && !st.ids.count(given->get_ref<const std::string&>());
        const std::string id = keep ? given->get_ref<const std::string&>() : callId(makeId);
        st.ids.insert(id);
        const Json* rawName = member(r, "name");
        const std::string name = rawName != nullptr && rawName->is_string() ? jsTrim(jsSlice(jsTrim(rawName->get_ref<const std::string&>()), NAME_LIMIT)) : "";
        Json full = Json::object({ { "id", id }, { "type", profile ? "profile" : "folder" }, { "name", freeName(names, name.empty() ? "Importiert" : name) } });
        if (profile) full["parts"] = std::move(parts); else full["items"] = readItems(*member(r, "items"), level + 1, st, makeId);
        names.push_back(full.at("name").get<std::string>());
        out.push_back(std::move(full));
    }
    Json sorted = arrayOf(std::move(out));
    sortInPlace(sorted);
    return sorted;
}

struct ImportResult { const char* code = nullptr; Json rootId; Json ids; double profiles = 0, dropped = 0; };
ImportResult importInto(Json& tree, const Json& parentId, const Json& node, const MakeId& makeId); // below, in the section of importNode

Json& mutableItems(Json& n) { // the list of a folder or of a tree
    Json* items = n.is_object() && n.contains("items") ? &n["items"] : nullptr;
    if (items == nullptr || !items->is_array()) throw std::invalid_argument("a tree and its folders hold their items in a list");
    return *items;
}
// fn on the list of every folder with the id parentId (not on one inside another such folder), as editItems does it on a copy
void editListInPlace(Json& items, const Json& parentId, const std::function<void(Json&)>& fn) {
    for (Json& n : items) {
        if (!isFolder(n)) continue;
        if (hasId(n, parentId)) fn(mutableItems(n)); else editListInPlace(mutableItems(n), parentId, fn);
    }
}

// an old flat list -> the top level; each profile through parseFile with all 9 parts (the name from the entry), what is of no use falls away
Json migrate(const Json& list, const MakeId& makeId) {
    Json tree = newTree();
    for (const Json& entry : list) {
        const Json* given = member(entry, "name");
        const std::string name = given != nullptr && given->is_string() ? jsSlice(jsTrim(given->get_ref<const std::string&>()), NAME_LIMIT) : "";
        if (name.empty()) continue;
        const Json r = parseFile(orNull(member(entry, "profile")));
        if (!r.at("ok").get<bool>() || r.at("node").at("type") != "profile") continue;
        Json node = r.at("node");
        node["name"] = name;
        importInto(tree, Json(), node, makeId); // a tree that cannot take it stays as it is
    }
    return tree;
}

} // namespace

// ---------- reading ----------

Json newTree() { return Json::object({ { "items", Json::array() } }); }

Json sortItems(const Json& items) {
    if (!items.is_array()) throw std::invalid_argument("sortItems: a list");
    Json sorted = items; // [...items]
    sortInPlace(sorted);
    return sorted;
}

Json find(const Json& tree, const Json& id) {
    const std::vector<const Json*> path = pathTo(tree, id);
    if (path.empty()) return Json();
    return Json::object({ { "node", *path.back() }, { "parent", path.size() > 1 ? *path[path.size() - 2] : Json() }, { "depth", path.size() } });
}

Json pathNames(const Json& tree, const Json& id) {
    Json out = Json::array();
    for (const Json* n : pathTo(tree, id)) out.push_back(nameOf(*n));
    return out;
}

double countProfiles(const Json& node) { // a profile counts 1, a folder (or the tree) its profiles
    const Json* type = member(node, "type");
    if (type != nullptr && *type == "profile") return 1;
    double sum = 0;
    for (const Json& n : itemsOfNode(node)) sum += countProfiles(n);
    return sum;
}

double countNodes(const Json& tree) {
    const std::function<double(const Json&)> count = [&](const Json& items) {
        double sum = 0;
        for (const Json& n : items) sum += 1 + (isFolder(n) ? count(itemsOfNode(n)) : 0);
        return sum;
    };
    return count(itemsOfNode(tree));
}

Json listFolders(const Json& tree) {
    Json out = Json::array({ Json::object({ { "id", nullptr }, { "label", "" }, { "depth", 0 } }) });
    const std::function<void(const Json&, int)> walk = [&](const Json& items, int depth) {
        for (const Json& n : sortItems(items)) {
            if (!isFolder(n)) continue;
            out.push_back(Json::object({ { "id", orNull(member(n, "id")) }, { "label", nameOf(n) }, { "depth", depth } }));
            walk(itemsOfNode(n), depth + 1);
        }
    };
    walk(itemsOfNode(tree), 1);
    return out;
}

// ---------- names ----------

Json validName(const Json& tree, const Json& parentId, const Json& name, const Json& exceptId) {
    const std::string clean = cleanText(name);
    if (clean.empty()) return fail("nameEmpty");
    const Parent p = itemsOf(tree, parentId);
    if (p.code != nullptr) return fail(p.code);
    const std::string key = lowerCase(clean);
    for (const Json& n : *p.items)
        if ((exceptId.is_null() || !hasId(n, exceptId)) && lowerCase(nameOf(n)) == key) return fail("nameTaken");
    return Json::object({ { "ok", true }, { "name", clean } });
}

std::string freeName(const std::vector<std::string>& names, const std::string& name) {
    std::unordered_set<std::string> taken;
    for (const std::string& n : names) taken.insert(lowerCase(n));
    if (!taken.count(lowerCase(name))) return name;
    for (int n = 2;; ++n) {
        const std::string suffix = " (" + std::to_string(n) + ")";
        const std::string candidate = jsTrimEnd(jsSlice(name, NAME_LIMIT - utf16Length(suffix))) + suffix; // with the suffix at most 60 characters
        if (!taken.count(lowerCase(candidate))) return candidate;
    }
}

// ---------- changing ----------

Json addFolder(const Json& tree, const Json& parentId, const Json& name, const MakeId& makeId) {
    return add(tree, parentId, name, [](const Json& id, const std::string& n) { return Json::object({ { "id", id }, { "type", "folder" }, { "name", n }, { "items", Json::array() } }); }, makeId);
}

Json addProfile(const Json& tree, const Json& parentId, const Json& name, const Json& parts, const MakeId& makeId) {
    return add(tree, parentId, name, [&](const Json& id, const std::string& n) { return Json::object({ { "id", id }, { "type", "profile" }, { "name", n }, { "parts", parts } }); }, makeId);
}

Json renameNode(const Json& tree, const Json& id, const Json& name) {
    const Json f = find(tree, id);
    if (f.is_null()) return fail("notFound");
    const Json parentId = f.at("parent").is_null() ? Json() : orNull(member(f.at("parent"), "id"));
    const Json v = validName(tree, parentId, name, id);
    if (!v.at("ok").get<bool>()) return v;
    const std::string newName = v.at("name").get<std::string>();
    const auto rename = [&](const Json& items) {
        Json mapped = Json::array();
        for (const Json& n : items) { Json copy = n; if (hasId(n, id)) copy["name"] = newName; mapped.push_back(std::move(copy)); }
        return sortItems(mapped);
    };
    return Json::object({ { "ok", true }, { "tree", editItems(tree, parentId, rename) }, { "id", id }, { "name", newName } });
}

Json removeNode(const Json& tree, const Json& id) {
    const Json f = find(tree, id);
    if (f.is_null()) return fail("notFound");
    const Json parentId = f.at("parent").is_null() ? Json() : orNull(member(f.at("parent"), "id"));
    const auto drop = [&](const Json& items) { Json kept = Json::array(); for (const Json& n : items) if (!hasId(n, id)) kept.push_back(n); return kept; };
    return Json::object({ { "ok", true }, { "tree", editItems(tree, parentId, drop) }, { "removed", f.at("node") }, { "parentId", parentId } });
}

Json overwriteParts(const Json& tree, const Json& id, const Json& parts) {
    const Json f = find(tree, id);
    if (f.is_null()) return fail("notFound");
    const Json* type = member(f.at("node"), "type");
    if (type == nullptr || *type != "profile") return fail("invalidTarget");
    const auto merge = [&](const Json& n) { Json copy = n; copy["parts"] = mergeParts(orNull(member(n, "parts")), parts); return copy; };
    return Json::object({ { "ok", true }, { "tree", editNode(tree, id, merge) }, { "id", id } });
}

// ---------- moving ----------

bool canMove(const Json& tree, const Json& id, const Json& targetId) { return moveCheck(tree, id, targetId) == nullptr; }

Json moveTargets(const Json& tree, const Json& id) {
    Json out = Json::array();
    if (find(tree, id).is_null()) return out;
    for (const Json& t : listFolders(tree)) if (canMove(tree, id, t.at("id"))) out.push_back(t);
    return out;
}

Json moveNode(const Json& tree, const Json& id, const Json& targetId) {
    if (const char* code = moveCheck(tree, id, targetId)) return fail(code);
    const Json f = find(tree, id);
    const Json parentId = f.at("parent").is_null() ? Json() : orNull(member(f.at("parent"), "id"));
    const Json& node = f.at("node");
    if (targetId == parentId) return Json::object({ { "ok", true }, { "tree", Json::object({ { "items", itemsOfNode(tree) } }) }, { "name", node.at("name") } }); // already there
    std::vector<std::string> siblings;
    for (const Json& n : *itemsOf(tree, targetId).items) siblings.push_back(nameOf(n));
    const std::string name = freeName(siblings, nameOf(node));
    const Json removed = removeNode(tree, id).at("tree");
    Json moved = node;
    moved["name"] = name;
    return Json::object({ { "ok", true }, { "tree", editItems(removed, targetId, [&](const Json& items) { return sortItems(appended(items, Json::array({ moved }))); }) }, { "name", name } });
}

// ---------- importing ----------

namespace {

// importNode on a tree that is changed in place when it works (migrate calls it up to a thousand times: a copy of the tree each time would be 30 million values)
ImportResult importInto(Json& tree, const Json& parentId, const Json& node, const MakeId& makeId) {
    const Parent p = itemsOf(tree, parentId);
    if (p.code != nullptr) return { p.code };
    if (p.depth + 1 > DEPTH_LIMIT) return { "tooDeep" };
    double room = static_cast<double>(NODE_LIMIT) - countNodes(tree);
    if (room <= 0) return { "tooMany" };
    Json ids = Json::array();
    double profiles = 0, dropped = 0; // dropped: nodes that would lie too deep or have no room (with their content); what is invalid does not count
    // shortcut: a name is a text or missing (parseFile makes it so); the web would print any other value, upgrade: if a caller hands other values
    const auto name = [](const Json& n) {
        const Json* given = member(n, "name");
        if (given != nullptr && !given->is_null() && !given->is_string()) throw std::invalid_argument("importNode: a name is a text");
        const std::string text = given == nullptr || given->is_null() ? std::string() : jsTrim(jsSlice(jsTrim(given->get_ref<const std::string&>()), NAME_LIMIT));
        return text.empty() ? std::string("Importiert") : text;
    };
    const std::function<double(const Json&)> size = [&](const Json& n) -> double { // a null child throws in the web (n.items of null)
        if (n.is_null()) throw std::invalid_argument("importNode: a null in a list of items");
        const Json* items = member(n, "items");
        double sum = 1;
        if (items != nullptr && items->is_array()) for (const Json& c : *items) sum += size(c);
        return sum;
    };
    std::function<Json(const Json&, size_t, const std::vector<std::string>&)> build;
    const auto buildAll = [&](const Json& list, size_t level, const std::vector<std::string>& names) {
        std::vector<Json> out;
        std::vector<std::string> taken = names;
        for (const Json& c : list) {
            Json b = build(c, level, taken);
            if (b.is_null()) continue;
            taken.push_back(b.at("name").get<std::string>());
            out.push_back(std::move(b));
        }
        return arrayOf(std::move(out));
    };
    // the new node or null (not taken)
    build = [&](const Json& n, size_t level, const std::vector<std::string>& siblings) -> Json {
        const Json* type = member(n, "type");
        const bool profile = type != nullptr && *type == "profile";
        const bool folder = isFolder(n) && member(n, "items") != nullptr && member(n, "items")->is_array();
        if (!profile && !folder) return Json();
        if (profile) { const Json* parts = member(n, "parts"); if (parts == nullptr || parts->is_null() || !(parts->is_object() || parts->is_array())) return Json(); }
        if (level > DEPTH_LIMIT || room <= 0) { dropped += size(n); return Json(); }
        --room;
        Json out = Json::object({ { "id", callId(makeId) }, { "type", profile ? "profile" : "folder" }, { "name", freeName(siblings, name(n)) } });
        ids.push_back(out.at("id"));
        if (profile) { ++profiles; out["parts"] = *member(n, "parts"); return out; }
        Json children = buildAll(*member(n, "items"), level + 1, {});
        sortInPlace(children);
        out["items"] = std::move(children);
        return out;
    };
    const Json* backupFlag = member(node, "backup");
    const bool backup = backupFlag != nullptr && *backupFlag == true && isFolder(node) && member(node, "items") != nullptr && member(node, "items")->is_array();
    std::vector<std::string> topNames;
    for (const Json& n : *p.items) topNames.push_back(nameOf(n));
    const Json added = buildAll(backup ? *member(node, "items") : Json::array({ node }), p.depth + 1, topNames);
    if (added.empty()) return { "invalidTarget" }; // no valid node
    // the new tree is { items } with the nodes added to the list under parentId and that list sorted again
    const auto append = [&](Json& items) { for (const Json& n : added) items.push_back(n); sortInPlace(items); };
    Json& top = mutableItems(tree);
    if (parentId.is_null()) append(top); else editListInPlace(top, parentId, append);
    Json only = Json::object({ { "items", std::move(top) } });
    tree = std::move(only);
    return { nullptr, backup ? Json() : added.at(0).at("id"), std::move(ids), profiles, dropped };
}

} // namespace

Json importNode(const Json& tree, const Json& parentId, const Json& node, const MakeId& makeId) {
    Json changed = tree;
    ImportResult r = importInto(changed, parentId, node, makeId);
    if (r.code != nullptr) return fail(r.code);
    return Json::object({ { "ok", true }, { "tree", std::move(changed) }, { "rootId", std::move(r.rootId) }, { "ids", std::move(r.ids) }, { "profiles", num(r.profiles) }, { "dropped", num(r.dropped) } });
}

// ---------- the store ----------

bool isReservedId(const std::string& id) { return id == "session" || id == "mine" || id == "factory" || id.rfind("factory:", 0) == 0; }

Json loadTree(Storage& storage, const MakeId& makeId) {
    try { // mirrors the JavaScript's try/catch at this place; no input known that reaches it
        const std::optional<std::string> text = storage.read(PROFILES_NAME);
        const Json raw = text ? parsedText(*text) : Json(); // a text that is no JSON counts as null: an empty tree (the web: JSON.parse throws, and the answer is the same)
        if (raw.is_array()) return migrate(raw, makeId);
        const Json* items = member(raw, "items");
        if (raw.is_object() && items != nullptr && items->is_array()) {
            Loaded st;
            return Json::object({ { "items", readItems(*items, 1, st, makeId) } });
        }
    } catch (const std::exception&) { /* the empty tree below */ }
    return newTree();
}

bool saveTree(Storage& storage, const Json& tree) {
    if (tree.is_null()) return false; // the web: tree.items throws inside its try
    Json stored = Json::object({ { "version", 2 } });
    if (const Json* items = member(tree, "items")) stored["items"] = *items;
    return storage.write(PROFILES_NAME, stringify(stored));
}

} // namespace btg::detail
