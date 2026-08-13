const installedTargets = new WeakSet();

/**
 * Removes ambient clocks, entropy, timers, and storage from an authoritative
 * rules realm. Install this before importing any cartridge-owned module.
 */
export function installAuthoritativeDeterminismGuard(target = globalThis) {
  if ((typeof target !== 'object' && typeof target !== 'function') || target === null) {
    throw new TypeError('The determinism guard requires a global object');
  }
  if (installedTargets.has(target)) return;

  const nondeterministic = () => {
    throw new Error('Nondeterministic platform APIs are forbidden in authoritative rules');
  };

  const deterministicConstruct = Reflect.construct.bind(Reflect);
  const deterministicApply = Reflect.apply.bind(Reflect);
  installDateGuard(target, nondeterministic, deterministicConstruct);
  installIntlGuard(target, nondeterministic, deterministicApply);
  installTemporalGuard(target);

  for (const name of ['crypto', 'performance']) lockValue(target, name, undefined);
  for (const name of ['setTimeout', 'setInterval', 'setImmediate', 'requestAnimationFrame', 'requestIdleCallback']) {
    lockValue(target, name, nondeterministic);
  }
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches']) {
    lockGetter(target, name, nondeterministic);
  }

  lockValue(target.Math, 'random', () => {
    throw new Error('Math.random is forbidden in authoritative rules');
  });
  installNodeClockGuard(target, nondeterministic);
  installedTargets.add(target);
}

function installDateGuard(target, nondeterministic, deterministicConstruct) {
  const OriginalDate = target.Date;
  if (typeof OriginalDate !== 'function') throw new Error('Authoritative rules require a Date implementation');

  const DeterministicDate = function (...arguments_) {
    if (!new.target || arguments_.length === 0) return nondeterministic();
    return deterministicConstruct(OriginalDate, arguments_, new.target);
  };
  Object.defineProperty(DeterministicDate, 'name', { value: 'Date', configurable: false });
  Object.defineProperty(DeterministicDate, 'prototype', {
    value: OriginalDate.prototype,
    writable: false,
    configurable: false,
  });
  for (const name of ['parse', 'UTC']) {
    Object.defineProperty(DeterministicDate, name, {
      value: OriginalDate[name].bind(OriginalDate),
      writable: false,
      configurable: false,
    });
  }
  Object.defineProperty(DeterministicDate, 'now', {
    value: nondeterministic,
    writable: false,
    configurable: false,
  });
  Object.defineProperty(OriginalDate.prototype, 'constructor', {
    value: DeterministicDate,
    writable: false,
    configurable: false,
  });
  lockValue(target, 'Date', DeterministicDate);
}

function installIntlGuard(target, nondeterministic, deterministicApply) {
  const prototype = target.Intl?.DateTimeFormat?.prototype;
  if (!prototype) return;

  const formatDescriptor = Object.getOwnPropertyDescriptor(prototype, 'format');
  if (typeof formatDescriptor?.get === 'function') {
    const originalFormat = formatDescriptor.get;
    const wrappedFormats = new WeakMap();
    Object.defineProperty(prototype, 'format', {
      get() {
        let wrapped = wrappedFormats.get(this);
        if (wrapped) return wrapped;
        const format = deterministicApply(originalFormat, this, []);
        wrapped = function (value) {
          if (arguments.length === 0 || value === undefined) return nondeterministic();
          return deterministicApply(format, undefined, arguments);
        };
        wrappedFormats.set(this, wrapped);
        return wrapped;
      },
      enumerable: formatDescriptor.enumerable,
      configurable: false,
    });
  }

  const formatToParts = prototype.formatToParts;
  if (typeof formatToParts === 'function') {
    Object.defineProperty(prototype, 'formatToParts', {
      value(value) {
        if (arguments.length === 0 || value === undefined) return nondeterministic();
        return deterministicApply(formatToParts, this, arguments);
      },
      writable: false,
      enumerable: false,
      configurable: false,
    });
  }
}

function installTemporalGuard(target) {
  if (target.Temporal && (typeof target.Temporal === 'object' || typeof target.Temporal === 'function')) {
    lockValue(target.Temporal, 'Now', undefined);
    return;
  }
  lockValue(target, 'Temporal', undefined);
}

function installNodeClockGuard(target, nondeterministic) {
  const processObject = target.process;
  if (!processObject || typeof processObject !== 'object') return;
  const deniedHighResolutionTime = (..._arguments) => nondeterministic();
  Object.defineProperty(deniedHighResolutionTime, 'bigint', {
    value: nondeterministic,
    writable: false,
    configurable: false,
  });
  lockValue(processObject, 'hrtime', deniedHighResolutionTime);
  lockValue(processObject, 'uptime', nondeterministic);
}

function lockValue(object, name, value) {
  if (!object) return;
  Object.defineProperty(object, name, {
    value,
    writable: false,
    configurable: false,
  });
}

function lockGetter(object, name, getter) {
  Object.defineProperty(object, name, {
    get: getter,
    set: getter,
    configurable: false,
  });
}
