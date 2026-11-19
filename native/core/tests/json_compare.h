#pragma once

// The comparison of the core with the web app, shared by the parity test and the logic test.
// "identical": every field equal, numbers bit for bit. "close": numbers within 1.5e-6 (one step of the
// rounding to six places). Anything else is a difference.
#include <nlohmann/json.hpp>

#include <algorithm>
#include <cmath>
#include <string>

namespace btg::test {

using json = nlohmann::json;

inline constexpr double TOLERANCE = 1.5e-6;
enum class Match { identical, close, different };

struct Compare {
    Match result = Match::identical;
    std::string field; // the field that differs, else the first one that is only close
    double delta = 0.0;

    void fail(const std::string& name) {
        if (result != Match::different) field = name;
        result = Match::different;
    }
    void value(const std::string& name, const json& want, const json& got) {
        if (want.is_number() && got.is_number()) {
            const double diff = std::fabs(want.get<double>() - got.get<double>());
            if (diff == 0.0) return;
            if (!(diff <= TOLERANCE)) return fail(name); // also a NaN
            if (result == Match::identical) { field = name; result = Match::close; }
            delta = std::max(delta, diff);
        } else if (want.is_object() && got.is_object()) {
            for (auto it = want.begin(); it != want.end(); ++it) {
                if (got.contains(it.key())) value(it.key(), it.value(), got[it.key()]);
                else fail(it.key());
            }
            for (auto it = got.begin(); it != got.end(); ++it) if (!want.contains(it.key())) fail(it.key());
        } else if (want.is_array() && got.is_array() && want.size() == got.size()) {
            for (size_t i = 0; i < want.size(); ++i) value(name, want[i], got[i]);
        } else if (want != got) fail(name);
    }
};

} // namespace btg::test
