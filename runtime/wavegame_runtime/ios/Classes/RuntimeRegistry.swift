import Flutter
import Foundation

final class RuntimeRegistry {
  private let channel: FlutterMethodChannel
  private var runtimes: [String: SandboxedWebViewRuntime] = [:]

  init(channel: FlutterMethodChannel) {
    self.channel = channel
  }

  func register(_ runtime: SandboxedWebViewRuntime) throws {
    guard runtimes[runtime.runtimeId] == nil else {
      throw RuntimeFailure.invalidArgument("Runtime ID is already active")
    }
    runtimes[runtime.runtimeId] = runtime
  }

  func runtimeDestroyed(_ runtime: SandboxedWebViewRuntime) {
    if runtimes[runtime.runtimeId] === runtime {
      runtimes.removeValue(forKey: runtime.runtimeId)
    }
  }

  func emit(
    runtimeId: String,
    envelope: [String: Any?],
    completion: @escaping () -> Void = {}
  ) {
    DispatchQueue.main.async { [weak self] in
      guard let self else {
        completion()
        return
      }
      self.channel.invokeMethod(
        "runtimeEvent",
        arguments: ["runtimeId": runtimeId, "envelope": envelope],
        result: { _ in completion() }
      )
    }
  }

  func dispatch(arguments: Any?) throws {
    let args = try Self.argumentMap(arguments)
    let runtime = try requireRuntime(args)
    guard let envelope = args["envelope"] as? [String: Any?] else {
      throw RuntimeFailure.invalidArgument("Envelope is missing")
    }
    try runtime.dispatch(envelope: envelope)
  }

  func createRules(arguments: Any?) throws {
    let args = try Self.argumentMap(arguments)
    let runtimeId = try Self.requiredString(args, "runtimeId")
    guard runtimes[runtimeId] == nil else {
      throw RuntimeFailure.invalidArgument("Runtime ID is already active")
    }
    let runtime = try SandboxedWebViewRuntime(
      registry: self,
      runtimeId: runtimeId,
      channelToken: try Self.requiredString(args, "channelToken"),
      installedDirectory: try Self.requiredString(args, "installedDirectory"),
      entrypoint: try Self.requiredString(args, "entrypoint"),
      maximumEnvelopeBytes: try Self.requiredInt(args, "maximumEnvelopeBytes"),
      mode: .rules,
      watchdogMilliseconds: try Self.requiredInt(args, "watchdogMilliseconds"),
      allowAudio: false
    )
    try register(runtime)
    runtime.startRules()
  }

  func invokeRules(arguments: Any?) throws {
    let args = try Self.argumentMap(arguments)
    try requireRuntime(args).invokeRules(
      requestId: try Self.requiredString(args, "requestId"),
      function: try Self.requiredString(args, "function"),
      argument: args["argument"] ?? nil
    )
  }

  func destroy(arguments: Any?) throws {
    let args = try Self.argumentMap(arguments)
    let runtimeId = try Self.requiredString(args, "runtimeId")
    runtimes.removeValue(forKey: runtimeId)?.destroy(
      state: "disposed", detail: nil, notify: false
    )
  }

  func destroyAll() {
    let active = Array(runtimes.values)
    runtimes.removeAll()
    active.forEach { $0.destroy(state: "engineDetached", detail: nil, notify: false) }
  }

  private func requireRuntime(_ args: [String: Any?]) throws -> SandboxedWebViewRuntime {
    let runtimeId = try Self.requiredString(args, "runtimeId")
    guard let runtime = runtimes[runtimeId] else {
      throw RuntimeFailure.inactive("Runtime is not active")
    }
    return runtime
  }

  static func argumentMap(_ arguments: Any?) throws -> [String: Any?] {
    guard let values = arguments as? [String: Any?] else {
      throw RuntimeFailure.invalidArgument("Arguments must be a map")
    }
    return values
  }

  static func requiredString(_ args: [String: Any?], _ key: String) throws -> String {
    guard let value = args[key] as? String, !value.isEmpty else {
      throw RuntimeFailure.invalidArgument("\(key) is missing")
    }
    return value
  }

  static func requiredInt(_ args: [String: Any?], _ key: String) throws -> Int {
    if let value = args[key] as? Int { return value }
    if let value = args[key] as? NSNumber { return value.intValue }
    throw RuntimeFailure.invalidArgument("\(key) is missing")
  }
}
