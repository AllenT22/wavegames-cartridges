import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

const String _channelName = 'com.wavegames.wavegame_runtime/control';
const String _viewType = 'com.wavegames.wavegame_runtime/view';

/// The hard upper bound accepted by both native JavaScript bridges.
const int wavegameMaximumEnvelopeBytes = 128 * 1024;

/// A cartridge copied out of the system document picker.
///
/// [path] points at a private cache copy. The caller must validate and install
/// it before use, and may delete it after the import transaction finishes.
@immutable
final class WavegameImport {
  const WavegameImport({
    required this.path,
    required this.displayName,
    required this.byteLength,
  });

  final String path;
  final String displayName;
  final int byteLength;

  static WavegameImport fromMap(Map<Object?, Object?> map) {
    final Object? path = map['path'];
    final Object? displayName = map['displayName'];
    final Object? byteLength = map['byteLength'];
    if (path is! String ||
        path.isEmpty ||
        displayName is! String ||
        displayName.isEmpty ||
        byteLength is! int ||
        byteLength < 0) {
      throw const FormatException('Native importer returned an invalid record');
    }
    return WavegameImport(
      path: path,
      displayName: displayName,
      byteLength: byteLength,
    );
  }
}

/// Opens the Android document picker or iOS Files picker and copies a selected
/// `.wavegame` package into private application cache.
abstract final class WavegameDocumentImporter {
  static Future<WavegameImport?> pick() async {
    final Object? value = await _RuntimeRouter.channel.invokeMethod<Object?>(
      'pickDocument',
    );
    if (value == null) return null;
    if (value is! Map<Object?, Object?>) {
      throw const FormatException('Native importer returned the wrong type');
    }
    return WavegameImport.fromMap(value);
  }
}

/// App-private persistent root reserved for WaveGames cartridge installation.
///
/// Native code creates both this directory and its `cartridges` child. Callers
/// cannot supply a path, which prevents the API becoming an arbitrary directory
/// creation primitive.
abstract final class WavegameStoragePaths {
  static Future<String> supportDirectory() async {
    final String? value = await _RuntimeRouter.channel.invokeMethod<String>(
      'getSupportDirectory',
    );
    if (value == null || value.isEmpty || !value.startsWith('/')) {
      throw const FileSystemException(
        'Native runtime returned an invalid support directory',
      );
    }
    return value;
  }
}

/// Events a cartridge is allowed to send to its host application.
sealed class WavegameRuntimeEvent {
  const WavegameRuntimeEvent();

  factory WavegameRuntimeEvent.fromEnvelope(Map<Object?, Object?> envelope) {
    final Object? type = envelope['type'];
    if (type is! String) {
      throw const FormatException('Runtime event type is missing');
    }
    final Object? payload = envelope['payload'];
    final Object? requestId = envelope['requestId'];
    return switch (type) {
      'ready' => WavegameReadyEvent(payload),
      'action' => WavegameActionEvent(
        payload,
        requestId: _optionalRequestId(requestId),
      ),
      'storage.get' ||
      'storage.set' ||
      'storage.remove' => WavegameStorageEvent(
        operation: type,
        requestId: _requiredRequestId(requestId),
        payload: payload,
      ),
      'log' => WavegameLogEvent.fromPayload(payload),
      'lifecycle' => WavegameLifecycleEvent.fromPayload(payload),
      _ => throw FormatException('Unsupported runtime event type: $type'),
    };
  }

  static String _requiredRequestId(Object? value) {
    if (value is String && value.isNotEmpty && value.length <= 128) {
      return value;
    }
    if (value is int && value >= 0) return value.toString();
    throw const FormatException('Storage event requestId is invalid');
  }

  static String? _optionalRequestId(Object? value) {
    if (value == null) return null;
    return _requiredRequestId(value);
  }
}

final class WavegameReadyEvent extends WavegameRuntimeEvent {
  const WavegameReadyEvent(this.details);
  final Object? details;
}

final class WavegameActionEvent extends WavegameRuntimeEvent {
  const WavegameActionEvent(this.action, {this.requestId});
  final Object? action;

  /// Correlates the action with an `action.result` host response.
  ///
  /// Older cartridges may omit this and remain fire-and-forget compatible.
  final String? requestId;
}

