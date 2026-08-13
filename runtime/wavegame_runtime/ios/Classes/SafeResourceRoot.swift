import Foundation

final class SafeResourceRoot {
  static let scheme = "wavegame"
  static let host = "cartridge"

  let root: URL

  init(path: String) throws {
    guard path.hasPrefix("/") else {
      throw RuntimeFailure.invalidArgument("Installed directory must be absolute")
    }
    let requested = URL(fileURLWithPath: path, isDirectory: true)
    let values = try requested.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
    guard values.isDirectory == true, values.isSymbolicLink != true else {
      throw RuntimeFailure.invalidArgument("Installed directory is missing or is a symbolic link")
    }
    root = requested.resolvingSymlinksInPath().standardizedFileURL
  }

  func resolve(url: URL) -> URL? {
    guard url.scheme == Self.scheme, url.host == Self.host,
      url.query == nil, url.fragment == nil
    else { return nil }
    return resolve(relativePath: url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
  }

  func resolve(relativePath: String) -> URL? {
    guard Self.isSafeRelativePath(relativePath) else { return nil }
    var candidate = root
    for component in relativePath.split(separator: "/", omittingEmptySubsequences: false) {
      candidate.appendPathComponent(String(component), isDirectory: false)
      guard let values = try? candidate.resourceValues(forKeys: [.isSymbolicLinkKey]),
        values.isSymbolicLink != true
      else { return nil }
    }
    candidate = candidate.resolvingSymlinksInPath().standardizedFileURL
    guard candidate.path.hasPrefix(root.path + "/") else { return nil }
    guard let values = try? candidate.resourceValues(
      forKeys: [.isRegularFileKey, .isSymbolicLinkKey]
    ), values.isRegularFile == true, values.isSymbolicLink != true
    else { return nil }
    return candidate
  }

  static func isSafeRelativePath(_ value: String) -> Bool {
    guard !value.isEmpty, !value.hasPrefix("/"), !value.contains("\\"),
      !value.unicodeScalars.contains(where: { $0.value == 0 })
    else { return false }
    return value.split(separator: "/", omittingEmptySubsequences: false).allSatisfy {
      !$0.isEmpty && $0 != "." && $0 != ".."
    }
  }
}

enum RuntimeFailure: Error, LocalizedError {
  case invalidArgument(String)
  case inactive(String)
  case bridge(String)

  var errorDescription: String? {
    switch self {
    case .invalidArgument(let message), .inactive(let message), .bridge(let message): return message
    }
  }
}
