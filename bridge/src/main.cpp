#include <ableton/Link.hpp>
#include <RtMidi.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cmath>
#include <csignal>
#include <cstdint>
#include <cstdlib>
#include <fstream>
#include <functional>
#include <iomanip>
#include <iostream>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>

namespace {

using namespace std::chrono_literals;

std::atomic<bool> running{true};

struct Options {
  bool link = true;
  bool midi = true;
  bool listMidi = false;
  bool selfTestMidi = false;
  bool startStopSync = true;
  double initialTempo = 120.0;
  double quantum = 4.0;
  int clockHz = 20;
  std::optional<unsigned int> midiPort;
  std::optional<std::string> midiPortName;
  std::string virtualMidiName = "Video Sync Rekordbox MIDI";
  std::string mapPath;
  std::string recordPath;
  std::optional<int> runForMs;
};

enum class MidiValueMode { Button, Cc7, Cc14 };

struct MidiMapping {
  std::string event;
  unsigned int status = 0;
  unsigned int data1 = 0;
  int deck = 0;
  MidiValueMode valueMode = MidiValueMode::Button;
  unsigned int mostSignificantValue = 0;
  bool hasMostSignificantValue = false;
};

std::string jsonEscape(const std::string& value) {
  std::ostringstream output;
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20) {
          output << "\\u" << std::hex << std::setw(4) << std::setfill('0')
                 << static_cast<int>(character) << std::dec;
        } else {
          output << character;
        }
    }
  }
  return output.str();
}

std::int64_t steadyMicros() {
  return std::chrono::duration_cast<std::chrono::microseconds>(
    std::chrono::steady_clock::now().time_since_epoch()).count();
}

std::int64_t unixMillis() {
  return std::chrono::duration_cast<std::chrono::milliseconds>(
    std::chrono::system_clock::now().time_since_epoch()).count();
}

class JsonEmitter {
public:
  explicit JsonEmitter(const std::string& recordPath) {
    if (!recordPath.empty()) {
      record_.open(recordPath, std::ios::out | std::ios::app);
      if (!record_) throw std::runtime_error("could not open record path: " + recordPath);
    }
  }

  void emit(const std::string& source,
            const std::string& type,
            const std::string& payload,
            std::int64_t sourceTimeUs = steadyMicros(),
            bool writeRecord = true) {
    std::lock_guard lock(mutex_);
    std::ostringstream line;
    line << "{\"v\":1,\"seq\":" << sequence_.fetch_add(1)
         << ",\"sourceTimeUs\":" << sourceTimeUs
         << ",\"emittedAtUnixMs\":" << unixMillis()
         << ",\"source\":\"" << jsonEscape(source)
         << "\",\"type\":\"" << jsonEscape(type)
         << "\",\"payload\":" << payload << "}";
    std::cout << line.str() << '\n' << std::flush;
    if (record_ && writeRecord) record_ << line.str() << '\n' << std::flush;
  }

private:
  std::atomic<std::uint64_t> sequence_{1};
  std::mutex mutex_;
  std::ofstream record_;
};

unsigned int parseByte(const std::string& value) {
  std::size_t parsed = 0;
  const unsigned long number = std::stoul(value, &parsed, 0);
  if (parsed != value.size() || number > 255) throw std::runtime_error("invalid MIDI byte: " + value);
  return static_cast<unsigned int>(number);
}

std::vector<std::string> splitCsv(const std::string& line) {
  std::vector<std::string> fields;
  std::stringstream stream(line);
  std::string field;
  while (std::getline(stream, field, ',')) fields.push_back(field);
  return fields;
}

MidiValueMode parseValueMode(const std::string& value) {
  if (value.empty() || value == "button") return MidiValueMode::Button;
  if (value == "cc7") return MidiValueMode::Cc7;
  if (value == "cc14") return MidiValueMode::Cc14;
  throw std::runtime_error("invalid MIDI value mode: " + value);
}