final class WavegameStorageEvent extends WavegameRuntimeEvent {
  const WavegameStorageEvent({
    required this.operation,
    required this.requestId,
    required this.payload,
  });

  final String operation;
  final String requestId;
  final Object? payload;
}

final class WavegameLogEvent extends WavegameRuntimeEvent {
  const WavegameLogEvent({required this.level, required this.message});

  final String level;
  final String message;

  static WavegameLogEvent fromPayload(Object? payload) {
    if (payload is! Map<Object?, Object?>) {
      throw const FormatException('Log event payload is invalid');
    }
    final Object? level = payload['level'];
    final Object? message = payload['message'];
    if (level is! String || message is! String || message.length > 4096) {
      throw const FormatException('Log event fields are invalid');
    }
    return WavegameLogEvent(level: level, message: message);
  }
}

final class WavegameLifecycleEvent extends WavegameRuntimeEvent {
  const WavegameLifecycleEvent({required this.state, this.detail});

  final String state;
  final String? detail;

  static WavegameLifecycleEvent fromPayload(Object? payload) {
    if (payload is! Map<Object?, Object?>) {
      throw const FormatException('Lifecycle event payload is invalid');
    }
    final Object? state = payload['state'];
    final Object? detail = payload['detail'];
    if (state is! String || (detail != null && detail is! String)) {
      throw const FormatException('Lifecycle event fields are invalid');
    }
    return WavegameLifecycleEvent(state: state, detail: detail as String?);
  }
}

/// A typed host-to-cartridge message.
@immutable
final class WavegameHostMessage {
  const WavegameHostMessage(this.type, [this.payload]) : assert(type != '');

  static const Set<String> allowedTypes = <String>{
    'session',
    'view',
    'roster',
    'status',
    'event',
    'storage.result',
    'action.result',
    'error',
  };

  final String type;
  final Object? payload;

  Map<String, Object?> toMap() {
    if (!allowedTypes.contains(type)) {
      throw ArgumentError.value(type, 'type', 'unsupported host message');
    }
    return <String, Object?>{'type': type, 'payload': payload};
  }
}

/// Controller for one visible cartridge UI runtime.
final class WavegameRuntimeController {
  WavegameRuntimeController({
    int maximumEnvelopeBytes = wavegameMaximumEnvelopeBytes,
  }) : runtimeId = _randomIdentifier('ui'),
       channelToken = _randomIdentifier('WaveGamesBridge'),
       maximumEnvelopeBytes = _validateEnvelopeLimit(maximumEnvelopeBytes) {
    _RuntimeRouter.instance.register(this);
  }

  final String runtimeId;
  final String channelToken;
  final int maximumEnvelopeBytes;
  final StreamController<WavegameRuntimeEvent> _events =
      StreamController<WavegameRuntimeEvent>.broadcast();
  bool _disposed = false;

  Stream<WavegameRuntimeEvent> get events => _events.stream;
  bool get isDisposed => _disposed;

  Future<void> dispatch(WavegameHostMessage message) async {
    _checkActive();
    final Map<String, Object?> envelope = message.toMap();
    _validateJsonSize(envelope, maximumEnvelopeBytes);
    await _RuntimeRouter.channel.invokeMethod<void>(
      'dispatch',
      <String, Object?>{'runtimeId': runtimeId, 'envelope': envelope},
    );
  }

  void _accept(Map<Object?, Object?> envelope) {
    if (_disposed) return;
    try {
      _events.add(WavegameRuntimeEvent.fromEnvelope(envelope));
    } on FormatException catch (error) {
      _events.add(
        WavegameLifecycleEvent(state: 'bridgeViolation', detail: error.message),
      );
    }
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _RuntimeRouter.instance.unregister(runtimeId);
    try {
      await _RuntimeRouter.channel.invokeMethod<void>(
        'destroy',
        <String, Object?>{'runtimeId': runtimeId},
      );
    } on MissingPluginException {
      // Unit tests and unsupported hosts can dispose without a native runtime.
    }
    await _events.close();
  }

  void _checkActive() {
    if (_disposed) throw StateError('Wavegame runtime is disposed');
  }
}

