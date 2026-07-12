// Minimal ambient declarations for the Foundry VTT globals this module touches.
// Deliberately partial: only the members the importer actually calls are typed.
// The ApplicationV2 framework and the CoC7 system data model are left untyped
// (`any`) — full Foundry typings are out of scope here.

interface FoundryI18n {
  localize(key: string): string;
  format(key: string, data?: Record<string, unknown>): string;
}

interface FoundryFolder {
  id?: string;
  name?: string;
  type?: string;
}

interface FoundryActor {
  id?: string;
  name?: string;
  folder?: FoundryFolder | null;
  system?: any;
  createEmbeddedDocuments(
    type: string,
    data: object[],
    options?: object,
  ): Promise<unknown>;
  update(data: object): Promise<unknown>;
  delete(): Promise<unknown>;
}

interface FoundryGame {
  i18n: FoundryI18n;
  actors?: { filter(predicate: (actor: FoundryActor) => boolean): FoundryActor[] };
  folders?: {
    find(
      predicate: (folder: FoundryFolder) => boolean,
    ): FoundryFolder | undefined;
  };
  settings: {
    registerMenu(namespace: string, key: string, config: object): void;
  };
  // The CoC7 system API. `skillNames.getList()` resolves to a map of
  // CoCID -> skill item; `cocid.fromCoCIDRegexBest` returns the best item per
  // CoCID matching a regex (world + compendium, best per era/language).
  CoC7?: {
    skillNames?: {
      getList(): Promise<Record<string, any>>;
    };
    cocid?: {
      fromCoCIDRegexBest(options: {
        cocidRegExp: RegExp;
        type: string;
      }): Promise<any[]>;
    };
  };
}

interface FoundryUi {
  notifications: {
    info(message: string): void;
    error(message: string): void;
  };
}

// Globals provided by the running Foundry client (not bundled).
declare const game: FoundryGame;
declare const ui: FoundryUi;
declare const Hooks: { once(hook: string, fn: (...args: any[]) => void): void };
declare const Actor: { create(data: object): Promise<FoundryActor> };
declare const Folder: {
  create(data: { name: string; type: string }): Promise<FoundryFolder>;
};
declare const foundry: {
  applications: {
    api: {
      ApplicationV2: abstract new (...args: any[]) => unknown;
      // We don't type the ApplicationV2 framework: the mixin hands back a
      // subclassable base as `any`, so the config subclass stays dynamic.
      HandlebarsApplicationMixin(base: unknown): any;
    };
  };
};
