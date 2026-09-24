import type { WebContents } from 'electron';

export function restrictDocumentNavigation(contents: WebContents) {
  // CSP does not block a script assigning its own location. Keep document frames
  // in srcdoc; sandbox separately blocks top navigation, popups and desktop APIs.
  contents.on('will-frame-navigate', event => {
    if (!event.isMainFrame && event.url.split('#')[0] !== 'about:srcdoc') event.preventDefault();
  });
}
