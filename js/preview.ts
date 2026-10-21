import type { Compiler } from "./compiler.js";
import type { CompileResult, Jump } from "./types.js";
export interface PreviewEvents {
  navigate: CustomEvent<Jump>;
  error: CustomEvent<unknown>;
}

/** Optional SVG image view. No HTML from document source is injected. */
export class Preview extends EventTarget {
  override addEventListener<K extends keyof PreviewEvents>(
    type: K,
    listener: (event: PreviewEvents[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  override addEventListener(
    type: string,
    listener:
      | EventListenerOrEventListenerObject
      | ((event: CustomEvent) => void)
      | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    super.addEventListener(
      type,
      listener as EventListenerOrEventListenerObject | null,
      options,
    );
  }
  #host: HTMLElement;
  #compiler: Compiler;
  #epoch = 0;
  #urls: string[] = [];
  #disposed = false;
  #click: (event: MouseEvent) => void;
  constructor(host: HTMLElement, compiler: Compiler) {
    super();
    this.#host = host;
    this.#compiler = compiler;
    this.#click = (event) => {
      const target = event.target;
      if (
        !(target instanceof HTMLImageElement) ||
        target.parentElement !== host
      )
        return;
      const revision = Number(target.dataset.revision);
      const page = Number(target.dataset.page);
      const rect = target.getBoundingClientRect();
      const epoch = this.#epoch;
      const x =
        ((event.clientX - rect.left) * Number(target.dataset.width)) /
        rect.width;
      const y =
        ((event.clientY - rect.top) * Number(target.dataset.height)) /
        rect.height;
      void compiler
        .outputToSource(revision, { page, x, y })
        .then((jump: Jump) => {
          if (epoch === this.#epoch && !this.#disposed)
            this.dispatchEvent(new CustomEvent("navigate", { detail: jump }));
        })
        .catch((error: unknown) => {
          if (!this.#disposed)
            this.dispatchEvent(new CustomEvent("error", { detail: error }));
        });
    };
    host.addEventListener("click", this.#click);
  }
  async render(result: CompileResult): Promise<void> {
    if (this.#disposed) throw new Error("Preview is disposed");
    const epoch = ++this.#epoch;
    if (!result.success) return;
    const urls: string[] = [];
    try {
      const fragment = document.createDocumentFragment();
      for (const [index, page] of result.pages.entries()) {
        const svg = await this.#compiler.svg(result.revision, index + 1);
        if (epoch !== this.#epoch || this.#disposed) return;
        const url = URL.createObjectURL(
          new Blob([svg], { type: "image/svg+xml" }),
        );
        urls.push(url);
        const image = document.createElement("img");
        image.src = url;
        image.alt = `Page ${index + 1}`;
        image.width = Math.ceil(page.width);
        image.height = Math.ceil(page.height);
        image.style.cssText =
          "display:block;max-width:100%;height:auto;margin:0 auto 16px";
        image.dataset.page = String(index + 1);
        image.dataset.revision = String(result.revision);
        image.dataset.width = String(page.width);
        image.dataset.height = String(page.height);
        fragment.append(image);
      }
      if (epoch !== this.#epoch || this.#disposed) return;
      for (const url of this.#urls) URL.revokeObjectURL(url);
      this.#urls = urls.splice(0);
      this.#host.replaceChildren(fragment);
    } finally {
      for (const url of urls) URL.revokeObjectURL(url);
    }
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#epoch++;
    this.#host.removeEventListener("click", this.#click);
    this.#host.replaceChildren();
    for (const url of this.#urls) URL.revokeObjectURL(url);
    this.#urls = [];
  }
}
