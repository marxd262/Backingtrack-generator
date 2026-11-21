#pragma once

// The profiles of the web app, on JSON values, one function for each of the JavaScript's with its name: the ten parts of a profile (core/profile-parts.js), the files
// (core/profile.js), the tree of profiles and folders (core/profile-tree.js) with its store (ui/profile-store.js), the factory profiles (ui/profile-factory.js), the session as
// parts (ui/profile-session.js) and the last session (ui/session-store.js). native/core/tests/test_logic.cpp compares them with the web app one by one. Control thread only.
// Implemented in profiles.cpp (parts, files, factory, session, last session) and profile_tree.cpp (names, tree, store).
//
// A value is nlohmann::ordered_json (track_internal.h): the order of an object's keys is the text's. The web's `undefined` (a field that is not there) is a missing key, or a null
// pointer/`Json()` where a function takes it as an argument. A session is the state's JSON object of PROTOKOLL.md section 4 (the fields track, scale, style, chordColor,
// chordColorFromStyle, mix, pan and organ are read).
//
// Domain, as in harmony.h: each function says what the web app's callers (src/ui/) hand it. Inside it, and for every input the JavaScript itself guards or throws on, the
// answer is the JavaScript's (the tests hold that). Outside:
//  - where the JavaScript throws, the core throws std::invalid_argument (the message is not the JavaScript's);
//  - where it coerces a value and goes on (String(name), a number as an index), the core does NOT rebuild the coercion: it throws std::invalid_argument. Those places are
//    named below and marked `shortcut:` in the code.
// Exception: sanitizeParts, parseFile, loadTree and loadLast read what a file or the storage holds, so ANY JSON value is inside their domain: they never throw and equal the
// JavaScript on every value, with four limits (each is marked `shortcut:` where the code decides it, and named again at the functions it touches):
//  1. a text that nests deeper than 64 levels counts as no JSON (track.cpp, the reader);
//  2. a lone surrogate escape in a text ("\ud83d") becomes U+FFFD, where the web keeps the surrogate (track.cpp, the reader);
//  3. bytes in a text that are no valid UTF-8 pass through the reader unchanged (a stored id keeps them), where the web, which gets a decoded text, has U+FFFD (track.cpp);
//  4. names with characters outside collation.json are sorted by code point after the covered ones and not lower-cased (profile_tree.cpp).
// Each of the four also has the JavaScript's catch-all (a try/catch that gives the answer for broken input); no input is known that reaches it.
//
// Ids: the JavaScript's `makeId` (and `defaultMakeId`, which loadTree and the take-over of old states call themselves) is an argument here, a callable that gives the next id
// as a text; the core draws nothing. The most ids a call can ask for: addFolder, addProfile 1; importNode and loadTree as many as nodes are made, at most LIMITS.nodes (1,000).
// A callable that has none left (or none: an empty std::function) makes the call throw std::invalid_argument.
// Texts: names are UTF-8 (a lone surrogate, which a cut of a name in the middle of an astral character leaves, is kept as its three bytes: WTF-8); a name's length is
// counted in UTF-16 code units, as the JavaScript's, and trimmed with the JavaScript's set of white space.

#include "btg/session.h"
#include "track_internal.h"

#include <functional>
#include <string>
#include <vector>