/// A separate, destroyable WebView used exclusively for cartridge rules.
final class WavegameRulesRuntime {
  WavegameRulesRuntime._({
    required this.runtimeId,
    required this.channelToken,
    required this.maximumEnvelopeBytes,
  });

  static const Set<String> allowedFunctions = <String>{
    'create',
    'reduce',
    'view',
  };
  static const int maximumPendingRequests = 8;

  final String runtimeId;
  final String channelToken;
  final int maximumEnvelopeBytes;
  final Map<String, Completer<WavegameRulesResult>> _pending =
      <String, Completer<WavegameRulesResult>>{};
  final Completer<void> _ready = Completer<void>();
  int _requestCounter = 0;
  bool _disposed = false;

  bool get isDisposed => _disposed;

  static Future<WavegameRulesRuntime> create({
    required String installedDirectory,
    String moduleEntrypoint = 'rules/index.mjs',
    int maximumEnvelopeBytes = wavegameMaximumEnvelopeBytes,
  }) async {
    _validateInstalledDirectory(installedDirectory);
    _validateRelativeEntrypoint(moduleEntrypoint);
    final WavegameRulesRuntime runtime = WavegameRulesRuntime._(
      runtimeId: _randomIdentifier('rules'),
      channelToken: _randomIdentifier('WaveGamesRules'),
      maximumEnvelopeBytes: _validateEnvelopeLimit(maximumEnvelopeBytes),
    );
    _RuntimeRouter.instance.registerRules(runtime);
    try {
      await _RuntimeRouter.channel
          .invokeMethod<void>('createRules', <String, Object?>{
            'runtimeId': runtime.runtimeId,
            'channelToken': runtime.channelToken,
            'installedDirectory': installedDirectory,
            'entrypoint': moduleEntrypoint,
            'maximumEnvelopeBytes': runtime.maximumEnvelopeBytes,
            'watchdogMilliseconds': 250,
          });
      await runtime._ready.future.timeout(const Duration(seconds: 5));
      return runtime;
    } on Object {
      await runtime.dispose();
      rethrow;
    }
  }

  /// Invokes an authoritative rule and returns only its game-defined value.
  ///
  /// Use [invokeWithResult] when the caller needs to persist the deterministic
  /// random counter returned by native code.
  Future<Object?> invoke(String function, Object? argument) async {
    return (await invokeWithResult(function, argument)).value;
  }

  /// Invokes an authoritative rule and exposes deterministic RNG progress.
  Future<WavegameRulesResult> invokeWithResult(
    String function,
    Object? argument,
  ) async {
    if (_disposed) throw StateError('Rules runtime is disposed');
    if (!allowedFunctions.contains(function)) {
      throw ArgumentError.value(function, 'function', 'unsupported rules API');
    }
    if (_pending.length >= maximumPendingRequests) {
      throw StateError('Too many rules requests are pending');
    }
    _validateJsonSize(argument, maximumEnvelopeBytes);
    final String requestId = '${++_requestCounter}';
    final Completer<WavegameRulesResult> completer =
        Completer<WavegameRulesResult>();
    _pending[requestId] = completer;
    try {
      await _RuntimeRouter.channel
          .invokeMethod<void>('invokeRules', <String, Object?>{
            'runtimeId': runtimeId,
            'requestId': requestId,
            'function': function,
            'argument': argument,
          });
    } on Object catch (error, stackTrace) {
      _pending.remove(requestId);
      Error.throwWithStackTrace(error, stackTrace);
    }
    return completer.future.timeout(
      const Duration(milliseconds: 500),
      onTimeout: () async {
        await dispose();
        throw TimeoutException('Rules runtime exceeded its watchdog');
      },
    );
  }

  /// Adds the serializable RNG descriptor expected by authoritative rules.
  ///
  /// Native code replaces this descriptor with `nextFloat()` and
  /// `nextInt(max)` functions before calling the rule. The returned
  /// [WavegameRulesResult.randomCounter] must be persisted by the host.
  Future<WavegameRulesResult> invokeWithRandom(
    String function,
    Map<String, Object?> argument, {
    required int seed,
    int counter = 0,
  }) {
    if (function == 'view') {
      throw ArgumentError.value(
        function,
        'function',
        'view must not receive authoritative randomness',
      );
    }
    _validateUint32(seed, 'seed');
    _validateUint32(counter, 'counter');
    return invokeWithResult(function, <String, Object?>{
      ...argument,
      'random': <String, Object?>{'seed': seed, 'counter': counter},
    });
  }

