#include "btg/file_player.h"

#include <signalsmith-stretch/signalsmith-stretch.h>

#include <atomic>
#include <cmath>
#include <mutex>

namespace btg {
namespace {

// The clip as the stretcher wants its input: buffer[channel][index], from a start frame, silence outside.
struct ClipInput {
    const AudioClip* clip;
    long long start;
    struct Channel {
        const AudioClip* clip;
        long long start;
        int channel;
        float operator[](int i) const {
            const long long frame = start + i, total = static_cast<long long>(clip->samples.size()) / clip->channels;
            return frame < 0 || frame >= total ? 0.0f : clip->samples[static_cast<size_t>(frame * clip->channels + channel)];
        }
    };
    Channel operator[](int channel) const { return { clip, start, std::min(channel, clip->channels - 1) }; }
};

} // namespace

struct FilePlayer::Impl {
    std::mutex swap;
    std::shared_ptr<const AudioClip> pending, retired, clip;
    std::atomic<bool> hasPending { false };
    std::atomic<float> gain { 1.0f }, peak { 0.0f };
    double sampleRate = 48000.0;
    double position = 0.0, step = 0.0; // in frames of the clip; step per output frame
    float level = 0.0f;
    signalsmith::stretch::SignalsmithStretch<float> stretch;
    bool stretching = false;
    double fed = 0.0;                   // clip frame up to which the stretcher has its input
};

FilePlayer::FilePlayer() : impl_(std::make_unique<Impl>()) {}
FilePlayer::~FilePlayer() = default;

void FilePlayer::setClip(std::shared_ptr<const AudioClip> clip) {
    std::shared_ptr<const AudioClip> old; // freed here, not on the audio thread
    const std::lock_guard<std::mutex> lock(impl_->swap);
    old = std::move(impl_->retired);
    impl_->pending = std::move(clip);
    impl_->hasPending = true;
}
void FilePlayer::setGain(float gain) { impl_->gain = gain; }
float FilePlayer::takePeak() { return impl_->peak.exchange(0.0f); }

void FilePlayer::prepare(double sampleRate) {
    impl_->sampleRate = sampleRate;
    impl_->stretch.presetDefault(2, static_cast<float>(sampleRate));
    impl_->stretching = false;
}

void FilePlayer::render(float* left, float* right, int frames, const Transport::Block& block) {
    Impl& m = *impl_;
    if (m.hasPending) {
        const std::unique_lock<std::mutex> lock(m.swap, std::try_to_lock);
        if (lock.owns_lock()) {
            m.retired = std::move(m.clip);
            m.clip = std::move(m.pending);
            m.hasPending = false;
            m.stretching = false;
        }
    }
    const AudioClip* clip = m.clip.get();
    const float fade = static_cast<float>(1 - std::exp(-1 / (0.005 * m.sampleRate))); // 5 ms in and out: no click at start, stop, jump
    const double speed = block.beatsPerFrame * m.sampleRate; // seconds of the track per second: 1 = as recorded
    bool jumped = false;
    if (block.playing && clip) {
        const double at = block.beats * clip->rate;
        jumped = std::fabs(at - m.position) > 2.0;
        if (jumped) m.level = 0.0f; // fade in at the new place
        m.position = at;
        m.step = block.beatsPerFrame * clip->rate;
    }
    const float target = block.playing ? m.gain.load() : 0.0f;
    float peak = 0.0f;

    if (block.playing && clip && std::fabs(speed - 1.0) > 0.005) {
        // Another speed at the same pitch. The stretcher hears the clip ahead of the transport by its own delay,
        // so what leaves now is the place the transport shows.
        const double ahead = m.stretch.inputLatency() + m.step * m.stretch.outputLatency();
        if (!m.stretching || jumped || std::fabs(m.fed - (m.position + ahead)) > 0.1 * clip->rate) {
            m.stretch.reset();
            m.stretch.setTransposeFactor(static_cast<float>(clip->rate / m.sampleRate)); // the clip's rate against the device's
            // Pre-roll, so the sound is there from the first frame: no hole at a start, a jump or a loop's wrap.
            const int lead = m.stretch.outputSeekLength(static_cast<float>(m.step));
            const long long from = static_cast<long long>(std::floor(m.position));
            m.stretch.outputSeek(ClipInput { clip, from }, lead);
            m.fed = static_cast<double>(from + lead);
            m.stretching = true;
        }
        const double end = m.position + ahead + frames * m.step;
        const int input = std::max(0, static_cast<int>(std::floor(end) - std::floor(m.fed)));
        float* outputs[2] = { left, right };
        m.stretch.process(ClipInput { clip, static_cast<long long>(std::floor(m.fed)) }, input, outputs, frames);
        m.fed = std::floor(m.fed) + input;
        for (int i = 0; i < frames; ++i) {
            m.level += fade * (target - m.level);
            left[i] *= m.level;
            right[i] *= m.level;
            peak = std::max(peak, std::max(std::fabs(left[i]), std::fabs(right[i])));
        }
        m.position += frames * m.step;
    } else {
        m.stretching = false;
        for (int i = 0; i < frames; ++i) {
            m.level += fade * (target - m.level);
            float l = 0.0f, r = 0.0f;
            if (clip && m.level > 1e-5f) {
                const long long index = static_cast<long long>(m.position);
                const long long total = static_cast<long long>(clip->samples.size()) / clip->channels;
                if (index >= 0 && index + 1 < total) {
                    const float frac = static_cast<float>(m.position - static_cast<double>(index));
                    const float* s = clip->samples.data() + index * clip->channels;
                    const int right1 = clip->channels > 1 ? 1 : 0;
                    l = (s[0] + (s[clip->channels] - s[0]) * frac) * m.level;
                    r = (s[right1] + (s[clip->channels + right1] - s[right1]) * frac) * m.level;
                }
                m.position += m.step; // also after a stop, for the fade-out
            }
            left[i] = l;
            right[i] = r;
            peak = std::max(peak, std::max(std::fabs(l), std::fabs(r)));
        }
    }
    if (peak > m.peak.load()) m.peak.store(peak);
}

} // namespace btg