namespace btg::detail {

using MakeId = std::function<std::string()>;

// ---------- shared with profile_tree.cpp and session.cpp (defined in profiles.cpp) ----------

inline constexpr size_t NAME_LIMIT = 60, DEPTH_LIMIT = 8, NODE_LIMIT = 1000, FILE_LIMIT = 5000000; // profile.js LIMITS
const Json* member(const Json& object, const std::string& key); // an own field of an object; nullptr: not there (the web's undefined) or no object
const Json& orNull(const Json* v);                               // the field, or null for nullptr
bool truthy(const Json& v);                                      // JavaScript truthiness of a JSON value
Json num(double v);                                              // a number as the web holds it: a whole one an integer (as JSON.stringify writes it), any other a double
// shortcut: a number is read where the web may coerce a text or a list (a length is a number: sanitizeParts), upgrade: if a caller hands another kind
double numberOf(const Json& v);                                  // throws std::invalid_argument for what is no number
bool oneOf(const Json& v, const std::vector<std::string>& list); // a text of the list
std::vector<std::string> keysOf(const Json& object);
const std::vector<std::string>& layerIds();                      // LAYER_IDS
const std::vector<std::string>& voiceLayers();                   // VOICE_LAYERS
const std::vector<std::string>& mixNames();                      // audio/mix.js MIX_NAMES: the layers and master
const std::vector<std::string>& scaleNames();                    // SCALE_NAMES
const std::vector<std::string>& styleIds();                      // the ids of STYLE_PRESETS
// grooves.js meterKey: '6/8' for [6, 8], '' for anything that is no pair of integers. shortcut: an integer beyond 2^53 gives '' (the web prints it); it is no key of METERS
// either way, and the key is only looked up there, upgrade: if a caller prints it
std::string meterKey(const Json& meter);
double convertTempo(double bpm, const std::string& fromKey, const std::string& toKey); // grooves.js: the tempo of another meter's pulse

// ---------- text helpers (the JavaScript's string methods on UTF-8 / WTF-8) ----------

std::vector<char32_t> codePoints(const std::string& text);       // the code points of a text; a lone surrogate keeps its value, a byte that starts no sequence is U+FFFD
void appendCodePoint(std::string& text, char32_t cp);            // UTF-8 (a surrogate as its three bytes)
size_t utf16Length(const std::string& text);                     // text.length
std::string jsTrim(const std::string& text);                     // text.trim()
std::string jsTrimEnd(const std::string& text);                  // text.trimEnd()
std::string jsSlice(const std::string& text, size_t units);      // text.slice(0, units): a cut inside an astral character leaves its high surrogate
// JSON.stringify(value), byte for byte (numbers as the JavaScript prints them, a lone surrogate as \udXXX); with `indent`, JSON.stringify(value, null, indent)
std::string stringify(const Json& value, size_t indent = 0);

// ---------- profile-parts.js ----------

Json PART_IDS();                                                 // the ten parts in the order of the page
Json PART_PRESETS();                                             // { all, sound, rhythm, none }
// Domain: `session` a session whose `track` is an object (else std::invalid_argument); `ids` null (all parts) or a list of part ids. { part: value } in PART_IDS order, a deep copy;
// a value that is not there (the JavaScript's undefined) is left out; `form` only for a valid form.
Json captureParts(const Json& session, const Json& ids);
// Any JSON value; never throws (on an exception: { parts: {}, skipped: 1 }, as the web's catch). { parts, skipped }. Limits 2 and 3 above reach it through the strings a text gives.
Json sanitizeParts(const Json& raw);
// Domain: `session` as captureParts; `parts` what sanitizeParts or captureParts gave (an object of parts that are objects; null counts as none). A `scale` that is no text, a
// tempo whose bpm is no number where it has to be converted, and a part that is neither an object nor falsy throw std::invalid_argument. Result { ok: true, session } or { ok: false, errors }.
Json applyParts(const Json& session, const Json& parts);
Json partIdsOf(const Json& parts);                               // the parts a value has, in PART_IDS order; anything that is no object has none
Json mergeParts(const Json& base, const Json& over);             // a new object; a part of `over` replaces the one of `base`

// ---------- profile.js ----------

Json LIMITS();                                                   // { name: 60, depth: 8, nodes: 1000, file: 5000000 }
Json FORMATS();                                                  // { FORMAT_PROFILE, FORMAT_FOLDER, PROFILE_VERSION, FOLDER_VERSION }
// Domain: a profile node { type, name, parts }. A node of another kind gives what the JavaScript gives (a name "Importiert", no parts); `node` null counts as missing.
Json makeProfileFile(const Json& node);
// Domain: a folder node { type, name, items, backup? }; a value that is no object counts as missing, as in the JavaScript.
Json makeFolderFile(const Json& node);
// `input` a file as text (a JSON string) or as a value. A text longer than LIMITS.file UTF-16 code units is refused before anything is parsed. { ok: true, node, skipped } or
// { ok: false, errors: [{ code: "badProfile", params: {} }] }; never throws. A text is read by the reader of track.cpp, so limits 1 to 3 above apply: nesting deeper than 64 levels
// counts as no JSON (a file the web reads but no valid file reaches: folders nest at most 8 deep); a lone surrogate escape in a name becomes U+FFFD; invalid UTF-8 bytes stay.
// The size is checked before the text is copied or parsed.
Json parseFile(const Json& input);

// ---------- ui/profile-factory.js, ui/profile-session.js, ui/session-store.js ----------

Json factoryProfiles();                                          // [{ key: "factory:<id>", styleId }] in the order of the style presets
// Domain: the id of a style preset; another id throws std::invalid_argument (the web: a TypeError).
Json factoryParts(const std::string& styleId);
Json readSession(const Json& state);                             // the session fields of a state (a field the state has not is left out)
// Domain: `state` the state of PROTOKOLL.md (track an object), `session` the result of applyParts. Changes `state` as the web's writeSession does, except that it does NOT
// remember the mix (saveMix): the session writes mix.json itself after it (session.cpp).
void writeSession(Json& state, const Json& session);

// the names under which the shell stores them (the web: the keys backingtrack.profiles, backingtrack.session and backingtrack.mix; the mixer's is session.cpp's)
inline constexpr const char* PROFILES_NAME = "profiles.json";
inline constexpr const char* SESSION_NAME = "session.json";
inline constexpr const char* MIX_NAME = "mix.json";
// Domain: `session` as captureParts, `bar` and `at` numbers (the web: Date.now(); the core has no clock, the caller gives it). Writes { parts, bar, at } as JSON text; a write that
// fails is ignored (the web: no storage); returns the entry.
Json saveLast(Storage& storage, const Json& session, const Json& bar, const Json& at);
// The entry { parts, bar, at } or null; never throws. The stored text is read by the reader of track.cpp: limits 1 to 3 above apply.
Json loadLast(Storage& storage);

// ---------- profile-tree.js and ui/profile-store.js ----------

// The order of names: localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }) for the characters of native/core/data/collation.json (printable ASCII, Latin-1, Latin
// Extended-A, the combining marks U+0300 to U+036F, the typographic punctuation U+2010 to U+2027 and the euro sign); -1, 0 or 1. Outside them it is NOT the web's: see profile_tree.cpp. Throws std::invalid_argument
// for a run of more than 254 digits (ICU stops reading numbers there; names are cut to 60 characters).
int compareNames(const std::string& a, const std::string& b);
std::string lowerCase(const std::string& text);                  // text.toLowerCase() for the characters of collation.json; others stay as they are (shortcut in profile_tree.cpp)

Json newTree();
// Domain: a tree { items } of nodes { id, type, name, parts | items } (what these functions and loadTree make). A tree whose items are no list, or a node that is no object, throws
// std::invalid_argument; so does a name that is no text where names are compared.
Json sortItems(const Json& items);
Json find(const Json& tree, const Json& id);                     // { node, parent, depth } or null
Json pathNames(const Json& tree, const Json& id);
double countProfiles(const Json& node);                          // a node or a tree
double countNodes(const Json& tree);
Json listFolders(const Json& tree);
// `name` a text or null (the JavaScript: String(name ?? ''), a name of another kind throws std::invalid_argument here); `exceptId` null or an id.
Json validName(const Json& tree, const Json& parentId, const Json& name, const Json& exceptId);
std::string freeName(const std::vector<std::string>& names, const std::string& name);
Json addFolder(const Json& tree, const Json& parentId, const Json& name, const MakeId& makeId);
Json addProfile(const Json& tree, const Json& parentId, const Json& name, const Json& parts, const MakeId& makeId);
Json renameNode(const Json& tree, const Json& id, const Json& name);
Json removeNode(const Json& tree, const Json& id);
Json overwriteParts(const Json& tree, const Json& id, const Json& parts);
bool canMove(const Json& tree, const Json& id, const Json& targetId);
Json moveTargets(const Json& tree, const Json& id);
Json moveNode(const Json& tree, const Json& id, const Json& targetId);
// `node` an id-less node from parseFile (a node of another kind is skipped, as in the JavaScript). Takes one id per node it makes.
Json importNode(const Json& tree, const Json& parentId, const Json& node, const MakeId& makeId);

bool isReservedId(const std::string& id);
// The stored tree (PROFILES_NAME); never throws and writes nothing back (also not an exhausted or empty MakeId: that gives an empty tree, as the web's catch). A missing, broken
// or unusable text gives an empty tree; an old flat list is taken over. Takes an id for each node that has none, a reserved or a repeated one, and one for each profile of an old
// list. The stored text is read by the reader of track.cpp: limits 1 to 3 above apply (a stored id with invalid UTF-8 bytes is kept as it is); limit 4 applies to the sort of names.
Json loadTree(Storage& storage, const MakeId& makeId);
// true if the text was written; false if the storage refused (nothing changes then, in memory and on the disk).
bool saveTree(Storage& storage, const Json& tree);

} // namespace btg::detail
