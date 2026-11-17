#pragma once

#include <complex>
#include <vector>

namespace btg {

// In-place radix-2 FFT; the size must be a power of two.
inline void fft(std::vector<std::complex<double>>& a) {
    const double pi = 3.141592653589793;
    const size_t n = a.size();
    for (size_t i = 1, j = 0; i < n; ++i) {
        size_t bit = n >> 1;
        for (; j & bit; bit >>= 1) j ^= bit;
        j ^= bit;
        if (i < j) std::swap(a[i], a[j]);
    }
    for (size_t len = 2; len <= n; len <<= 1) {
        const std::complex<double> w = std::polar(1.0, -2 * pi / static_cast<double>(len));
        for (size_t i = 0; i < n; i += len) {
            std::complex<double> x = 1.0;
            for (size_t k = 0; k < len / 2; ++k, x *= w) {
                const auto u = a[i + k], v = a[i + k + len / 2] * x;
                a[i + k] = u + v;
                a[i + k + len / 2] = u - v;
            }
        }
    }
}

} // namespace btg
