/**
 * The few things the screen needs from the browser that tests must be able to
 * replace: saving a file, printing, and reading the clock.
 */
export interface FileIo {
  /** Offers `text` to the user as a file download. */
  download(filename: string, mimeType: string, text: string): void;
  /** Opens the browser's print dialog for a complete HTML document ("Save as PDF" is one of its choices). */
  print(html: string): void;
  now(): Date;
}

export const browserIo: FileIo = {
  download(filename, mimeType, text) {
    const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    // Give the browser time to start the download before the address is released.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  },

  print(html) {
    // An invisible, script-less frame: the report cannot run code, and only the report is printed.
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-modals allow-same-origin');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
    frame.addEventListener('load', () => {
      const win = frame.contentWindow;
      if (!win) return frame.remove();
      win.addEventListener('afterprint', () => frame.remove());
      win.focus();
      win.print();
      setTimeout(() => frame.remove(), 120_000); // in case 'afterprint' never fires
    });
    frame.srcdoc = html;
    document.body.append(frame);
  },

  now: () => new Date(),
};
