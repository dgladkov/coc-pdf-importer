import { processPDF } from "./process.ts";
import { importCharacters } from "./importer.ts";

type ImportProgress = {
  name: string;
  status: "pending" | "working" | "done" | "error";
  created: number;
  failed: number;
  error?: string;
};

export class PdfImporterConfig extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "coc-pdf-importer-settings",
    tag: "form",
    window: {
      title: "coc-pdf-importer.Settings.Name",
      contentClasses: ["standard-form"],
    },
    form: {
      closeOnSubmit: false,
      handler: PdfImporterConfig.#onSubmit,
    },
    position: {
      width: 550,
    },
  };

  static PARTS = {
    form: {
      template: "modules/coc-pdf-importer/templates/pdf-importer.hbs",
      scrollable: [""],
    },
    progress: {
      template: "modules/coc-pdf-importer/templates/import-progress.hbs",
    },
    footer: {
      template: "templates/generic/form-footer.hbs",
    },
  };

  #importing = false;
  #progress: ImportProgress[] = [];

  _prepareContext(options: object) {
    const totalCreated = this.#progress.reduce((n, p) => n + p.created, 0);
    return {
      importing: this.#importing,
      progress: this.#progress.map((p) => ({
        name: p.name,
        status: p.status,
        label: this.#statusLabel(p),
      })),
      totalLabel: game.i18n.format("coc-pdf-importer.Progress.Total", {
        created: totalCreated,
      }),
      buttons: [
        {
          type: "submit",
          icon: this.#importing
            ? "fa-solid fa-spinner fa-spin"
            : "fa-solid fa-upload",
          label: this.#importing
            ? "coc-pdf-importer.Progress.Working"
            : "coc-pdf-importer.Settings.Label",
          disabled: this.#importing,
        },
      ],
    };
  }

  static async #onSubmit(event: Event, form: HTMLFormElement, formData: object) {
    const input = form.querySelector<HTMLInputElement>('input[name="files"]');
    const files = input?.files;
    if (!files || files.length === 0) {
      ui.notifications.error(
        game.i18n.localize("coc-pdf-importer.Errors.NoFiles"),
      );
      return;
    }
    await this.runImport(Array.from(files));
  }

  // Import each file in turn, re-rendering the progress list and the (disabled)
  // submit button between steps so the dialog reflects live status.
  async runImport(files: File[]) {
    this.#importing = true;
    this.#progress = files.map((f): ImportProgress => ({
      name: f.name,
      status: "pending",
      created: 0,
      failed: 0,
    }));
    await this.render({ parts: ["progress", "footer"] });

    for (let i = 0; i < files.length; i++) {
      const entry = this.#progress[i];
      entry.status = "working";
      await this.render({ parts: ["progress"] });
      try {
        const characters = await processPDF(
          new Uint8Array(await files[i].arrayBuffer()),
        );
        const folderName = files[i].name.replace(/\.[^.]+$/, "");
        const result = await importCharacters(characters, {
          folderName,
          notify: false,
        });
        entry.status = "done";
        entry.created = result.created;
        entry.failed = result.failed;
      } catch (e) {
        entry.status = "error";
        entry.error = e instanceof Error ? e.message : String(e);
      }
      await this.render({ parts: ["progress"] });
    }

    this.#importing = false;
    await this.render({ parts: ["progress", "footer"] });
  }

  #statusLabel(p: ImportProgress): string {
    switch (p.status) {
      case "working":
        return game.i18n.localize("coc-pdf-importer.Progress.Working");
      case "done":
        return p.failed
          ? game.i18n.format("coc-pdf-importer.Progress.CreatedWithErrors", {
              created: p.created,
              failed: p.failed,
            })
          : game.i18n.format("coc-pdf-importer.Progress.Created", {
              created: p.created,
            });
      case "error":
        return game.i18n.format("coc-pdf-importer.Errors.ErrorProcessing", {
          error: p.error ?? "",
        });
      default:
        return game.i18n.localize("coc-pdf-importer.Progress.Pending");
    }
  }
}