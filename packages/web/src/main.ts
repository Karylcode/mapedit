// One bundle serves both pages; the screenshot page loads none of the editor's interface.
if (location.pathname === '/render') void import('./render/render-page.js').then((m) => m.start());
else void import('./editor/editor.js').then((m) => m.start());
