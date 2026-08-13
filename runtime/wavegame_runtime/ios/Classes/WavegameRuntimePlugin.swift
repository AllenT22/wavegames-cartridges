import Flutter
import Foundation
import UIKit
import UniformTypeIdentifiers

public final class WavegameRuntimePlugin: NSObject, FlutterPlugin,
  UIDocumentPickerDelegate
{
  private static let controlChannel = "com.wavegames.wavegame_runtime/control"
  private static let viewType = "com.wavegames.wavegame_runtime/view"
  private static let maximumImportBytes: Int64 = 25 * 1024 * 1024

  private let channel: FlutterMethodChannel
  private let registry: RuntimeRegistry
  private var pendingImportResult: FlutterResult?

  private init(channel: FlutterMethodChannel, registry: RuntimeRegistry) {
    self.channel = channel
    self.registry = registry
    super.init()
  }

  public static func register(with registrar: FlutterPluginRegistrar) {
    let channel = FlutterMethodChannel(
      name: controlChannel,
      binaryMessenger: registrar.messenger()
    )
    let registry = RuntimeRegistry(channel: channel)
    let plugin = WavegameRuntimePlugin(channel: channel, registry: registry)
    registrar.addMethodCallDelegate(plugin, channel: channel)
    registrar.register(
      WavegamePlatformViewFactory(registry: registry),
      withId: viewType
    )
  }

  public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    do {
      switch call.method {
      case "pickDocument":
        try pickDocument(result: result)
      case "getSupportDirectory":
        result(try supportDirectory().path)
      case "dispatch":
        try registry.dispatch(arguments: call.arguments)
        result(nil)
      case "createRules":
        try registry.createRules(arguments: call.arguments)
        result(nil)
      case "invokeRules":
        try registry.invokeRules(arguments: call.arguments)
        result(nil)
      case "destroy":
        try registry.destroy(arguments: call.arguments)
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    } catch {
      result(
        FlutterError(
          code: "wavegame_runtime_error",
          message: error.localizedDescription,
          details: nil
        )
      )
    }
  }

  private func pickDocument(result: @escaping FlutterResult) throws {
    guard pendingImportResult == nil else {
      throw RuntimeFailure.invalidArgument("Another document picker is already open")
    }
    guard let presenter = Self.topViewController() else {
      throw RuntimeFailure.inactive("A foreground view controller is required")
    }
    var types: [UTType] = [.data, .archive]
    if let wavegame = UTType(filenameExtension: "wavegame") {
      types.insert(wavegame, at: 0)
    }
    let picker = UIDocumentPickerViewController(
      forOpeningContentTypes: types,
      asCopy: true
    )
    picker.delegate = self
    picker.allowsMultipleSelection = false
    pendingImportResult = result
    presenter.present(picker, animated: true)
  }

  public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let result = pendingImportResult
    pendingImportResult = nil
    result?(nil)
  }

  public func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    guard let result = pendingImportResult else { return }
    pendingImportResult = nil
    guard urls.count == 1, let source = urls.first else {
      result(
        FlutterError(
          code: "missing_document",
          message: "The document picker returned no file",
          details: nil
        )
      )
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        let imported = try self.copyImport(from: source)
        DispatchQueue.main.async { result(imported) }
      } catch {
        DispatchQueue.main.async {
          result(
            FlutterError(
              code: "import_failed",
              message: error.localizedDescription,
              details: nil
            )
          )
        }
      }
    }
  }

  private func copyImport(from source: URL) throws -> [String: Any] {
    let displayName = source.lastPathComponent
    guard displayName.lowercased().hasSuffix(".wavegame") else {
      throw RuntimeFailure.invalidArgument("Select a file whose name ends in .wavegame")
    }
    let didAccess = source.startAccessingSecurityScopedResource()
    defer {
      if didAccess { source.stopAccessingSecurityScopedResource() }
    }
    let values = try source.resourceValues(
      forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey]
    )
    guard values.isRegularFile == true, values.isSymbolicLink != true else {
      throw RuntimeFailure.invalidArgument("The selected document is not a regular file")
    }
    if let fileSize = values.fileSize, Int64(fileSize) > Self.maximumImportBytes {
      throw RuntimeFailure.invalidArgument("The selected cartridge exceeds 25 MiB")
    }

    let fileManager = FileManager.default
    let importDirectory = fileManager.urls(for: .cachesDirectory, in: .userDomainMask)[0]
      .appendingPathComponent("wavegame-imports", isDirectory: true)
    try fileManager.createDirectory(
      at: importDirectory,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    let destination = importDirectory
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("wavegame")
    guard fileManager.createFile(
      atPath: destination.path,
      contents: nil,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    ) else {
      throw RuntimeFailure.inactive("Could not create the private import copy")
    }

    var byteLength: Int64 = 0
    do {
      let input = try FileHandle(forReadingFrom: source)
      let output = try FileHandle(forWritingTo: destination)
      defer {
        try? input.close()
        try? output.close()
      }
      while let data = try input.read(upToCount: 64 * 1024), !data.isEmpty {
        byteLength += Int64(data.count)
        guard byteLength <= Self.maximumImportBytes else {
          throw RuntimeFailure.invalidArgument("The selected cartridge exceeds 25 MiB")
        }
        try output.write(contentsOf: data)
      }
      try output.synchronize()
      guard byteLength > 0 else {
        throw RuntimeFailure.invalidArgument("The selected cartridge is empty")
      }
    } catch {
      try? fileManager.removeItem(at: destination)
      throw error
    }
    return [
      "path": destination.path,
      "displayName": displayName,
      "byteLength": byteLength,
    ]
  }

  private func supportDirectory() throws -> URL {
    let fileManager = FileManager.default
    let root = try fileManager.url(
      for: .applicationSupportDirectory,
      in: .userDomainMask,
      appropriateFor: nil,
      create: true
    ).appendingPathComponent("WaveGames", isDirectory: true)
    let cartridges = root.appendingPathComponent("cartridges", isDirectory: true)
    try fileManager.createDirectory(
      at: cartridges,
      withIntermediateDirectories: true,
      attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
    )
    return root.resolvingSymlinksInPath().standardizedFileURL
  }

  private static func topViewController() -> UIViewController? {
    let root = UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)?
      .rootViewController
    var current = root
    while true {
      if let presented = current?.presentedViewController {
        current = presented
      } else if let navigation = current as? UINavigationController {
        current = navigation.visibleViewController
      } else if let tabs = current as? UITabBarController {
        current = tabs.selectedViewController
      } else {
        return current
      }
    }
  }
}