std::vector<MidiMapping> loadMappings(const std::string& path) {
  std::vector<MidiMapping> mappings;
  if (path.empty()) return mappings;
  std::ifstream input(path);
  if (!input) throw std::runtime_error("could not open MIDI map: " + path);
  std::string line;
  int lineNumber = 0;
  while (std::getline(input, line)) {
    ++lineNumber;
    if (line.empty() || line.front() == '#') continue;
    const auto fields = splitCsv(line);
    if (fields.size() != 4 && fields.size() != 5) {
      throw std::runtime_error("MIDI map line " + std::to_string(lineNumber) + " must have four or five fields");
    }
    const auto mode = fields.size() == 5 ? parseValueMode(fields[4]) : MidiValueMode::Button;
    const auto data1 = parseByte(fields[2]);
    if (mode == MidiValueMode::Cc14 && data1 > 95) {
      throw std::runtime_error("MIDI map line " + std::to_string(lineNumber) + " has no room for a CC14 LSB at data1 + 32");
    }
    mappings.push_back({fields[0], parseByte(fields[1]), data1, std::stoi(fields[3]), mode});
  }
  return mappings;
}

std::string midiKind(const std::vector<unsigned char>& message) {
  if (message.empty()) return "empty";
  switch (message[0] & 0xF0) {
    case 0x80: return "note-off";
    case 0x90: return message.size() > 2 && message[2] == 0 ? "note-off" : "note-on";
    case 0xB0: return "control-change";
    case 0xC0: return "program-change";
    case 0xE0: return "pitch-bend";
    default: return "system-or-other";
  }
}

struct MidiContext {
  JsonEmitter* emitter = nullptr;
  std::vector<MidiMapping>* mappings = nullptr;
};

void midiCallback(double deltaSeconds, std::vector<unsigned char>* message, void* userData) {
  if (!message || message->empty() || !userData) return;
  auto& context = *static_cast<MidiContext*>(userData);
  std::ostringstream bytes;
  bytes << '[';
  for (std::size_t index = 0; index < message->size(); ++index) {
    if (index) bytes << ',';
    bytes << static_cast<unsigned int>(message->at(index));
  }
  bytes << ']';
  const unsigned int status = message->at(0);
  const unsigned int data1 = message->size() > 1 ? message->at(1) : 0;
  const unsigned int value = message->size() > 2 ? message->at(2) : 0;
  std::ostringstream payload;
  payload << "{\"deltaSeconds\":" << std::fixed << std::setprecision(6) << deltaSeconds
          << ",\"kind\":\"" << midiKind(*message) << "\",\"status\":" << status
          << ",\"channel\":" << ((status & 0x0F) + 1)
          << ",\"data1\":" << data1 << ",\"value\":" << value
          << ",\"bytes\":" << bytes.str() << '}';
  context.emitter->emit("controller-midi", "midi.raw", payload.str());

  for (auto& mapping : *context.mappings) {
    if (mapping.status != status) continue;

    unsigned int rawValue = value;
    unsigned int resolutionBits = 7;
    if (mapping.valueMode == MidiValueMode::Cc14) {
      if (data1 == mapping.data1) {
        mapping.mostSignificantValue = value;
        mapping.hasMostSignificantValue = true;
        continue;
      }
      if (data1 != mapping.data1 + 32 || !mapping.hasMostSignificantValue) continue;
      rawValue = (mapping.mostSignificantValue << 7) | value;
      resolutionBits = 14;
    } else if (mapping.data1 != data1) {
      continue;
    }

    const double normalizedValue = static_cast<double>(rawValue) /
      static_cast<double>(resolutionBits == 14 ? 16383 : 127);
    std::ostringstream normalized;
    normalized << "{\"event\":\"" << jsonEscape(mapping.event) << "\",\"deck\":" << mapping.deck
               << ",\"value\":" << std::fixed << std::setprecision(6) << normalizedValue
               << ",\"rawValue\":" << rawValue << ",\"resolutionBits\":" << resolutionBits
               << ",\"active\":" << (rawValue > 0 ? "true" : "false") << '}';
    context.emitter->emit("controller-midi", "controller.control", normalized.str());
  }
}

