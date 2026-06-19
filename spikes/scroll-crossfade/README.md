# U2 spike - scroll + forced perspective + light cross-fade

Throwaway feasibility spike for the Hiero immersive 3D landing (plan U2, the runtime
GATE). Standalone HTML/JS so it runs outside Framer first. **Not production code.**

Plan: `~/claude-drive/Projects/hiero-studio/2026-06-19-hiero-immersive-3d-build-plan.md`

## What it proves (the three U2 risks)
1. One scroll-driven `uBlend` cross-fades 3 lightmaps inside a `MeshStandardMaterial`
   via `onBeforeCompile`, with no ghosting (dusk -> deep night -> frost dawn).
2. Smooth scroll (Lenis + GSAP ScrollTrigger) holds ~60fps.
3. A short camera dolly + ±10° pointer-look over a pre-tapered tube reads as a long
   monumental walk without the forced-perspective trick breaking.

## Run it
```bash
cd ~/code/hiero-assets/spikes/scroll-crossfade
python3 -m http.server 8777    # any static server
# open http://localhost:8777/
```
Scroll to walk; move the pointer to look around. The HUD (top-left) shows live FPS,
scroll %, uBlend, dolly position, and whether the shader inject succeeded.

## Empirical tuning (URL params)
- `?dolly=30` - push the forward travel to find where forced perspective breaks
  (default 12 is the safe value; the tube is 64 long).
- `?far=0.6` - narrow-end radius (stronger/weaker taper).
- `?look=18` - pointer-look degrees.

## Files
- `index.html` - DOM, scroll container, HUD, CDN deps (three r171, gsap 3.12.5, lenis 1.3.23).
- `spike.js` - scene, the onBeforeCompile blend, scroll wiring, render loop.
- `lightmaps/` - 3 stand-in gradient lightmaps (bright regions in different spots so
  ghosting is obvious by eye). Real bakes come from plan U4.

## Deps
Loaded from jsdelivr CDN (needs network on first load). Vanilla Three.js by design
(matches the existing `HeroText3D` code style; no react-three-fiber).