  void _accept(Map<Object?, Object?> envelope) {
    if (_disposed) return;
    final Object? type = envelope['type'];
    if (type == 'rules.ready') {
      if (!_ready.isCompleted) _ready.complete();
      return;
    }
    if (type == 'rules.timeout') {
      _markNativeDestroyed(
        TimeoutException('Rules runtime exceeded its 250ms watchdog'),
      );
      return;
    }
    if (type == 'lifecycle') {
      final Object? payload = envelope['payload'];
      final String state =
          payload is Map<Object?, Object?>
              ? payload['state']?.toString() ?? 'rendererDestroyed'
              : 'rendererDestroyed';
      _markNativeDestroyed(StateError('Rules runtime ended: $state'));
      return;
    }
    final Object? rawRequestId = envelope['requestId'];
    final String requestId = rawRequestId?.toString() ?? '';
    final Completer<WavegameRulesResult>? completer = _pending.remove(
      requestId,
    );
    if (completer == null || completer.isCompleted) return;
    if (type == 'rules.result') {
      try {
        completer.complete(WavegameRulesResult.fromNative(envelope['payload']));
      } on FormatException catch (error, stackTrace) {
        completer.completeError(error, stackTrace);
      }
    } else if (type == 'rules.error') {
      completer.completeError(
        StateError(envelope['message']?.toString() ?? 'Rules call failed'),
      );
    }
  }

  void _markNativeDestroyed(Object error) {
    if (_disposed) return;
    _disposed = true;
    _RuntimeRouter.instance.unregisterRules(runtimeId);
    for (final Completer<WavegameRulesResult> completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
    if (!_ready.isCompleted) _ready.completeError(error);
  }

  Future<void> dispose() async {
    if (_disposed) return;
    _disposed = true;
    _RuntimeRouter.instance.unregisterRules(runtimeId);
    final StateError error = StateError('Rules runtime was destroyed');
    for (final Completer<WavegameRulesResult> completer in _pending.values) {
      if (!completer.isCompleted) completer.completeError(error);
    }
    _pending.clear();
    if (!_ready.isCompleted) _ready.completeError(error);
    try {
      await _RuntimeRouter.channel.invokeMethod<void>(
        'destroy',
        <String, Object?>{'runtimeId': runtimeId},
      );
    } on MissingPluginException {
      // Allows deterministic disposal in Dart-only tests.
    }
  }
}

/// The result of one call into the isolated authoritative rules runtime.
@immutable
final class WavegameRulesResult {
  const WavegameRulesResult({required this.value, this.randomCounter});

  final Object? value;

  /// Updated unsigned 32-bit draw counter, or null when no RNG was supplied.
  final int? randomCounter;

  static WavegameRulesResult fromNative(Object? payload) {
    if (payload is! Map<Object?, Object?> || !payload.containsKey('value')) {
      throw const FormatException('Native rules result is invalid');
    }
    final Object? counter = payload['randomCounter'];
    if (counter != null &&
        (counter is! int || counter < 0 || counter > 0xffffffff)) {
      throw const FormatException('Native random counter is invalid');
    }
    return WavegameRulesResult(
      value: payload['value'],
      randomCounter: counter as int?,
    );
  }
}

/// Displays an installed cartridge UI in the native sandbox.
final class WavegameView extends StatelessWidget {
  const WavegameView({
    required this.controller,
    required this.installedDirectory,
    this.entrypoint = 'ui/index.html',
    this.allowAudio = false,
    super.key,
  });

  final WavegameRuntimeController controller;
  final String installedDirectory;
  final String entrypoint;
  final bool allowAudio;