std::string lowercase(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](const unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return value;
}

unsigned int findMidiInputByName(RtMidiIn& input, const std::string& requestedName) {
  const auto requestedLower = lowercase(requestedName);
  std::optional<unsigned int> partialMatch;
  std::ostringstream available;
  for (unsigned int index = 0; index < input.getPortCount(); ++index) {
    const auto name = input.getPortName(index);
    if (index) available << ", ";
    available << index << ":" << name;
    if (name == requestedName) return index;
    if (!partialMatch && lowercase(name).find(requestedLower) != std::string::npos) partialMatch = index;
  }
  if (partialMatch) return *partialMatch;
  throw std::runtime_error("MIDI input containing '" + requestedName + "' not found; available: " + available.str());
}

void printHelp() {
  std::cout
    << "video-sync-bridge [options]\n"
    << "  --no-link                     Disable Ableton Link\n"
    << "  --no-midi                     Disable Rekordbox MIDI input\n"
    << "  --midi-port N                 Open an existing MIDI input instead of a virtual port\n"
    << "  --midi-port-name NAME         Open the matching existing MIDI input (exact or substring)\n"
    << "  --virtual-midi NAME           Virtual input name (macOS/Linux; default: Video Sync Rekordbox MIDI)\n"
    << "  --map PATH                    CSV map: event,status,data1,deck\n"
    << "  --record PATH                 Append JSON Lines to a recording\n"
    << "  --clock-hz N                  Link snapshot frequency (default: 20)\n"
    << "  --quantum N                   Link phase quantum in beats (default: 4)\n"
    << "  --initial-tempo BPM           Local tempo before joining peers (default: 120)\n"
    << "  --no-start-stop-sync          Do not observe shared Link start/stop intent\n"
    << "  --list-midi                   List visible MIDI inputs and outputs, then exit\n"
    << "  --self-test-midi              Send two messages through the virtual port\n"
    << "  --run-for-ms N                Exit after N milliseconds (useful for tests)\n"
    << "  --help                        Show this help\n";
}

Options parseOptions(int argc, char** argv) {
  Options options;
  auto valueAfter = [&](int& index, const std::string& flag) -> std::string {
    if (++index >= argc) throw std::runtime_error(flag + " requires a value");
    return argv[index];
  };
  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--help") { printHelp(); std::exit(0); }
    else if (argument == "--no-link") options.link = false;
    else if (argument == "--no-midi") options.midi = false;
    else if (argument == "--list-midi") options.listMidi = true;
    else if (argument == "--self-test-midi") options.selfTestMidi = true;
    else if (argument == "--no-start-stop-sync") options.startStopSync = false;
    else if (argument == "--midi-port") options.midiPort = static_cast<unsigned int>(std::stoul(valueAfter(index, argument)));
    else if (argument == "--midi-port-name") options.midiPortName = valueAfter(index, argument);
    else if (argument == "--virtual-midi") options.virtualMidiName = valueAfter(index, argument);
    else if (argument == "--map") options.mapPath = valueAfter(index, argument);
    else if (argument == "--record") options.recordPath = valueAfter(index, argument);
    else if (argument == "--clock-hz") options.clockHz = std::stoi(valueAfter(index, argument));
    else if (argument == "--quantum") options.quantum = std::stod(valueAfter(index, argument));
    else if (argument == "--initial-tempo") options.initialTempo = std::stod(valueAfter(index, argument));
    else if (argument == "--run-for-ms") options.runForMs = std::stoi(valueAfter(index, argument));
    else throw std::runtime_error("unknown option: " + argument);
  }
  if (options.clockHz <= 0 || options.quantum <= 0 || options.initialTempo <= 0) {
    throw std::runtime_error("clock-hz, quantum, and initial-tempo must be positive");
  }
  if (options.midiPort && options.midiPortName) throw std::runtime_error("choose either --midi-port or --midi-port-name, not both");
  return options;
}

