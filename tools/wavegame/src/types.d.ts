export type LocalizedText = Readonly<Record<string, string>>;
export type SafeCapability = 'audio' | 'storage';

export interface PlayerMode {
  minPlayers: number;
  maxPlayers: number;
}

export interface WaveMode extends PlayerMode {
  pace: 'turn-based';
}

export interface WavegameManifestV1 {
  formatVersion: 1;
  id: string;
  version: string;
  title: LocalizedText;
  description?: LocalizedText;
  icon: string;
  engineApi: 1;
  entrypoints: {
    rules: string;
    ui: string;
  };
  orientation: 'any' | 'portrait' | 'landscape';
  capabilities: readonly SafeCapability[];
  modes: {
    local?: PlayerMode;
    wave?: WaveMode;
  };
}

export interface WavegameFileRecord {
  path: string;
  size: number;
  sha256: string;
}

export interface WavegameFilesIndexV1 {
  formatVersion: 1;
  files: readonly WavegameFileRecord[];
}

export interface CartridgePlayer {
  id: string;
  seat: number;
  name: string;
}

export interface CartridgeRules<State = unknown, Action = unknown, View = unknown> {
  create(input: {
    seed: number;
    players: readonly CartridgePlayer[];
    options: Readonly<Record<string, unknown>>;
  }): State | Promise<State>;
  reduce(input: {
    state: State;
    playerId: string;
    action: Action;
    revision: number;
    requestId: number;
    random: { nextFloat(): number; nextInt(maxExclusive: number): number };
  }):
    | { accepted: true; state: State; events?: readonly unknown[] }
    | { accepted: false; reason?: string }
    | Promise<
        | { accepted: true; state: State; events?: readonly unknown[] }
        | { accepted: false; reason?: string }
      >;
  view(input: {
    state: State;
    viewer: string;
    players: readonly CartridgePlayer[];
    revision: number;
  }): View | Promise<View>;
}
