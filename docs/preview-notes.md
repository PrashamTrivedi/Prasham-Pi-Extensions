# Preview asset checks

- Tested static structure: `preview.html` is self-contained (no external URLs, fonts, images, or scripts); `preview.svg` parses as XML.
- Responsive review: the HTML switches comparison cards to one column and stacks the inspector at 650px or below. Its controls retain visible text labels rather than icon-only controls.
- Accessibility review: view and detail switches are native buttons, selected states are exposed with `aria-selected` for tabs and `aria-pressed` for toggles, terminal controls have labels, status is written in text as well as color, and the simulation / fictional-data disclosure is permanently visible.

- Browser checks: Chromium at 1280px and 375px; all three views fit without horizontal overflow. Pin/unpin changes comparison contents. No JavaScript page errors were observed. `preview.png` is a screenshot of the HTML simulation, not of a live Pi run.

The preview is illustrative only: every agent, identifier, model, result, patch, and path is a non-sensitive fixture.
