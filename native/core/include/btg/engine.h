#pragma once

#include "btg/transport.h"

#include <functional>
#include <memory>
#include <string>

namespace btg {

struct Pack;

// Plays the generator's events of all six layers with the voices chosen for them (sample voices and the synth voices: the classic synth,
// the e-piano, the organ, the synth kit and percussion, the string model), the distortion chain, vibrato and chorus of bass, chords, pad and lead, a mixer, the web app's sends (reverb, shared room, echo) and its sum (brightness shelf,
// bus compressor and limiter, both after Chromium's DynamicsCompressor, no clamp at the output). The position comes in from outside
// (Transport::Block), so the same engine runs under the app's own transport, in an offline render and later under a host's play head.
class Engine {
public:
    enum Layer { drums, bass, chords, pad, lead, percussion, layerCount };
    // Delivers the sample pack with this id ("bass-finger"); throws std::exception with the reason when it cannot. The shell
    // fills it (the app: files of the repository), so the core reads no files. Called on the control thread only.
    using PackSource = std::function<std::shared_ptr<const Pack>(const std::string& id)>;

    Engine();
    ~Engine();

    // Control calls: any thread (the app: its loader thread); they lock one another out and never wait for the audio thread.
    void setPackSource(PackSource source);         // before the first setTrack or setVoices
    // plays from the next block on. The track must be one that the web app's normalizeTrack wrote and validateTrack accepted (a later task
    // validates here). Throws like buildSong when the JSON is not a track at all (then nothing changes); an inconsistent track is not checked. Then setVoices with the track's "voices"
    // and every voice prepared for the song (the string voices compute its buffers here: about 0.1 s for a band track at 48 kHz), and the
    // song reaches the audio thread together with them. setVoices, setTuning, setSound and prepare compute them anew where they change what
    // a string voice's buffers depend on (its key, its params, the rate). Building or preparing a voice can throw (out of memory): then the
    // call changes nothing, here and on the audio side (only a pack it read stays in the engine's cache), and the caller catches it (the
    // shell's control()); the same holds for setVoices, setTuning and setSound.
    void setTrack(const std::string& trackJson);
    void setVoices(const std::string& voicesJson); // {"bass":{"id":"sample","variant":"pick"},...}; a layer not named keeps its voice. Reads the packs it does not have yet, here; until then the old voice plays. A pack that fails to read is reported in voiceStatus, not thrown; computing a string voice's buffers can still throw (out of memory): then nothing changes (setTrack), the caller catches it
    void setTuning(const std::string& tuningJson); // overrides of the fine values as setTuning of the web app ({"bass/sample/finger":{"level":3}}); replaces the earlier ones. Text that is no valid JSON or holds invalid values never throws and counts as the default; building a voice (or a convolver) can still throw (out of memory): then nothing changes (setTrack), the caller catches it
    void setSound(const std::string& timbreJson);  // the timbre of the web app's resolveTrackTimbre(track); what is missing or invalid counts as DEFAULT_TIMBRE; replaces the earlier one. Text that is no valid JSON or holds invalid values never throws and counts as DEFAULT_TIMBRE; building a voice (or a convolver) can still throw (out of memory): then nothing changes (setTrack), the caller catches it
    std::string voiceStatus() const;              // {"drums":"ready","bass":"error: bass-pick: <reason>","chords":"silent",...}, layers in enum order
    double lengthBeats() const;
    double bpm() const;      // of the track last set
    int beatsPerBar() const; // of its first bar

    // Any thread; they take effect in the next block.
    void setLevel(Layer layer, float fader); // fader position 0..1, gain is the square (as in the web mixer)
    void setMuted(Layer layer, bool muted);
    void setPan(Layer layer, float pan);     // -1 left .. 1 right; NaN: where the fine value mix/pan puts the layer (the default)
    void setMaster(float fader);
    void setLimiter(bool on);                // default on; off (for measuring): no bus compressor, no limiter (so no delay and no make-up), the sum only gets the master gain, the sends and the shelf
    float takePeak(int channel);             // a Layer, or layerCount for the output: peak since the last call
    int activeSynthTones() const;            // tests only, never while render runs (it reads the audio side): the synth tones that sound
    int busyOrganChains() const;             // tests only, as activeSynthTones: the organ chains with a tone or a tail to process
    int keptBuffers() const;                 // tests only, a control call: the sets of buffers of the string voices the control side keeps (a
                                             // voice or a ringing tone holds each; one that nothing holds is freed at the next publish)

    // Before rendering and never during it (JUCE prepareToPlay): builds what depends on the rate (the reverb's and the room's responses, the
    // synth voices' noise and the organ chains' delays, and at a new rate every voice again, with the same serials: the organ's waves are
    // per rate, up to about 5 ms per organ voice the first time at 96 kHz, 0.1 ms once its waves are cached; the string voices' buffers of
    // the song set, about 0.05 to 0.07 s per voice for a band track at 48 kHz), so it allocates, and it takes the control calls' lock: it
    // waits for a running one (up to about 1 s while a pack loads). A song set and not yet taken by the audio thread it hands over at once,
    // together with the setup prepared for it.
    void prepare(double sampleRate);
    // Audio thread: no lock that waits, no allocation.
    void render(float* left, float* right, int frames, const Transport::Block& block);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};

} // namespace btg
