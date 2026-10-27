# Pricing artwork

The pricing page shows the brand's T mark as a live 3D animation, drawn by the inline module at the end of `scripts/templates/pricing.html`. It replaced the blue glass infinity image (`lifetime-credit-v1.jpg`) in v3.92.0. Decorative only: the figure is `aria-hidden` and the pricing text stays plain HTML.

## Source

The LeibTour T animation handoff, version B (`design_handoff_leibtour_t_animation`, 2026-10-27). The geometry helpers (`buildT`, `makeStudioEnv`) are ported unchanged from its `leibtour-t-model.js`, and every number in the scene is the handoff's final value:

- Geometry: 5 extruded meshes traced from the ver.2 reference render, depth 0.16, bevel 0.012.
- Material: `MeshStandardMaterial` color `#8a8b92`, metalness 1, roughness 0.16, lit by a procedural studio environment.
- Renderer: transparent, ACES Filmic, exposure 1.25, pixel ratio at most 2.
- Camera: FOV 28°, position (0, 0.15, 6.2), pulled back by `max(1, 1.15 / aspect)` in narrow boxes.
- Motion: a 10 s seamless loop. Sway ±28°, a slight nod, stripes that separate in depth and close again, a light sweep twice per loop, and a tilt that follows the pointer across the window.

## Runtime

- three.js r184 loads from unpkg (`three.module.min.js` and `three.core.min.js`), pinned by version and by `sha384` integrity in the import map. A bumped version needs both hashes recomputed.
- Reduced motion shows one still frame at phase 0, with no loop and no tilt.
- The loop pauses while the mark is off screen.
- If three.js cannot load or WebGL is off, the figure is removed, the error is logged, and the pricing table takes the full width.
