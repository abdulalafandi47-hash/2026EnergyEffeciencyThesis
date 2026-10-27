# 3D view (Stage 5)

Run `npm run dev` and look at panel **4. 3D view** beside the editor.

## What it shows

A box for every layer, drawn from the **validated wall** the editor would give to the calculation engine: the same metres, in the same interior → exterior order. Nothing is a static picture. Change a thickness, width, height, material or the order, and the model changes; the *first* valid wall draws immediately, later changes move smoothly.

- **Interior and exterior sides** are marked in the 3D picture ("INTERIOR FACE", "EXTERIOR FACE"), in the layer list and on the layer cards.
- **Layer names and true thicknesses** appear as labels (with leader lines) and in the list. Labels can be switched off.
- **Colours identify material categories only.** They are not temperatures and carry no thermal meaning. Temperature colouring, if added later, will be a separate, labelled mode.
- **Inspect a layer** by clicking it in 3D, clicking it in the list, or pressing "Inspect" on its card. The selected layer stays solid with an orange outline; the others fade. The inspector shows category, true thickness, position measured from the interior face, available properties (missing ones flagged), data status, value type and source type, and the "not confirmed as an approved Cypriot design value" notice.
- **Exploded view** pulls the layers apart along the thickness. The gaps are for visibility only and are **not air gaps** (the screen says so).
- **Thickness drawing scale** (1×, 2×, 5×, 10×). Real layers are very thin next to the wall's width and height (a 15 mm plaster on a 3 m wall), so the view **starts at 5×**. Only the thickness direction is stretched; width and height are true. Whenever the scale is above 1×, the panel says so. Labels, the list and the inspector always show the **true** thickness. Choose 1× for true proportions.
- **Camera:** "3D view" (oblique), "From interior", "From exterior", "Section" (the cut edge: layers side by side, interior on the left).

## Controls

| Action | Mouse | Touch | Keyboard (3D view focused) |
|---|---|---|---|
| Rotate | drag | one-finger drag | arrow keys |
| Zoom | wheel | pinch | `+` / `−` |
| Pan | right-drag | two-finger drag | — |
| Reset | "3D view" button | same | `Home` |
| Inspect | click a layer | tap a layer | Tab to the layer list, Enter |

A click that is really a drag never selects a layer.

## When the inputs are invalid

The 3D view never draws impossible geometry. While the editor has errors it keeps the **last valid wall** on screen, keeps the list and inspector, and shows "Showing the last valid wall. Fix the errors in the editor to update this view." below the picture (so the picture does not jump).

## When 3D is unavailable

If the browser has no WebGL, or the 3D code fails to load, the panel says so and the **layer list and inspector still work as text**. The editor is never blocked by the 3D view. The 3D library loads after the editor appears (a separate ~140 kB compressed file).

## How it is built

| Module | Folder | Job | Knows about |
|---|---|---|---|
| Geometry | `src/geometry/` | pure arithmetic: box sizes and positions, exploded gaps, label placement, text description | nothing (no 3D library, no DOM) |
| Scene builder | `src/viewer3d/sceneBuilder.ts` | turns a layout into Three.js boxes, highlighting, animation steps | geometry, three |
| Viewer shell | `src/viewer3d/WallViewer.ts` | WebGL renderer, camera, controls, picking, labels | scene builder, geometry |
| Page panel | `src/ui/viewerPanel.ts` | buttons, legend, inspector, messages | editor output, geometry; viewer through an interface |

Coordinates: x runs through the thickness (interior at the negative end), y is height, z is width; the wall is centred on the origin. Three.js is imported only inside `src/viewer3d/`, enforced by `tests/architecture.test.ts`.

Accessibility: the canvas has a text alternative (size, every layer with true thickness, view mode, "colours are not temperatures"); everything the picture shows is also available as text in the list and inspector; moves are announced; reduced-motion settings skip animations. It has **not** been audited with a screen reader.

## How it is tested

| Level | Where | What it can and cannot show |
|---|---|---|
| Geometry arithmetic | `tests/geometry.test.ts` | layers touch exactly, true thicknesses sum, centred, uniform gaps, scale never alters labels, invalid input rejected, labels never overlap |
| Three.js scene (no GPU) | `tests/sceneBuilder.test.ts` | real Three.js boxes have exactly the layout's sizes/positions, including at 5×; selection, animation, picking by ray, disposal |
| Page behaviour | `tests/ui3d.test.ts` (fake viewer) | the page asks the viewer for the right wall at the right time; invalid input is held back; selection sync; fallbacks; cleanup |
| Module boundaries | `tests/architecture.test.ts` | the 3D library, DOM and engine stay where they belong |
| **Real browser** | `validation/browser3d.cjs` (not part of `npm test`) | WebGL actually draws; clicking, dragging, keys, exploded and camera views change the picture; phone layout; dark mode; reduced motion |

The automated suite cannot see pixels. The real-browser script compares screenshots (e.g. "the picture changed when a layer was selected"), and its screenshots were also inspected by eye. It ran on Chromium with software rendering only.

## Known limitations

- Chromium with software WebGL was tested. Firefox, Safari, real GPUs and real touch devices were **not**.
- Labels are drawn on top of the picture without hiding when a layer is in front of them.
- Layers are simple boxes: no openings, studs, air layers or thermal bridges.
- No temperature or heat-flow display yet (Stage 6).
- The 3D view does not export images or models.