void listMidi(JsonEmitter& emitter) {
  RtMidiIn input;
  RtMidiOut output;
  std::ostringstream inputs;
  inputs << "{\"direction\":\"input\",\"ports\":[";
  for (unsigned int index = 0; index < input.getPortCount(); ++index) {
    if (index) inputs << ',';
    inputs << "{\"index\":" << index << ",\"name\":\"" << jsonEscape(input.getPortName(index)) << "\"}";
  }
  inputs << "]}";
  emitter.emit("midi", "midi.ports", inputs.str());
  std::ostringstream outputs;
  outputs << "{\"direction\":\"output\",\"ports\":[";
  for (unsigned int index = 0; index < output.getPortCount(); ++index) {
    if (index) outputs << ',';
    outputs << "{\"index\":" << index << ",\"name\":\"" << jsonEscape(output.getPortName(index)) << "\"}";
  }
  outputs << "]}";
  emitter.emit("midi", "midi.ports", outputs.str());
}

void sendMidiSelfTest(const std::string& virtualPortName, JsonEmitter& emitter) {
  std::this_thread::sleep_for(150ms);
  try {
    RtMidiOut output;
    std::optional<unsigned int> matchingPort;
    for (unsigned int index = 0; index < output.getPortCount(); ++index) {
      if (output.getPortName(index).find(virtualPortName) != std::string::npos) {
        matchingPort = index;
        break;
      }
    }
    if (!matchingPort) {
      emitter.emit("bridge", "bridge.self-test", "{\"midi\":\"failed\",\"reason\":\"virtual port not visible as an output\"}");
      return;
    }
    output.openPort(*matchingPort, "Video Sync MIDI self-test sender");
    std::vector<std::vector<unsigned char>> messages{
      {0x90, 0x0B, 0x7F}, {0x90, 0x0B, 0x00},
      {0x97, 0x00, 0x7F}, {0x97, 0x00, 0x00},
      {0xB6, 0x1F, 0x40}, {0xB6, 0x3F, 0x00},
    };
    for (auto& message : messages) {
      output.sendMessage(&message);
      std::this_thread::sleep_for(10ms);
    }
    emitter.emit("bridge", "bridge.self-test", "{\"midi\":\"sent\",\"messages\":6}");
  } catch (const RtMidiError& error) {
    emitter.emit("bridge", "bridge.self-test", "{\"midi\":\"failed\",\"reason\":\"" + jsonEscape(error.getMessage()) + "\"}");
  }
}

void signalHandler(int) {
  running = false;
}

} // namespace

