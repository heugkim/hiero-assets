# hiero-assets

Static assets for [hiero.studio](https://hiero.studio) (Hiero Studio — Eugene's design studio).

## Files

- `hiero-base-meshopt.glb` — wordmark geometry, extruded from Gerstner Programm Bold via Blender, compressed with `gltfpack -cc` (meshopt). 23KB.
- `hiero-base.glb` — uncompressed source, 152KB.

## Usage

Served via jsDelivr CDN with proper CORS headers:

```
https://cdn.jsdelivr.net/gh/heugkim/hiero-assets@main/hiero-base-meshopt.glb
```

Loaded by `HeroText.tsx` in the Framer project for the homepage 3D wordmark.
