import Flutter
import UIKit

final class WavegamePlatformViewFactory: NSObject, FlutterPlatformViewFactory {
  private let registry: RuntimeRegistry

  init(registry: RuntimeRegistry) {
    self.registry = registry
  }

  func create(
    withFrame frame: CGRect,
    viewIdentifier viewId: Int64,
    arguments args: Any?
  ) -> FlutterPlatformView {
    do {
      let values = try RuntimeRegistry.argumentMap(args)
      let runtime = try SandboxedWebViewRuntime(
        registry: registry,
        runtimeId: try RuntimeRegistry.requiredString(values, "runtimeId"),
        channelToken: try RuntimeRegistry.requiredString(values, "channelToken"),
        installedDirectory: try RuntimeRegistry.requiredString(values, "installedDirectory"),
        entrypoint: try RuntimeRegistry.requiredString(values, "entrypoint"),
        maximumEnvelopeBytes: try RuntimeRegistry.requiredInt(values, "maximumEnvelopeBytes"),
        mode: .visible,
        watchdogMilliseconds: 250,
        allowAudio: values["allowAudio"] as? Bool ?? false
      )
      try registry.register(runtime)
      runtime.startVisible()
      return WavegamePlatformView(runtime: runtime, frame: frame)
    } catch {
      return FailedWavegamePlatformView(frame: frame, message: error.localizedDescription)
    }
  }

  func createArgsCodec() -> FlutterMessageCodec & NSObjectProtocol {
    FlutterStandardMessageCodec.sharedInstance()
  }
}

private final class WavegamePlatformView: NSObject, FlutterPlatformView {
  private let runtime: SandboxedWebViewRuntime

  init(runtime: SandboxedWebViewRuntime, frame: CGRect) {
    self.runtime = runtime
    super.init()
    runtime.view.frame = frame
  }

  func view() -> UIView { runtime.view }

  deinit {
    runtime.destroy(state: "disposed", detail: nil, notify: false)
  }
}

private final class FailedWavegamePlatformView: NSObject, FlutterPlatformView {
  private let label: UILabel

  init(frame: CGRect, message: String) {
    label = UILabel(frame: frame)
    label.text = "WaveGames runtime error: \(message)"
    label.numberOfLines = 0
    label.textAlignment = .center
    super.init()
  }

  func view() -> UIView { label }
}