int main(int argc, char** argv) {
  try {
    const Options options = parseOptions(argc, argv);
#if defined(_WIN32)
    if (options.midi && !options.midiPort) {
      throw std::runtime_error("Windows requires an existing loopback MIDI input selected with --midi-port N");
    }
#endif
    JsonEmitter emitter(options.recordPath);
    auto mappings = loadMappings(options.mapPath);

    if (options.listMidi) {
      listMidi(emitter);
      return 0;
    }

    std::signal(SIGINT, signalHandler);
    std::signal(SIGTERM, signalHandler);

    std::unique_ptr<ableton::Link> link;
    if (options.link) {
      link = std::make_unique<ableton::Link>(options.initialTempo);
      link->enableStartStopSync(options.startStopSync);
      link->enable(true);
    }

    MidiContext midiContext{&emitter, &mappings};
    std::unique_ptr<RtMidiIn> midiInput;
    std::string activeMidiPortName;
    if (options.midi) {
      midiInput = std::make_unique<RtMidiIn>();
      midiInput->setCallback(midiCallback, &midiContext);
      midiInput->ignoreTypes(false, false, false);
      if (options.midiPort || options.midiPortName) {
        const auto selectedPort = options.midiPort
          ? *options.midiPort
          : findMidiInputByName(*midiInput, *options.midiPortName);
        if (selectedPort >= midiInput->getPortCount()) throw std::runtime_error("MIDI input port index is out of range");
        activeMidiPortName = midiInput->getPortName(selectedPort);
        midiInput->openPort(selectedPort, "Video Sync controller MIDI input");
      } else {
        activeMidiPortName = options.virtualMidiName;
        midiInput->openVirtualPort(options.virtualMidiName);
      }
    }

    std::ostringstream startup;
    startup << "{\"link\":" << (options.link ? "true" : "false")
            << ",\"linkReadOnly\":true,\"startStopObserved\":" << (options.startStopSync ? "true" : "false")
            << ",\"midi\":" << (options.midi ? "true" : "false")
            << ",\"midiMode\":\"" << (options.midiPort || options.midiPortName ? "existing-port" : "virtual-input")
            << "\",\"midiPortName\":\"" << jsonEscape(activeMidiPortName)
            << "\",\"virtualMidiName\":\"" << jsonEscape(options.virtualMidiName)
            << "\",\"mappings\":" << mappings.size() << '}';
    emitter.emit("bridge", "bridge.ready", startup.str());

    std::thread selfTestThread;
    if (options.selfTestMidi && options.midi && !options.midiPort && !options.midiPortName) {
      selfTestThread = std::thread(sendMidiSelfTest, options.virtualMidiName, std::ref(emitter));
    }

    const auto startedAt = std::chrono::steady_clock::now();
    const auto interval = std::chrono::microseconds(1'000'000 / options.clockHz);
    std::optional<double> lastRecordedTempo;
    std::optional<std::size_t> lastRecordedPeers;
    std::optional<bool> lastRecordedPlaying;
    auto lastRecordedClockAt = startedAt - 5s;
    while (running) {
      const auto frameStarted = std::chrono::steady_clock::now();
      if (link) {
        const auto time = link->clock().micros();
        const auto state = link->captureAppSessionState();
        const auto peers = link->numPeers();
        const auto playing = state.isPlaying();
        std::ostringstream payload;
        payload << std::fixed << std::setprecision(6)
                << "{\"tempo\":" << state.tempo()
                << ",\"beat\":" << state.beatAtTime(time, options.quantum)
                << ",\"phase\":" << state.phaseAtTime(time, options.quantum)
                << ",\"quantum\":" << options.quantum
                << ",\"playing\":" << (playing ? "true" : "false")
                << ",\"peers\":" << peers << '}';
        const bool linkStateChanged = !lastRecordedTempo || !lastRecordedPeers || !lastRecordedPlaying ||
          std::abs(state.tempo() - *lastRecordedTempo) > 0.001 || peers != *lastRecordedPeers || playing != *lastRecordedPlaying;
        const bool linkHeartbeatDue = frameStarted - lastRecordedClockAt >= 5s;
        const bool recordClock = linkStateChanged || linkHeartbeatDue;
        if (recordClock) {
          lastRecordedTempo = state.tempo();
          lastRecordedPeers = peers;
          lastRecordedPlaying = playing;
          lastRecordedClockAt = frameStarted;
        }
        emitter.emit("ableton-link", "link.clock", payload.str(), time.count(), recordClock);
      }
      if (options.runForMs && std::chrono::steady_clock::now() - startedAt >= std::chrono::milliseconds(*options.runForMs)) {
        running = false;
      }
      std::this_thread::sleep_until(frameStarted + interval);
    }

    if (selfTestThread.joinable()) selfTestThread.join();
    emitter.emit("bridge", "bridge.stopped", "{}");
    return 0;
  } catch (const RtMidiError& error) {
    std::cerr << "MIDI error: " << error.getMessage() << '\n';
  } catch (const std::exception& error) {
    std::cerr << "Bridge error: " << error.what() << '\n';
  }
  return 1;
}
