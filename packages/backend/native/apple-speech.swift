import AVFoundation
import Foundation
import Speech

// Owned SDK helper. Speech stays on device; stdout is a newline-delimited JSON protocol.
func emit(_ event: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: event) {
        FileHandle.standardOutput.write(data + Data([10]))
    }
}

@main struct AppleSpeechCLI {
    static func main() async {
        do {
            if #available(macOS 26.0, *) { try await run() }
            else { throw failure("Apple speech recognition requires macOS 26 or later.") }
        } catch {
            emit(["type": "error", "message": error.localizedDescription])
            FileHandle.standardError.write(Data((error.localizedDescription + "\n").utf8))
            exit(1)
        }
    }

    static func failure(_ message: String) -> NSError {
        NSError(domain: "CodexAppSDK.Speech", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    @available(macOS 26.0, *) static func run() async throws {
        let args = CommandLine.arguments
        func option(_ key: String) -> String? {
            guard let i = args.firstIndex(of: key), i + 1 < args.count else { return nil }
            return args[i + 1]
        }
        guard SpeechTranscriber.isAvailable else { throw failure("On-device speech recognition is unavailable on this Mac.") }
        let requested = Locale(identifier: option("--locale") ?? Locale.current.identifier)
        guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: requested) else {
            throw failure("Speech recognition does not support \(requested.identifier).")
        }
        let streaming = args.contains("--stream")
        let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [],
                                           reportingOptions: streaming ? [.volatileResults] : [], attributeOptions: [])
        if let installation = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
            try await installation.downloadAndInstall()
        }
        let analyzer = SpeechAnalyzer(modules: [transcriber])
        let results = Task { () throws -> String in
            var finalText = ""
            for try await result in transcriber.results {
                let text = String(result.text.characters)
                if result.isFinal { finalText += text }
                if streaming {
                    emit(["type": "transcript", "finalText": finalText, "partialText": result.isFinal ? "" : text])
                }
            }
            return finalText.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        do {
            if streaming {
                guard let rate = Double(option("--sample-rate") ?? "16000"), (8000...96000).contains(rate),
                      let inputFormat = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
                      let format = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]),
                      let converter = AVAudioConverter(from: inputFormat, to: format) else {
                    throw failure("Unsupported speech audio format.")
                }
                try await analyzer.prepareToAnalyze(in: format)
                let (sequence, continuation) = AsyncThrowingStream<AnalyzerInput, Error>.makeStream()
                let reader = Task.detached {
                    do {
                        var pending = Data()
                        while let bytes = try FileHandle.standardInput.read(upToCount: 8192), !bytes.isEmpty {
                            pending.append(bytes)
                            let count = pending.count / 4
                            if count == 0 { continue }
                            let input = AVAudioPCMBuffer(pcmFormat: inputFormat, frameCapacity: AVAudioFrameCount(count))!
                            input.frameLength = AVAudioFrameCount(count)
                            pending.withUnsafeBytes { raw in
                                input.floatChannelData![0].update(from: raw.bindMemory(to: Float.self).baseAddress!, count: count)
                            }
                            pending.removeFirst(count * 4)
                            let capacity = AVAudioFrameCount(ceil(Double(count) * format.sampleRate / rate) + 32)
                            let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity)!
                            var supplied = false
                            var conversionError: NSError?
                            converter.convert(to: output, error: &conversionError) { _, status in
                                if supplied { status.pointee = .noDataNow; return nil }
                                supplied = true
                                status.pointee = .haveData
                                return input
                            }
                            if let conversionError { throw conversionError }
                            if output.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: output)) }
                        }
                        if !pending.isEmpty { throw failure("Incomplete PCM audio frame.") }
                        // Drain the converter's resampling tail before ending recognition.
                        let tail = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4096)!
                        var tailError: NSError?
                        converter.convert(to: tail, error: &tailError) { _, status in
                            status.pointee = .endOfStream
                            return nil
                        }
                        if let tailError { throw tailError }
                        if tail.frameLength > 0 { continuation.yield(AnalyzerInput(buffer: tail)) }
                        continuation.finish()
                    } catch { continuation.finish(throwing: error) }
                }
                emit(["type": "ready"])
                try await analyzer.start(inputSequence: sequence)
                await reader.value
                try await analyzer.finalizeAndFinishThroughEndOfInput()
            } else {
                guard let input = option("--input-audio-path"), let output = option("--output-txt-path") else {
                    throw failure("Use --stream --sample-rate <rate>, or --input-audio-path <file> --output-txt-path <file>.")
                }
                let file = try AVAudioFile(forReading: URL(fileURLWithPath: input))
                if let last = try await analyzer.analyzeSequence(from: file) {
                    try await analyzer.finalizeAndFinish(through: last)
                } else { await analyzer.cancelAndFinishNow() }
                try await results.value.write(toFile: output, atomically: true, encoding: .utf8)
                return
            }
            emit(["type": "done", "text": try await results.value])
        } catch {
            await analyzer.cancelAndFinishNow()
            results.cancel()
            throw error
        }
    }
}
