import type { HtmlResult } from "./types.js";

/** Scriptless, opaque-origin HTML view. No source-generated DOM enters the host. */
export class HtmlPreview {
  #frame: HTMLIFrameElement;
  #disposed = false;
  #fingerprint: string | undefined;
  constructor(host: HTMLElement, options: { title: string }) {
    this.#frame = document.createElement("iframe");
    this.#frame.title = options.title;
    this.#frame.setAttribute("sandbox", "");
    this.#frame.referrerPolicy = "no-referrer";
    this.#frame.style.cssText = "display:block;width:100%;height:100%;border:0";
    host.replaceChildren(this.#frame);
  }
  render(result: HtmlResult): void {
    if (this.#disposed) throw new Error("HTML preview is disposed");
    if (
      !result.success ||
      result.html === null ||
      result.fingerprint === this.#fingerprint
    )
      return;
    this.#fingerprint = result.fingerprint;
    // This policy is first in the document. Further policies can only restrict it.
    // The sandbox denies scripts, same-origin access, forms, popups and automatic navigation.
    const policy =
      "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'";
    this.#frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${result.html}`;
  }
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#frame.srcdoc = "";
    this.#frame.remove();
  }
}
