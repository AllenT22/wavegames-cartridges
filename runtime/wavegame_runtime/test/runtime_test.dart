import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:wavegame_runtime/wavegame_runtime.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const MethodChannel channel = MethodChannel(
    'com.wavegames.wavegame_runtime/control',
  );

  tearDown(() async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  test('support directory is supplied only by native code', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
          expect(call.method, 'getSupportDirectory');
          expect(call.arguments, isNull);
          return '/private/app/WaveGames';
        });

    expect(
      await WavegameStoragePaths.supportDirectory(),
      '/private/app/WaveGames',
    );
  });

  test('action event preserves its correlation ID', () {
    final WavegameRuntimeEvent event = WavegameRuntimeEvent.fromEnvelope(
      <Object?, Object?>{
        'type': 'action',
        'requestId': 'a12',
        'payload': <String, Object?>{'move': 3},
      },
    );

    expect(event, isA<WavegameActionEvent>());
    expect((event as WavegameActionEvent).requestId, 'a12');
  });

  test('action result is an allowed typed host message', () {
    expect(
      WavegameHostMessage('action.result', <String, Object?>{
        'requestId': 'a1',
        'value': true,
      }).toMap()['type'],
      'action.result',
    );
  });

  test('host protocol keeps storage result typed alongside action result', () {
    expect(WavegameHostMessage.allowedTypes, contains('storage.result'));
    expect(WavegameHostMessage.allowedTypes, contains('action.result'));
    expect(WavegameHostMessage.allowedTypes, contains('event'));
  });

  test('rules result exposes the updated deterministic random counter', () {
    final WavegameRulesResult result = WavegameRulesResult.fromNative(
      <Object?, Object?>{
        'value': <String, Object?>{'winner': 'p1'},
        'randomCounter': 7,
      },
    );

    expect(result.value, <String, Object?>{'winner': 'p1'});
    expect(result.randomCounter, 7);
  });

  test('native rules timeout permanently closes the Dart handle', () async {
    String? runtimeId;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
          final Map<Object?, Object?> arguments =
              call.arguments! as Map<Object?, Object?>;
          if (call.method == 'createRules') {
            runtimeId = arguments['runtimeId']! as String;
          }
          return null;
        });

    final Future<WavegameRulesRuntime> creating = WavegameRulesRuntime.create(
      installedDirectory: '/private/app/WaveGames/packages/test',
    );
    while (runtimeId == null) {
      await Future<void>.delayed(Duration.zero);
    }
    await _sendRuntimeEvent(runtimeId!, <String, Object?>{
      'type': 'rules.ready',
    });
    final WavegameRulesRuntime runtime = await creating;
    final Future<Object?> invocation = runtime.invoke(
      'create',
      <String, Object?>{},
    );
    final Future<void> timeoutExpectation = expectLater(
      invocation,
      throwsA(isA<TimeoutException>()),
    );
    await Future<void>.delayed(Duration.zero);

    await _sendRuntimeEvent(runtimeId!, <String, Object?>{
      'type': 'rules.timeout',
      'requestId': '1',
    });

    await timeoutExpectation;
    expect(runtime.isDisposed, isTrue);
    await expectLater(
      runtime.invoke('create', <String, Object?>{}),
      throwsStateError,
    );
  });

  test('rules runtime bounds outstanding native requests', () async {
    String? runtimeId;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (MethodCall call) async {
          final Map<Object?, Object?> arguments =
              call.arguments! as Map<Object?, Object?>;
          if (call.method == 'createRules') {
            runtimeId = arguments['runtimeId']! as String;
          }
          return null;
        });

    final Future<WavegameRulesRuntime> creating = WavegameRulesRuntime.create(
      installedDirectory: '/private/app/WaveGames/packages/test',
    );
    while (runtimeId == null) {
      await Future<void>.delayed(Duration.zero);
    }
    await _sendRuntimeEvent(runtimeId!, <String, Object?>{
      'type': 'rules.ready',
    });
    final WavegameRulesRuntime runtime = await creating;
    final List<Future<void>> handled = <Future<void>>[];
    for (
      int index = 0;
      index < WavegameRulesRuntime.maximumPendingRequests;
      index += 1
    ) {
      handled.add(
        runtime
            .invoke('create', <String, Object?>{'index': index})
            .then<void>((Object? _) {}, onError: (Object _) {}),
      );
    }

    await expectLater(
      runtime.invoke('create', <String, Object?>{'overflow': true}),
      throwsStateError,
    );
    await runtime.dispose();
    await Future.wait(handled);
  });
}

Future<void> _sendRuntimeEvent(
  String runtimeId,
  Map<String, Object?> envelope,
) async {
  final Completer<void> delivered = Completer<void>();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .handlePlatformMessage(
        'com.wavegames.wavegame_runtime/control',
        const StandardMethodCodec().encodeMethodCall(
          MethodCall('runtimeEvent', <String, Object?>{
            'runtimeId': runtimeId,
            'envelope': envelope,
          }),
        ),
        (_) => delivered.complete(),
      );
  await delivered.future;
}