  @override
  Widget build(BuildContext context) {
    _validateInstalledDirectory(installedDirectory);
    _validateRelativeEntrypoint(entrypoint);
    if (controller.isDisposed) {
      throw StateError('Cannot attach a disposed WavegameRuntimeController');
    }
    final Map<String, Object?> creationParams = <String, Object?>{
      'runtimeId': controller.runtimeId,
      'channelToken': controller.channelToken,
      'installedDirectory': installedDirectory,
      'entrypoint': entrypoint,
      'maximumEnvelopeBytes': controller.maximumEnvelopeBytes,
      'allowAudio': allowAudio,
    };
    if (Platform.isAndroid) {
      return AndroidView(
        viewType: _viewType,
        creationParams: creationParams,
        creationParamsCodec: const StandardMessageCodec(),
      );
    }
    if (Platform.isIOS) {
      return UiKitView(
        viewType: _viewType,
        creationParams: creationParams,
        creationParamsCodec: const StandardMessageCodec(),
      );
    }
    return const ColoredBox(
      color: Colors.black,
      child: Center(
        child: Text(
          'WaveGames cartridges require Android or iOS',
          style: TextStyle(color: Colors.white),
        ),
      ),
    );
  }
}

final class _RuntimeRouter {
  _RuntimeRouter._() {
    channel.setMethodCallHandler(_handleMethodCall);
  }

  static const MethodChannel channel = MethodChannel(_channelName);
  static final _RuntimeRouter instance = _RuntimeRouter._();

  final Map<String, WavegameRuntimeController> _visible =
      <String, WavegameRuntimeController>{};
  final Map<String, WavegameRulesRuntime> _rules =
      <String, WavegameRulesRuntime>{};

  void register(WavegameRuntimeController runtime) {
    _visible[runtime.runtimeId] = runtime;
  }

  void unregister(String runtimeId) => _visible.remove(runtimeId);

  void registerRules(WavegameRulesRuntime runtime) {
    _rules[runtime.runtimeId] = runtime;
  }

  void unregisterRules(String runtimeId) => _rules.remove(runtimeId);

  Future<void> _handleMethodCall(MethodCall call) async {
    if (call.method != 'runtimeEvent') return;
    final Object? arguments = call.arguments;
    if (arguments is! Map<Object?, Object?>) return;
    final Object? runtimeId = arguments['runtimeId'];
    final Object? envelope = arguments['envelope'];
    if (runtimeId is! String || envelope is! Map<Object?, Object?>) return;
    _visible[runtimeId]?._accept(envelope);
    _rules[runtimeId]?._accept(envelope);
  }
}

int _validateEnvelopeLimit(int value) {
  if (value < 1024 || value > wavegameMaximumEnvelopeBytes) {
    throw ArgumentError.value(
      value,
      'maximumEnvelopeBytes',
      'must be between 1024 and $wavegameMaximumEnvelopeBytes',
    );
  }
  return value;
}

void _validateJsonSize(Object? value, int maximumBytes) {
  late final String encoded;
  try {
    encoded = jsonEncode(value);
  } on JsonUnsupportedObjectError catch (error) {
    throw ArgumentError.value(value, 'value', error.toString());
  }
  final int size = utf8.encode(encoded).length;
  if (size > maximumBytes) {
    throw ArgumentError.value(size, 'encodedBytes', 'maximum is $maximumBytes');
  }
}

void _validateInstalledDirectory(String value) {
  if (value.isEmpty || !value.startsWith('/')) {
    throw ArgumentError.value(
      value,
      'installedDirectory',
      'must be an absolute path',
    );
  }
}

void _validateRelativeEntrypoint(String value) {
  if (value.isEmpty ||
      value.startsWith('/') ||
      value.contains('\\') ||
      value.contains('\u0000')) {
    throw ArgumentError.value(
      value,
      'entrypoint',
      'must be a safe relative path',
    );
  }
  final List<String> segments = value.split('/');
  if (segments.any(
    (String segment) => segment.isEmpty || segment == '.' || segment == '..',
  )) {
    throw ArgumentError.value(
      value,
      'entrypoint',
      'contains an unsafe segment',
    );
  }
}

void _validateUint32(int value, String name) {
  if (value < 0 || value > 0xffffffff) {
    throw ArgumentError.value(
      value,
      name,
      'must be an unsigned 32-bit integer',
    );
  }
}

String _randomIdentifier(String prefix) {
  final Random random = Random.secure();
  final StringBuffer output = StringBuffer('${prefix}_');
  for (int index = 0; index < 24; index += 1) {
    output.write(random.nextInt(256).toRadixString(16).padLeft(2, '0'));
  }
  return output.toString();
}
