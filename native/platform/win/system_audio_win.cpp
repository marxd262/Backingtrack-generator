// Windows: WASAPI loopback capture of the default output, and decoding through Media Foundation.
#include "btg_platform/system_audio.h"

#define NOMINMAX
#include <windows.h>

#include <audioclient.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mmdeviceapi.h>
#include <wrl/client.h>

#include <chrono>
#include <cstring>

using Microsoft::WRL::ComPtr;

namespace btg::platform {
namespace {

struct Com { // COM for this call; a thread that already has COM in another mode keeps it
    HRESULT result = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    ~Com() { if (SUCCEEDED(result)) CoUninitialize(); }
};

std::string failed(const char* what, HRESULT hr) {
    char text[160];
    std::snprintf(text, sizeof text, "%s failed (0x%08lx)", what, static_cast<unsigned long>(hr));
    return text;
}

} // namespace

Audio captureSystemAudio(double seconds) {
    Audio out;
    const Com com;
    ComPtr<IMMDeviceEnumerator> devices;
    ComPtr<IMMDevice> device;
    ComPtr<IAudioClient> client;
    ComPtr<IAudioCaptureClient> capture;
    WAVEFORMATEX* format = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL, IID_PPV_ARGS(&devices));
    if (SUCCEEDED(hr)) hr = devices->GetDefaultAudioEndpoint(eRender, eConsole, &device);
    if (SUCCEEDED(hr)) hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, &client);
    if (SUCCEEDED(hr)) hr = client->GetMixFormat(&format);
    // loopback: a capture stream on a render device, in the mix format of the system (shared mode)
    if (SUCCEEDED(hr)) hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 10000000, 0, format, nullptr);
    if (SUCCEEDED(hr)) hr = client->GetService(IID_PPV_ARGS(&capture));
    if (SUCCEEDED(hr)) hr = client->Start();
    if (FAILED(hr)) {
        out.error = failed("opening the loopback stream", hr);
        if (format) CoTaskMemFree(format);
        return out;
    }
    const bool isFloat = format->wFormatTag == WAVE_FORMAT_IEEE_FLOAT
        || (format->wFormatTag == WAVE_FORMAT_EXTENSIBLE && reinterpret_cast<WAVEFORMATEXTENSIBLE*>(format)->SubFormat == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
    if (!isFloat && format->wBitsPerSample != 16) out.error = "The system mixes in a sample format this capture does not read.";
    out.channels = format->nChannels;
    out.rate = format->nSamplesPerSec;
    const auto started = std::chrono::steady_clock::now();
    const size_t wanted = static_cast<size_t>(seconds * out.rate) * static_cast<size_t>(out.channels);
    // While nothing plays, Windows delivers no packets: the loop ends by the clock, not by the count.
    while (out.error.empty() && out.samples.size() < wanted && std::chrono::duration<double>(std::chrono::steady_clock::now() - started).count() < seconds + 0.5) {
        Sleep(10);
        UINT32 packet = 0;
        while (SUCCEEDED(capture->GetNextPacketSize(&packet)) && packet > 0) {
            BYTE* data = nullptr;
            UINT32 frames = 0;
            DWORD flags = 0;
            if (FAILED(capture->GetBuffer(&data, &frames, &flags, nullptr, nullptr))) break;
            const size_t count = static_cast<size_t>(frames) * static_cast<size_t>(out.channels), at = out.samples.size();
            out.samples.resize(at + count, 0.0f);
            if (!(flags & AUDCLNT_BUFFERFLAGS_SILENT)) {
                if (isFloat) std::memcpy(out.samples.data() + at, data, count * sizeof(float));
                else for (size_t i = 0; i < count; ++i) out.samples[at + i] = static_cast<float>(reinterpret_cast<const short*>(data)[i]) / 32768.0f;
            }
            capture->ReleaseBuffer(frames);
        }
    }
    client->Stop();
    CoTaskMemFree(format);
    return out;
}

Audio decodeWithSystem(const std::string& pathUtf8) {
    Audio out;
    const Com com;
    std::wstring path(static_cast<size_t>(MultiByteToWideChar(CP_UTF8, 0, pathUtf8.c_str(), -1, nullptr, 0)), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, pathUtf8.c_str(), -1, path.data(), static_cast<int>(path.size()));
    HRESULT hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) { out.error = failed("starting Media Foundation", hr); return out; }
    {
        ComPtr<IMFSourceReader> reader;
        ComPtr<IMFMediaType> wanted, actual;
        const DWORD stream = static_cast<DWORD>(MF_SOURCE_READER_FIRST_AUDIO_STREAM);
        hr = MFCreateSourceReaderFromURL(path.c_str(), nullptr, &reader);
        // ask the decoder for float PCM in the file's own rate and channels
        if (SUCCEEDED(hr)) hr = MFCreateMediaType(&wanted);
        if (SUCCEEDED(hr)) hr = wanted->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Audio);
        if (SUCCEEDED(hr)) hr = wanted->SetGUID(MF_MT_SUBTYPE, MFAudioFormat_Float);
        if (SUCCEEDED(hr)) hr = reader->SetCurrentMediaType(stream, nullptr, wanted.Get());
        if (SUCCEEDED(hr)) hr = reader->GetCurrentMediaType(stream, &actual);
        UINT32 channels = 0, rate = 0;
        if (SUCCEEDED(hr)) hr = actual->GetUINT32(MF_MT_AUDIO_NUM_CHANNELS, &channels);
        if (SUCCEEDED(hr)) hr = actual->GetUINT32(MF_MT_AUDIO_SAMPLES_PER_SECOND, &rate);
        while (SUCCEEDED(hr)) {
            DWORD flags = 0;
            ComPtr<IMFSample> sample;
            hr = reader->ReadSample(stream, 0, nullptr, &flags, nullptr, &sample);
            if (FAILED(hr) || (flags & MF_SOURCE_READERF_ENDOFSTREAM)) break;
            if (!sample) continue;
            ComPtr<IMFMediaBuffer> buffer;
            BYTE* data = nullptr;
            DWORD bytes = 0;
            if (FAILED(sample->ConvertToContiguousBuffer(&buffer)) || FAILED(buffer->Lock(&data, nullptr, &bytes))) continue;
            const auto* values = reinterpret_cast<const float*>(data);
            out.samples.insert(out.samples.end(), values, values + bytes / sizeof(float));
            buffer->Unlock();
        }
        if (FAILED(hr)) out.error = failed("decoding with Media Foundation", hr);
        else if (channels == 0 || out.samples.empty()) out.error = "Media Foundation found no audio in the file.";
        out.channels = static_cast<int>(channels);
        out.rate = rate;
    }
    MFShutdown();
    return out;
}

} // namespace btg::platform
