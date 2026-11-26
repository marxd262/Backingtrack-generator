// btg_desktop_run <desktop> <exe> [arguments...]: starts <exe> on the Windows desktop <desktop> (created if it does not exist), so that its
// windows do not appear on the user's desktop nor take the keyboard focus, waits for it and ends with its exit code. The process runs in a
// job that ends it and every process it started (the app's WebView2) when this program ends, also when it is killed (native/tests/ui/fixture.js).
// This program ends too when the process that started it ends, also when that one is killed: nothing stays behind unseen on the other desktop.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <tlhelp32.h>

#include <cstdio>
#include <string>

namespace {

// One argument as CommandLineToArgvW reads it back: as it is without space, tab or quote; else quoted, backslashes before a quote and at the end
// doubled, quotes escaped.
std::wstring quoted(const std::wstring& arg) {
    if (!arg.empty() && arg.find_first_of(L" \t\"") == std::wstring::npos) return arg;
    std::wstring out = L"\"";
    size_t backslashes = 0;
    for (const wchar_t c : arg) {
        if (c == L'\\') { ++backslashes; continue; }
        out.append(c == L'"' ? backslashes * 2 + 1 : backslashes, L'\\');
        backslashes = 0;
        out += c;
    }
    out.append(backslashes * 2, L'\\');
    return out + L"\"";
}

int fail(const char* what) {
    std::fprintf(stderr, "btg_desktop_run: %s failed (error %lu)\n", what, GetLastError());
    return 125;
}

// A handle to wait on for the process that started this one, or nullptr when it is gone: a process of its id created after this one is
// another that got the id again.
HANDLE openParent() {
    const DWORD self = GetCurrentProcessId();
    DWORD parent = 0;
    HANDLE snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (snap == INVALID_HANDLE_VALUE) return nullptr;
    PROCESSENTRY32W e {};
    e.dwSize = sizeof e;
    for (BOOL ok = Process32FirstW(snap, &e); ok; ok = Process32NextW(snap, &e)) {
        if (e.th32ProcessID == self) { parent = e.th32ParentProcessID; break; }
    }
    CloseHandle(snap);
    HANDLE h = parent ? OpenProcess(SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parent) : nullptr;
    FILETIME created {}, selfCreated {}, exited {}, kernel {}, user {};
    if (h && GetProcessTimes(h, &created, &exited, &kernel, &user) && GetProcessTimes(GetCurrentProcess(), &selfCreated, &exited, &kernel, &user)
        && CompareFileTime(&created, &selfCreated) > 0) {
        CloseHandle(h);
        return nullptr;
    }
    return h;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    if (argc < 3) {
        std::fprintf(stderr, "usage: btg_desktop_run <desktop> <exe> [arguments...]\n");
        return 125;
    }
    std::wstring desktop = argv[1];
    HANDLE parent = openParent();
    if (!parent) return fail("finding the process that started it");
    // CreateDesktopW opens the desktop of that name if it exists
    HDESK desk = CreateDesktopW(desktop.c_str(), nullptr, nullptr, 0, GENERIC_ALL, nullptr);
    if (!desk) return fail("CreateDesktopW");

    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (!job) return fail("CreateJobObjectW");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits {};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof limits)) return fail("SetInformationJobObject");

    std::wstring command = quoted(argv[2]);
    for (int i = 3; i < argc; ++i) command += L" " + quoted(argv[i]);
    STARTUPINFOW si {};
    si.cb = sizeof si;
    si.lpDesktop = desktop.data();
    PROCESS_INFORMATION pi {};
    // the environment is this program's (nullptr): the caller sets the app's variables on it
    if (!CreateProcessW(argv[2], command.data(), nullptr, nullptr, FALSE, CREATE_SUSPENDED, nullptr, nullptr, &si, &pi)) return fail("CreateProcessW");
    if (!AssignProcessToJobObject(job, pi.hProcess)) {
        const int failed = fail("AssignProcessToJobObject"); // its error, before TerminateProcess sets the last error anew
        TerminateProcess(pi.hProcess, 125);
        return failed;
    }
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    // the app ends, or the process that started this one: then closing the job ends the app
    const HANDLE ends[] = { pi.hProcess, parent };
    const bool parentEnded = WaitForMultipleObjects(2, ends, FALSE, INFINITE) == WAIT_OBJECT_0 + 1;
    CloseHandle(job); // ends what is left running in it (after the app's own end its WebView2 ends with it anyway)
    DWORD code = 125;
    if (!parentEnded) GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    CloseHandle(parent);
    CloseDesktop(desk);
    return static_cast<int>(code);
}
